import { DecisionType, ReviewStatus, SubmissionStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import { ConflictError, NotFoundError } from "../errors/AppError.js";
import { recordAuditEvent } from "./auditService.js";
import { upsertRecertificationStatusFromDecision } from "./recertificationService.js";

export async function listManualReviewQueue(input: {
  statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED">;
  limit: number;
}) {
  const reviews = await prisma.manualReview.findMany({
    where: { reviewStatus: { in: input.statuses } },
    orderBy: { createdAt: "asc" },
    take: input.limit,
    include: {
      reviewer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      submission: {
        select: {
          id: true,
          submittedAt: true,
          submissionStatus: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
            },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: {
              id: true,
              decisionType: true,
              passFailTotal: true,
              totalScore: true,
              finalisedAt: true,
            },
          },
        },
      },
    },
  });

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
      module: review.submission.module,
      latestDecision: review.submission.decisions[0] ?? null,
    },
  }));
}

export async function getManualReviewWorkspace(reviewId: string) {
  return prisma.manualReview.findUnique({
    where: { id: reviewId },
    include: {
      reviewer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      submission: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
              description: true,
            },
          },
          moduleVersion: true,
          mcqAttempts: {
            orderBy: { completedAt: "desc" },
            include: {
              responses: {
                include: {
                  question: {
                    select: {
                      id: true,
                      stem: true,
                    },
                  },
                },
              },
            },
          },
          llmEvaluations: { orderBy: { createdAt: "desc" } },
          decisions: { orderBy: { finalisedAt: "desc" } },
          appeals: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
}

export async function claimManualReview(reviewId: string, reviewerId: string) {
  const review = await prisma.manualReview.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      submissionId: true,
      reviewStatus: true,
      reviewerId: true,
    },
  });
  if (!review) {
    throw new NotFoundError("Manual review");
  }
  if (review.reviewStatus === ReviewStatus.RESOLVED) {
    throw new ConflictError("review_already_resolved", "Manual review is already resolved.");
  }
  if (review.reviewerId && review.reviewerId !== reviewerId) {
    throw new ConflictError("review_already_assigned", "Manual review is already assigned to another reviewer.");
  }

  const claimed = await prisma.manualReview.update({
    where: { id: reviewId },
    data: {
      reviewerId,
      reviewStatus: ReviewStatus.IN_REVIEW,
    },
  });

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
  const review = await prisma.manualReview.findUnique({
    where: { id: input.reviewId },
    include: {
      submission: {
        include: {
          decisions: {
            orderBy: { finalisedAt: "desc" },
          },
        },
      },
    },
  });
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
  const overrideDecision = await prisma.assessmentDecision.create({
    data: {
      submissionId: latestDecision.submissionId,
      moduleVersionId: latestDecision.moduleVersionId,
      rubricVersionId: latestDecision.rubricVersionId,
      promptTemplateVersionId: latestDecision.promptTemplateVersionId,
      mcqScaledScore: latestDecision.mcqScaledScore,
      practicalScaledScore: latestDecision.practicalScaledScore,
      totalScore: latestDecision.totalScore,
      redFlagsJson: latestDecision.redFlagsJson,
      passFailTotal: input.passFailTotal,
      decisionType: DecisionType.MANUAL_OVERRIDE,
      decisionReason: input.decisionReason,
      finalisedAt,
      finalisedById: input.reviewerId,
      parentDecisionId: latestDecision.id,
    },
  });

  const resolvedReview = await prisma.manualReview.update({
    where: { id: review.id },
    data: {
      reviewerId: input.reviewerId,
      reviewStatus: ReviewStatus.RESOLVED,
      reviewedAt: finalisedAt,
      overrideDecision: input.passFailTotal ? "PASS" : "FAIL",
      overrideReason: input.overrideReason,
    },
  });

  await prisma.submission.update({
    where: { id: latestDecision.submissionId },
    data: { submissionStatus: SubmissionStatus.COMPLETED },
  });

  await upsertRecertificationStatusFromDecision({
    decisionId: overrideDecision.id,
    actorId: input.reviewerId,
  });

  await recordAuditEvent({
    entityType: "assessment_decision",
    entityId: overrideDecision.id,
    action: "manual_override_decision_created",
    actorId: input.reviewerId,
    metadata: {
      submissionId: latestDecision.submissionId,
      reviewId: review.id,
      parentDecisionId: latestDecision.id,
      passFailTotal: overrideDecision.passFailTotal,
    },
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
  });

  return { review: resolvedReview, overrideDecision };
}
