import { createHash } from "node:crypto";
import type { DeletionTrigger, DeletionRequestStatus } from "@prisma/client";
import { DeletionTrigger as DeletionTriggerEnum } from "../../db/prismaRuntime.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { runInTransaction } from "../../db/transaction.js";
import {
  createPseudonymizationRepository,
  pseudonymizationRepository,
} from "./pseudonymizationRepository.js";

/**
 * Produces a stable, non-reversible token used as the pseudonymised email
 * address. Using a one-way hash of the userId means:
 *  - the replacement is deterministic (re-running is idempotent)
 *  - it cannot be reversed to recover the original email
 *  - it still satisfies the @unique constraint on User.email
 */
function pseudoEmail(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 16);
  return `pseudo-${hash}@deleted.invalid`;
}

export type PseudonymizationResult = {
  userId: string;
  trigger: DeletionTrigger;
  cancelledJobCount: number;
};

/**
 * Pseudonymises a user's directly identifying data in a single transaction:
 *  1. Cancels any pending/running assessment jobs
 *  2. Replaces name, email, department, manager with neutral placeholders
 *  3. Marks the user as anonymised
 *  4. Completes the DeletionRequest record
 *  5. Writes a user_pseudonymized audit event
 *
 * All related records (Submissions, Decisions, Appeals, AuditEvents) are
 * intentionally retained — they hold statistical value and are no longer
 * directly linkable to an identifiable person once the User row is scrubbed.
 *
 * Calling this function on an already-pseudonymised user is a no-op.
 */
export async function pseudonymizeUser(
  userId: string,
  trigger: DeletionTrigger,
  deletionRequestId?: string,
): Promise<PseudonymizationResult> {
  const user = await pseudonymizationRepository.findUserAnonymizationState(userId);

  if (!user) {
    throw new Error(`User ${userId} not found.`);
  }

  if (user.isAnonymized) {
    logOperationalEvent("pseudonymization_skipped", { userId, reason: "already_pseudonymized", trigger });
    return { userId, trigger, cancelledJobCount: 0 };
  }

  const now = new Date();

  const result = await runInTransaction(async (tx) => {
    const txRepo = createPseudonymizationRepository(tx);
    // 1. Cancel pending / running assessment jobs
    const cancelledJobs = await txRepo.cancelAssessmentJobsForUser(userId);

    // 2. Pseudonymise the user record
    await txRepo.pseudonymizeUser(userId, pseudoEmail(userId), now);

    // 3. Complete the DeletionRequest if provided
    if (deletionRequestId) {
      await txRepo.completeDeletionRequest(deletionRequestId, now);
    } else {
      // Mark any pending request for this user as completed
      await txRepo.completePendingDeletionRequestsForUser(userId, now);
    }

    // 4. Audit event
    await recordAuditEvent(
      {
        entityType: "user",
        entityId: userId,
        action: "user_pseudonymized",
        actorId: undefined,
        metadata: { trigger, cancelledJobCount: cancelledJobs.count, pseudonymizedAt: now.toISOString() },
      },
      tx,
    );

    return { cancelledJobCount: cancelledJobs.count };
  });

  logOperationalEvent("user_pseudonymized", { userId, trigger, cancelledJobCount: result.cancelledJobCount });

  return { userId, trigger, cancelledJobCount: result.cancelledJobCount };
}

/**
 * Creates a user-initiated deletion request. If immediateExecution is true,
 * pseudonymisation runs immediately. Otherwise a grace-period record is stored
 * and the scanner will execute when effectiveAt is reached.
 */
export async function requestPseudonymization(
  userId: string,
  options: { gracePeriodDays: number; immediate: boolean },
): Promise<{ requestId: string; effectiveAt: Date | null; status: DeletionRequestStatus }> {
  // Block if the user is already pseudonymised
  const user = await pseudonymizationRepository.findUserAnonymizationState(userId);
  if (!user) throw new Error("User not found.");
  if (user.isAnonymized) throw new Error("User is already pseudonymised.");

  // Block if a pending request already exists
  const existing = await pseudonymizationRepository.findPendingDeletionRequestForUser(userId);
  if (existing) throw new Error("A pending deletion request already exists for this user.");

  if (options.immediate) {
    const request = await pseudonymizationRepository.createDeletionRequest({
      userId,
      trigger: DeletionTriggerEnum.USER_REQUEST,
      effectiveAt: null,
    });
    await pseudonymizeUser(userId, DeletionTriggerEnum.USER_REQUEST, request.id);
    return { requestId: request.id, effectiveAt: null, status: "COMPLETED" };
  }

  const effectiveAt = new Date();
  effectiveAt.setDate(effectiveAt.getDate() + options.gracePeriodDays);

  const request = await pseudonymizationRepository.createDeletionRequest({
    userId,
    trigger: DeletionTriggerEnum.USER_REQUEST,
    effectiveAt,
  });

  return { requestId: request.id, effectiveAt, status: "PENDING" };
}

/**
 * Cancels a pending grace-period deletion request.
 */
export async function cancelPseudonymizationRequest(userId: string): Promise<void> {
  const request = await pseudonymizationRepository.findCancellableUserDeletionRequest(
    userId,
    DeletionTriggerEnum.USER_REQUEST,
  );
  if (!request) throw new Error("No cancellable deletion request found.");

  await pseudonymizationRepository.cancelDeletionRequest(request.id, new Date());
}
