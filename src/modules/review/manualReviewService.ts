import { DecisionType, ReviewStatus } from "../../db/prismaRuntime.js";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";
import { manualReviewRepository, createManualReviewRepository } from "./manualReviewRepository.js";
import { prisma } from "../../db/prisma.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { appendDecisionWithLineage } from "../../services/decisionLineageService.js";
import { notifyAssessmentResult } from "../../services/participantNotificationService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";

export async function listManualReviewQueue(input: {
  statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED">;
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

export async function claimManualReview(reviewId: string, reviewerId: string) {
  const review = await manualReviewRepository.findManualReviewForClaim(reviewId);
  if (!review) {
    throw new NotFoundError("Manual review");
  }
  if (review.reviewStatus === ReviewStatus.RESOLVED) {
    throw new ConflictError("review_already_resolved", "Manual review is already resolved.");
  }
  if (review.reviewerId && review.reviewerId !== reviewerId) {
    throw new ConflictError("review_already_assigned", "Manual review is already assigned to another reviewer.");
  }

  const claimed = await manualReviewRepository.markManualReviewClaimed(reviewId, reviewerId, ReviewStatus.IN_REVIEW);

  await recordAuditEvent({
    entityType: "manual_review",
    entityId: claimed.id,
    action: "manual_review_claimed",
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
}) {
  const review = await manualReviewRepository.findManualReviewForOverride(input.reviewId);
  if (!review) {
    throw new NotFoundError("Manual review");
  }
  if (review.reviewStatus === ReviewStatus.RESOLVED) {
    throw new ConflictError("review_already_resolved", "Manual review is already resolved.");
  }
  if (review.reviewerId && review.reviewerId !== input.reviewerId) {
    throw new ConflictError("review_already_assigned", "Manual review is already assigned to another reviewer.");
  }

  const latestDecision = review.submission.decisions[0];
  if (!latestDecision) {
    throw new ConflictError("missing_decision", "Cannot override review because no decision exists for submission.");
  }

  const finalisedAt = new Date();

  const { overrideDecision, resolvedReview } = await prisma.$transaction(async (tx) => {
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
        auditAction: "manual_override_decision_created",
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
      entityType: "manual_review",
      entityId: resolvedReview.id,
      action: "manual_review_resolved",
      actorId: input.reviewerId,
      metadata: {
        submissionId: latestDecision.submissionId,
        overrideDecisionId: overrideDecision.id,
        overrideDecision: resolvedReview.overrideDecision,
      },
    }, tx);

    return { overrideDecision, resolvedReview };
  });

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
      "participant_notification_failed",
      {
        submissionId: review.submission.id,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  });

  return { review: resolvedReview, overrideDecision };
}
