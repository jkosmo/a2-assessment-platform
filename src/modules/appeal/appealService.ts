import { AppealStatus, DecisionType, SubmissionStatus } from "../../db/prismaRuntime.js";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";
import { appealRepository, createAppealRepository } from "./appealRepository.js";
import { prisma } from "../../db/prisma.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { buildAppealSlaSnapshot } from "./appealSla.js";
import { notifyAppealStatusTransition } from "../certification/index.js";
import { env } from "../../config/env.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { appendDecisionWithLineage } from "../assessment/decisionLineageService.js";
import { localizeContentText } from "../../i18n/content.js";

export async function createSubmissionAppeal(input: {
  submissionId: string;
  appealedById: string;
  appealReason: string;
}) {
  const submission = await appealRepository.findOwnedSubmissionWithLatestDecision(input.submissionId, input.appealedById);

  if (!submission) {
    throw new NotFoundError("Submission");
  }
  if (!submission.decisions[0]) {
    throw new ConflictError(
      "missing_decision",
      "Submission must have an assessment decision before an appeal can be created.",
    );
  }

  const activeAppeal = await appealRepository.findActiveAppealForSubmission(submission.id, [
    AppealStatus.OPEN,
    AppealStatus.IN_REVIEW,
  ]);

  if (activeAppeal) {
    throw new ConflictError("appeal_already_open", "Submission already has an open or in-review appeal.");
  }

  const appeal = await prisma.$transaction(async (tx) => {
    const txRepo = createAppealRepository(tx);

    const createdAppeal = await txRepo.createAppeal({
      submissionId: submission.id,
      appealedById: input.appealedById,
      appealReason: input.appealReason,
      appealStatus: AppealStatus.OPEN,
    });

    await txRepo.updateSubmissionStatus(submission.id, SubmissionStatus.UNDER_REVIEW);

    await recordAuditEvent({
      entityType: "appeal",
      entityId: createdAppeal.id,
      action: "appeal_created",
      actorId: input.appealedById,
      metadata: {
        submissionId: submission.id,
        appealStatus: createdAppeal.appealStatus,
      },
    }, tx);

    return createdAppeal;
  });

  const appealedBy = await appealRepository.findUserNotificationRecipient(input.appealedById);

  if (appealedBy) {
    const moduleTitle = localizeContentText(env.DEFAULT_LOCALE, submission.module.title) ?? submission.moduleId;
    await safeNotifyAppealStatusTransition({
      appealId: appeal.id,
      submissionId: submission.id,
      previousStatus: null,
      currentStatus: appeal.appealStatus,
      recipientUserId: appealedBy.id,
      recipientEmail: appealedBy.email,
      recipientName: appealedBy.name,
      moduleTitle,
      locale: env.DEFAULT_LOCALE,
    });
  }

  return appeal;
}

export async function listAppealQueue(input: {
  statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED" | "SUPERSEDED">;
  limit: number;
}) {
  const appeals = await appealRepository.findAppealsForQueue(input.statuses, input.limit);

  return appeals.map((appeal) => ({
    sla: buildAppealSlaSnapshot({
      createdAt: appeal.createdAt,
      claimedAt: appeal.claimedAt,
      resolvedAt: appeal.resolvedAt,
      appealStatus: appeal.appealStatus,
    }),
    id: appeal.id,
    appealStatus: appeal.appealStatus,
    appealReason: appeal.appealReason,
    createdAt: appeal.createdAt,
    claimedAt: appeal.claimedAt,
    resolvedAt: appeal.resolvedAt,
    appealedBy: appeal.appealedBy,
    resolvedBy: appeal.resolvedBy,
    submission: {
      id: appeal.submission.id,
      submittedAt: appeal.submission.submittedAt,
      submissionStatus: appeal.submission.submissionStatus,
      user: appeal.submission.user,
      module: appeal.submission.module,
      latestDecision: appeal.submission.decisions[0] ?? null,
    },
  }));
}

export async function getAppealWorkspace(appealId: string) {
  return appealRepository.findAppealWorkspace(appealId);
}

export async function claimAppeal(appealId: string, handlerId: string) {
  const appeal = await appealRepository.findAppealForClaim(appealId);

  if (!appeal) {
    throw new NotFoundError("Appeal");
  }
  if (appeal.appealStatus === AppealStatus.RESOLVED || appeal.appealStatus === AppealStatus.REJECTED || appeal.appealStatus === AppealStatus.SUPERSEDED) {
    throw new ConflictError(
      "appeal_already_resolved",
      "This appeal is already resolved. Refresh the queue to view the latest status.",
    );
  }
  if (
    appeal.appealStatus === AppealStatus.IN_REVIEW &&
    appeal.resolvedById &&
    appeal.resolvedById !== handlerId
  ) {
    throw new ConflictError(
      "appeal_already_assigned",
      "This appeal is already assigned to another handler. Refresh the queue and open another case.",
    );
  }

  const claimed = await appealRepository.markAppealInReview(appealId, handlerId, appeal.claimedAt);

  await recordAuditEvent({
    entityType: "appeal",
    entityId: claimed.id,
    action: "appeal_claimed",
    actorId: handlerId,
    metadata: {
      submissionId: appeal.submissionId,
      appealStatus: claimed.appealStatus,
      claimedAt: claimed.claimedAt?.toISOString() ?? null,
    },
  });

  const claimModuleTitle = localizeContentText(env.DEFAULT_LOCALE, appeal.submission.module.title) ?? appeal.submissionId;
  await safeNotifyAppealStatusTransition({
    appealId: claimed.id,
    submissionId: appeal.submissionId,
    previousStatus: appeal.appealStatus,
    currentStatus: claimed.appealStatus,
    recipientUserId: appeal.appealedBy.id,
    recipientEmail: appeal.appealedBy.email,
    recipientName: appeal.appealedBy.name,
    moduleTitle: claimModuleTitle,
    locale: env.DEFAULT_LOCALE,
  });

  return claimed;
}

