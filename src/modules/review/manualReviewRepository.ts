import type { ReviewStatus as ReviewStatusType, SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import type { CreateAssessmentDecisionInput } from "../../repositories/decisionRepository.js";
import { prisma } from "../../db/prisma.js";

type ManualReviewRepositoryClient = Pick<typeof prisma, "manualReview" | "assessmentDecision" | "submission">;

export function createManualReviewRepository(client: ManualReviewRepositoryClient = prisma) {
  return {
    findOpenByUserAndModule(userId: string, moduleId: string) {
      return client.manualReview.findMany({
        where: {
          reviewStatus: { in: ["OPEN", "IN_REVIEW"] },
          submission: { userId, moduleId },
        },
        select: { id: true, submissionId: true },
      });
    },

    supersedeMany(reviewIds: string[], newSubmissionId: string, supersededAt: Date) {
      return client.manualReview.updateMany({
        where: { id: { in: reviewIds }, reviewStatus: { in: ["OPEN", "IN_REVIEW"] } },
        data: {
          reviewStatus: "SUPERSEDED",
          reviewedAt: supersededAt,
          overrideReason: `superseded_by_submission:${newSubmissionId}`,
        },
      });
    },

    findManualReviewQueue(statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "SUPERSEDED">, limit: number) {
      return client.manualReview.findMany({
        where: { reviewStatus: { in: statuses } },
        orderBy: { createdAt: "asc" },
        take: limit,
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
    },

    findManualReviewWorkspace(reviewId: string) {
      return client.manualReview.findUnique({
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
              moduleVersion: {
                select: { id: true },
              },
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
              llmEvaluations: {
                orderBy: { createdAt: "desc" },
                select: {
                  id: true,
                  responseJson: true,
                  rubricTotal: true,
                  practicalScoreScaled: true,
                  passFailPractical: true,
                  manualReviewRecommended: true,
                  confidenceNote: true,
                  evaluatedAt: true,
                  createdAt: true,
                },
              },
              decisions: { orderBy: { finalisedAt: "desc" } },
              appeals: { orderBy: { createdAt: "desc" } },
            },
          },
        },
      });
    },

    findManualReviewForClaim(reviewId: string) {
      return client.manualReview.findUnique({
        where: { id: reviewId },
        select: {
          id: true,
          submissionId: true,
          reviewStatus: true,
          reviewerId: true,
        },
      });
    },

    // #791: atomic guarded claim (same shape as the appeal fix, #790). WHERE encodes the preconditions —
    // not already terminal, and (unless admin takeover) unassigned or ours — so two concurrent claims can't
    // both succeed; the loser gets count 0 and the service raises ConflictError.
    markManualReviewClaimedGuarded(reviewId: string, reviewerId: string, reviewStatus: ReviewStatusType, allowTakeover: boolean) {
      return client.manualReview.updateMany({
        where: {
          id: reviewId,
          reviewStatus: { notIn: ["RESOLVED", "SUPERSEDED"] },
          ...(allowTakeover ? {} : { OR: [{ reviewerId: null }, { reviewerId } ] }),
        },
        data: { reviewerId, reviewStatus },
      });
    },

    // #791: plain row re-read after a guarded transition (updateMany can't return the row).
    findManualReviewById(reviewId: string) {
      return client.manualReview.findUniqueOrThrow({ where: { id: reviewId } });
    },

    findManualReviewForOverride(reviewId: string) {
      return client.manualReview.findUnique({
        where: { id: reviewId },
        include: {
          submission: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                },
              },
              module: {
                select: {
                  title: true,
                },
              },
              decisions: {
                orderBy: { finalisedAt: "desc" },
              },
            },
          },
        },
      });
    },

    createOverrideDecision(data: CreateAssessmentDecisionInput) {
      return client.assessmentDecision.create({ data });
    },

    // #791: atomic guarded resolve. Same guard as the claim; count 0 → another reviewer finalized first →
    // ConflictError rolls the transaction back BEFORE a second MANUAL_OVERRIDE decision is appended.
    resolveManualReviewGuarded(data: {
      reviewId: string;
      reviewerId: string;
      reviewStatus: ReviewStatusType;
      reviewedAt: Date;
      overrideDecision: string;
      overrideReason: string;
      allowTakeover: boolean;
    }) {
      return client.manualReview.updateMany({
        where: {
          id: data.reviewId,
          reviewStatus: { notIn: ["RESOLVED", "SUPERSEDED"] },
          ...(data.allowTakeover ? {} : { OR: [{ reviewerId: null }, { reviewerId: data.reviewerId }] }),
        },
        data: {
          reviewerId: data.reviewerId,
          reviewStatus: data.reviewStatus,
          reviewedAt: data.reviewedAt,
          overrideDecision: data.overrideDecision,
          overrideReason: data.overrideReason,
        },
      });
    },

    updateSubmissionStatus(submissionId: string, submissionStatus: SubmissionStatusType) {
      return client.submission.update({
        where: { id: submissionId },
        data: { submissionStatus },
      });
    },
  };
}

export const manualReviewRepository = createManualReviewRepository();
