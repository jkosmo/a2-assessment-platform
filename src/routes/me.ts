import { Router } from "express";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "../i18n/locale.js";
import { USER_DELETION_GRACE_PERIOD_DAYS } from "../config/retention.js";
import { prisma } from "../db/prisma.js";
import { getConsentConfig, getActiveConsentVersion } from "../modules/platformConfig/consentConfigService.js";
import {
  requestPseudonymization,
  cancelPseudonymizationRequest,
} from "../modules/user/pseudonymizationService.js";
import { AppError } from "../errors/AppError.js";

const meRouter = Router();

// ── GET /api/me ─────────────────────────────────────────────────────────────
// Profile + consent status. Used by the frontend on every page load to decide
// whether to show the consent dialog.
meRouter.get("/", async (request, response, next) => {
  const principal = request.context?.principal;
  const userId = request.context?.userId;
  if (!principal || !userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const [consentVersion, pendingDeletion] = await Promise.all([
      getActiveConsentVersion(),
      prisma.deletionRequest.findFirst({
        where: { userId, status: "PENDING" },
        select: { effectiveAt: true, trigger: true },
      }),
    ]);

    const consent = await prisma.userConsent.findUnique({
      where: { userId_consentVersion: { userId, consentVersion } },
      select: { acceptedAt: true },
    });

    response.json({
      user: {
        externalId: principal.externalId,
        email: principal.email,
        name: principal.name,
        department: principal.department,
        roles: request.context?.roles ?? [],
        locale: request.context?.locale ?? "en-GB",
      },
      consent: {
        currentVersion: consentVersion,
        accepted: !!consent,
        acceptedAt: consent?.acceptedAt ?? null,
      },
      pendingDeletion: pendingDeletion
        ? { effectiveAt: pendingDeletion.effectiveAt, trigger: pendingDeletion.trigger }
        : null,
      supportedLocales: SUPPORTED_LOCALES,
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/me/consent ──────────────────────────────────────────────────────
// Returns consent config text for the current locale so the frontend can
// render the dialog without embedding text in HTML.
meRouter.get("/consent", async (request, response, next) => {
  const locale = request.context?.locale ?? "en-GB";
  try {
    const config = await getConsentConfig(locale);
    response.json(config);
  } catch (error) {
    next(error);
  }
});

// ── POST /api/me/consent ─────────────────────────────────────────────────────
// Records the user's acceptance of the current consent version.
// Exempt from the requireConsent middleware (it's the consent submission itself).
meRouter.post("/consent", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const bodySchema = z.object({ consentVersion: z.string() });
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", message: "consentVersion is required." });
    return;
  }

  try {
    const consentVersion = await getActiveConsentVersion();
    if (parsed.data.consentVersion !== consentVersion) {
      response.status(409).json({
        error: "consent_version_mismatch",
        message: `Expected version ${consentVersion}.`,
      });
      return;
    }

    await prisma.userConsent.upsert({
      where: { userId_consentVersion: { userId, consentVersion } },
      create: { userId, consentVersion },
      update: {},
    });
    response.json({ accepted: true, consentVersion });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/me/data ─────────────────────────────────────────────────────────
// Full personal data export (innsyn). Returns all data stored about the user.
meRouter.get("/data", async (request, response, next) => {
  const userId = request.context?.userId;
  const principal = request.context?.principal;
  if (!userId || !principal) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const [user, submissions, appeals, consents, deletionRequests, accessLog] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, email: true, department: true, manager: true,
          activeStatus: true, lastLoginAt: true, createdAt: true, isAnonymized: true,
          roleAssignments: {
            select: { appRole: true, validFrom: true, validTo: true, createdAt: true, createdBy: true },
          },
          certifications: {
            select: { moduleId: true, status: true, passedAt: true, expiryDate: true, updatedAt: true },
          },
        },
      }),
      prisma.submission.findMany({
        where: { userId },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true, moduleId: true, locale: true, deliveryType: true,
          responseJson: true, submittedAt: true, submissionStatus: true,
          decisions: {
            select: {
              id: true, decisionType: true, passFailTotal: true, decisionReason: true,
              totalScore: true, finalisedAt: true,
            },
          },
        },
      }),
      prisma.appeal.findMany({
        where: { appealedById: userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, submissionId: true, appealStatus: true, appealReason: true,
          createdAt: true, resolvedAt: true, resolutionNote: true,
        },
      }),
      prisma.userConsent.findMany({
        where: { userId },
        orderBy: { acceptedAt: "desc" },
        select: { consentVersion: true, acceptedAt: true },
      }),
      prisma.deletionRequest.findMany({
        where: { userId },
        orderBy: { requestedAt: "desc" },
        select: { status: true, trigger: true, requestedAt: true, effectiveAt: true, anonymizedAt: true },
      }),
      // Access log: audit events where someone viewed this user's submissions
      prisma.auditEvent.findMany({
        where: {
          entityType: { in: ["submission", "appeal", "manual_review"] },
          action: { in: ["submission_viewed", "result_viewed", "appeal_viewed"] },
          entityId: {
            in: await prisma.submission.findMany({ where: { userId }, select: { id: true } })
              .then((rows) => rows.map((r) => r.id)),
          },
        },
        orderBy: { timestamp: "desc" },
        select: { entityType: true, entityId: true, action: true, actorId: true, timestamp: true },
      }),
    ]);

    response.json({
      exportedAt: new Date().toISOString(),
      profile: user,
      submissions,
      appeals,
      consentHistory: consents,
      deletionHistory: deletionRequests,
      accessLog,
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/me/deletion ────────────────────────────────────────────────────
// Request pseudonymisation. Body: { immediate: boolean }
meRouter.post("/deletion", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const bodySchema = z.object({ immediate: z.boolean() });
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "invalid_request", message: "immediate (boolean) is required." });
    return;
  }

  try {
    const result = await requestPseudonymization(userId, {
      immediate: parsed.data.immediate,
      gracePeriodDays: USER_DELETION_GRACE_PERIOD_DAYS,
    });
    response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already pseudonymised")) {
      next(new AppError("already_pseudonymized", 409, error.message));
    } else if (error instanceof Error && error.message.includes("pending deletion request")) {
      next(new AppError("deletion_request_exists", 409, error.message));
    } else {
      next(error);
    }
  }
});

// ── DELETE /api/me/deletion ──────────────────────────────────────────────────
// Cancel a pending grace-period deletion request.
meRouter.delete("/deletion", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    await cancelPseudonymizationRequest(userId);
    response.json({ cancelled: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes("No cancellable")) {
      next(new AppError("no_pending_deletion", 404, error.message));
    } else {
      next(error);
    }
  }
});

export { meRouter };