export async function resolveAppeal(input: {
  appealId: string;
  handlerId: string;
  passFailTotal: boolean;
  decisionReason: string;
  resolutionNote: string;
}) {
  const appeal = await appealRepository.findAppealForResolution(input.appealId);

  if (!appeal) {
    throw new NotFoundError("Appeal");
  }
  if (appeal.appealStatus === AppealStatus.RESOLVED || appeal.appealStatus === AppealStatus.REJECTED || appeal.appealStatus === AppealStatus.SUPERSEDED) {
    throw new ConflictError(
      "appeal_already_resolved",
      "This appeal is already resolved. Refresh the queue to view the latest status.",
    );
  }
  if (
    appeal.appealStatus === AppealStatus.IN_REVIEW &&
    appeal.resolvedById &&
    appeal.resolvedById !== input.handlerId
  ) {
    throw new ConflictError(
      "appeal_already_assigned",
      "This appeal is already assigned to another handler. Refresh the queue and open another case.",
    );
  }

  const latestDecision = appeal.submission.decisions[0];
  if (!latestDecision) {
    throw new ConflictError(
      "missing_decision",
      "This appeal cannot be resolved yet because the submission has no decision.",
    );
  }

  const finalisedAt = new Date();

  const { resolutionDecision, resolvedAppeal } = await prisma.$transaction(async (tx) => {
    const repo = createAppealRepository(tx);

    const resolutionDecision = await appendDecisionWithLineage(
      {
        parentDecision: latestDecision,
        passFailTotal: input.passFailTotal,
        decisionType: DecisionType.APPEAL_RESOLUTION,
        decisionReason: input.decisionReason,
        finalisedAt,
        finalisedById: input.handlerId,
        actorId: input.handlerId,
        auditAction: "appeal_resolution_decision_created",
        auditMetadata: {
          submissionId: latestDecision.submissionId,
          appealId: appeal.id,
          parentDecisionId: latestDecision.id,
          passFailTotal: input.passFailTotal,
        },
      },
      tx,
    );

    const resolvedAppeal = await repo.markAppealResolved(
      appeal.id,
      input.handlerId,
      finalisedAt,
      input.resolutionNote,
    );

    await recordAuditEvent({
      entityType: "appeal",
      entityId: resolvedAppeal.id,
      action: "appeal_resolved",
      actorId: input.handlerId,
      metadata: {
        submissionId: latestDecision.submissionId,
        resolutionDecisionId: resolutionDecision.id,
        appealStatus: resolvedAppeal.appealStatus,
      },
    }, tx);

    return { resolutionDecision, resolvedAppeal };
  });

  const resolveModuleTitle = localizeContentText(env.DEFAULT_LOCALE, appeal.submission.module.title) ?? latestDecision.submissionId;
  await safeNotifyAppealStatusTransition({
    appealId: resolvedAppeal.id,
    submissionId: latestDecision.submissionId,
    previousStatus: appeal.appealStatus,
    currentStatus: resolvedAppeal.appealStatus,
    recipientUserId: appeal.appealedBy.id,
    recipientEmail: appeal.appealedBy.email,
    recipientName: appeal.appealedBy.name,
    moduleTitle: resolveModuleTitle,
    locale: env.DEFAULT_LOCALE,
  });

  return { appeal: resolvedAppeal, resolutionDecision };
}

export async function cancelSupersededAppeals(userId: string, moduleId: string, newSubmissionId: string) {
  const appeals = await appealRepository.findOpenByUserAndModule(userId, moduleId);
  if (appeals.length === 0) return 0;

  const now = new Date();
  await appealRepository.supersedeMany(appeals.map((a) => a.id), newSubmissionId, now);

  for (const appeal of appeals) {
    await recordAuditEvent({
      entityType: "appeal",
      entityId: appeal.id,
      action: "appeal_superseded",
      actorId: undefined,
      metadata: { newSubmissionId, supersededAt: now.toISOString() },
    });
  }

  return appeals.length;
}

async function safeNotifyAppealStatusTransition(
  input: Parameters<typeof notifyAppealStatusTransition>[0],
) {
  try {
    await notifyAppealStatusTransition(input);
  } catch (error) {
    logOperationalEvent(
      "participant_notification_pipeline_failed",
      {
        appealId: input.appealId,
        submissionId: input.submissionId,
        currentStatus: input.currentStatus,
        recipientUserId: input.recipientUserId,
        recipientEmail: input.recipientEmail,
        errorMessage: error instanceof Error ? error.message : "Unknown notification error",
      },
      "error",
    );
  }
}
