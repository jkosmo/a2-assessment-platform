import { DecisionType, ReviewStatus, SubmissionStatus } from "../../db/prismaRuntime.js";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";
import { manualReviewRepository, createManualReviewRepository } from "./manualReviewRepository.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { appendDecisionWithLineage } from "../assessment/decisionLineageService.js";
import { notifyAssessmentResult } from "../certification/index.js";
import { checkAndIssueCourseCompletions } from "../course/index.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";
import { toManualReviewWorkspaceView } from "./manualReviewReadModels.js";

export async function listManualReviewQueue(input: {
  statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "SUPERSEDED">;
  limit: number;
  locale: string;
}) {
  const reviews = await manualReviewRepository.findManualReviewQueue(input.statuses, input.limit);

  return reviews.map((review) => ({
    id: review.id,
    reviewStatus: review.reviewStatus,
    triggerReason: review.triggerReason,
    createdAt: review.createdAt,
    reviewedAt: review.reviewedAt,
    reviewer: review.reviewer,
    submission: {
      id: review.submission.id,
      submittedAt: review.submission.submittedAt,
      submissionStatus: review.submission.submissionStatus,
      user: review.submission.user,
      module: {
        ...review.submission.module,
        title:
          localizeContentText(normalizeLocale(input.locale) ?? "en-GB", review.submission.module.title) ??
          review.submission.module.title,
      },
      latestDecision: review.submission.decisions[0] ?? null,
    },
  }));
}

export async function getManualReviewWorkspace(reviewId: string) {
  return manualReviewRepository.findManualReviewWorkspace(reviewId);
}

export async function getManualReviewWorkspaceView(reviewId: string, locale: string) {
  const workspace = await getManualReviewWorkspace(reviewId);

  return workspace ? toManualReviewWorkspaceView(workspace, locale) : null;
}

export async function claimManualReview(reviewId: string, reviewerId: string, isAdmin = false) {
  const review = await manualReviewRepository.findManualReviewForClaim(reviewId);
  if (!review) {
    throw new NotFoundError("Manual review");
  }
  if (review.reviewStatus === ReviewStatus.RESOLVED || review.reviewStatus === ReviewStatus.SUPERSEDED) {
    throw new ConflictError("review_already_resolved", "Manual review is already resolved.");
  }
  const previousReviewerId = review.reviewerId;
  if (previousReviewerId && previousReviewerId !== reviewerId) {
    if (!isAdmin) {
      throw new ConflictError("review_already_assigned", "Manual review is already assigned to another reviewer.");
    }
    await recordAuditEvent({
      entityType: auditEntityTypes.manualReview,
      entityId: reviewId,
      action: auditActions.manualReview.adminTakeover,
      actorId: reviewerId,
      metadata: { submissionId: review.submissionId, previousReviewerId, newReviewerId: reviewerId },
    });
  }

  const claimed = await manualReviewRepository.markManualReviewClaimed(reviewId, reviewerId, ReviewStatus.IN_REVIEW);

  await recordAuditEvent({
    entityType: auditEntityTypes.manualReview,
    entityId: claimed.id,
    action: auditActions.manualReview.claimed,
    actorId: reviewerId,
    metadata: {
      submissionId: review.submissionId,
      reviewStatus: claimed.reviewStatus,
    },
  });

  return claimed;
}

