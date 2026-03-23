import { prisma } from "../../db/prisma.js";
import { DeletionTrigger as DeletionTriggerEnum } from "../../db/prismaRuntime.js";
import { pseudonymizeUser } from "./pseudonymizationService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import {
  OFFBOARDING_GRACE_PERIOD_DAYS,
  INACTIVITY_RETENTION_DAYS,
} from "../../config/retention.js";

export type PseudonymizationScanResult = {
  gracePeriodExecuted: number;
  offboardingExecuted: number;
  inactivityExecuted: number;
  errors: number;
};

/**
 * Runs all three pseudonymisation triggers:
 *
 * 1. Grace-period requests: user-requested deletions whose effectiveAt has passed.
 * 2. Offboarding: users with activeStatus=false for >= OFFBOARDING_GRACE_PERIOD_DAYS
 *    and no pending user-requested deletion (which already has its own flow).
 * 3. Inactivity backstop: users who have not logged in for >= INACTIVITY_RETENTION_DAYS
 *    and are not already pseudonymised and have no active deletion request.
 */
export async function runPseudonymizationScan(): Promise<PseudonymizationScanResult> {
  const result: PseudonymizationScanResult = {
    gracePeriodExecuted: 0,
    offboardingExecuted: 0,
    inactivityExecuted: 0,
    errors: 0,
  };

  const now = new Date();

  // ── 1. Grace-period requests ────────────────────────────────────────────
  const dueRequests = await prisma.deletionRequest.findMany({
    where: { status: "PENDING", effectiveAt: { lte: now } },
    select: { id: true, userId: true, trigger: true },
  });

  for (const request of dueRequests) {
    try {
      await pseudonymizeUser(request.userId, request.trigger, request.id);
      result.gracePeriodExecuted++;
    } catch (error) {
      result.errors++;
      logOperationalEvent(
        operationalEvents.pseudonymization.scanError,
        { phase: "grace_period", userId: request.userId, requestId: request.id, error: String(error) },
        "error",
      );
    }
  }

  // ── 2. Offboarding trigger ──────────────────────────────────────────────
  const offboardingCutoff = new Date(now);
  offboardingCutoff.setDate(offboardingCutoff.getDate() - OFFBOARDING_GRACE_PERIOD_DAYS);

  const offboardedUsers = await prisma.user.findMany({
    where: {
      activeStatus: false,
      isAnonymized: false,
      updatedAt: { lte: offboardingCutoff },
      // Skip users who have an active user-initiated deletion request (handled above)
      deletionRequests: { none: { status: "PENDING", trigger: "USER_REQUEST" } },
    },
    select: { id: true },
  });

  for (const user of offboardedUsers) {
    try {
      // Create a system-initiated deletion request and execute immediately
      const request = await prisma.deletionRequest.create({
        data: { userId: user.id, trigger: DeletionTriggerEnum.OFFBOARDING, effectiveAt: null },
      });
      await pseudonymizeUser(user.id, DeletionTriggerEnum.OFFBOARDING, request.id);
      result.offboardingExecuted++;
    } catch (error) {
      result.errors++;
      logOperationalEvent(
        operationalEvents.pseudonymization.scanError,
        { phase: "offboarding", userId: user.id, error: String(error) },
        "error",
      );
    }
  }

  // ── 3. Inactivity backstop ──────────────────────────────────────────────
  const inactivityCutoff = new Date(now);
  inactivityCutoff.setDate(inactivityCutoff.getDate() - INACTIVITY_RETENTION_DAYS);

  const inactiveUsers = await prisma.user.findMany({
    where: {
      isAnonymized: false,
      lastLoginAt: { lte: inactivityCutoff },
      deletionRequests: { none: { status: "PENDING" } },
    },
    select: { id: true },
  });

  for (const user of inactiveUsers) {
    try {
      const request = await prisma.deletionRequest.create({
        data: { userId: user.id, trigger: DeletionTriggerEnum.INACTIVITY, effectiveAt: null },
      });
      await pseudonymizeUser(user.id, DeletionTriggerEnum.INACTIVITY, request.id);
      result.inactivityExecuted++;
    } catch (error) {
      result.errors++;
      logOperationalEvent(
        operationalEvents.pseudonymization.scanError,
        { phase: "inactivity", userId: user.id, error: String(error) },
        "error",
      );
    }
  }

  if (result.gracePeriodExecuted + result.offboardingExecuted + result.inactivityExecuted > 0 || result.errors > 0) {
    logOperationalEvent(operationalEvents.pseudonymization.scanCompleted, {
      ...result,
      ranAt: now.toISOString(),
    });
  }

  return result;
}