export async function finalizeManualReviewOverride(input: {
  reviewId: string;
  reviewerId: string;
  passFailTotal: boolean;
  decisionReason: string;
  overrideReason: string;
  isAdmin?: boolean;
}) {
  const review = await manualReviewRepository.findManualReviewForOverride(input.reviewId);
  if (!review) {
    throw new NotFoundError("Manual review");
  }
  if (review.reviewStatus === ReviewStatus.RESOLVED || review.reviewStatus === ReviewStatus.SUPERSEDED) {
    throw new ConflictError("review_already_resolved", "Manual review is already resolved.");
  }
  if (review.reviewerId && review.reviewerId !== input.reviewerId) {
    if (!input.isAdmin) {
      throw new ConflictError("review_already_assigned", "Manual review is already assigned to another reviewer.");
    }
    await recordAuditEvent({
      entityType: auditEntityTypes.manualReview,
      entityId: input.reviewId,
      action: auditActions.manualReview.adminTakeover,
      actorId: input.reviewerId,
      metadata: { submissionId: review.submissionId, previousReviewerId: review.reviewerId, newReviewerId: input.reviewerId },
    });
  }

  const latestDecision = review.submission.decisions[0];
  if (!latestDecision) {
    throw new ConflictError("missing_decision", "Cannot override review because no decision exists for submission.");
  }

  const finalisedAt = new Date();

  const { overrideDecision, resolvedReview } = await finalizeManualReviewOverrideCommand(
    review,
    input,
    latestDecision,
    finalisedAt,
  );

  const submissionLocale = normalizeLocale(review.submission.locale) ?? "en-GB";
  const moduleTitle = localizeContentText(submissionLocale, review.submission.module.title) ?? review.submission.moduleId;
  notifyAssessmentResult({
    submissionId: review.submission.id,
    submittedAt: review.submission.submittedAt,
    recipientEmail: review.submission.user.email,
    recipientName: review.submission.user.name,
    moduleTitle,
    moduleId: review.submission.moduleId,
    passFailTotal: input.passFailTotal,
    locale: submissionLocale,
  }).catch((error: unknown) => {
    logOperationalEvent(
      operationalEvents.certification.participantNotificationPipelineFailed,
      {
        submissionId: review.submission.id,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  });

  checkAndIssueCourseCompletions({
    userId: review.submission.userId,
    moduleId: review.submission.moduleId,
  }).catch((error: unknown) => {
    logOperationalEvent(
      operationalEvents.course.completionCheckFailed,
      {
        userId: review.submission.userId,
        moduleId: review.submission.moduleId,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  });

  return { review: resolvedReview, overrideDecision };
}

type OverrideReview = NonNullable<Awaited<ReturnType<typeof manualReviewRepository.findManualReviewForOverride>>>;
type LatestDecision = NonNullable<OverrideReview["submission"]["decisions"][number]>;

async function finalizeManualReviewOverrideCommand(
  review: OverrideReview,
  input: { reviewerId: string; passFailTotal: boolean; decisionReason: string; overrideReason: string },
  latestDecision: LatestDecision,
  finalisedAt: Date,
) {
  return runInTransaction(async (tx) => {
    const repo = createManualReviewRepository(tx);

    const overrideDecision = await appendDecisionWithLineage(
      {
        parentDecision: latestDecision,
        passFailTotal: input.passFailTotal,
        decisionType: DecisionType.MANUAL_OVERRIDE,
        decisionReason: input.decisionReason,
        finalisedAt,
        finalisedById: input.reviewerId,
        actorId: input.reviewerId,
        auditAction: auditActions.manualReview.overrideDecisionCreated,
        auditMetadata: {
          submissionId: latestDecision.submissionId,
          reviewId: review.id,
          parentDecisionId: latestDecision.id,
          passFailTotal: input.passFailTotal,
        },
      },
      tx,
    );

    const resolvedReview = await repo.resolveManualReview({
      reviewId: review.id,
      reviewerId: input.reviewerId,
      reviewStatus: ReviewStatus.RESOLVED,
      reviewedAt: finalisedAt,
      overrideDecision: input.passFailTotal ? "PASS" : "FAIL",
      overrideReason: input.overrideReason,
    });

    await recordAuditEvent({
      entityType: auditEntityTypes.manualReview,
      entityId: resolvedReview.id,
      action: auditActions.manualReview.resolved,
      actorId: input.reviewerId,
      metadata: {
        submissionId: latestDecision.submissionId,
        overrideDecisionId: overrideDecision.id,
        overrideDecision: resolvedReview.overrideDecision,
      },
    }, tx);

    return { overrideDecision, resolvedReview };
  });
}

type SupersedeTxClient = Pick<DbTransactionClient, "manualReview" | "assessmentDecision" | "submission" | "auditEvent">;

export async function supersedeEligibleReviewsForRetake(
  userId: string,
  moduleId: string,
  newSubmissionId: string,
  tx: SupersedeTxClient,
): Promise<number> {
  const repo = createManualReviewRepository(tx);
  const reviews = await repo.findOpenByUserAndModule(userId, moduleId);
  if (reviews.length === 0) return 0;

  const now = new Date();
  await repo.supersedeMany(reviews.map((r) => r.id), newSubmissionId, now);

  for (const review of reviews) {
    await repo.updateSubmissionStatus(review.submissionId, SubmissionStatus.COMPLETED);
    await recordAuditEvent({
      entityType: auditEntityTypes.manualReview,
      entityId: review.id,
      action: auditActions.manualReview.superseded,
      actorId: undefined,
      metadata: { newSubmissionId, supersededAt: now.toISOString() },
    }, tx);
  }

  return reviews.length;
}
