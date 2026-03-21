import type { ReviewStatus as ReviewStatusType, SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import type { CreateAssessmentDecisionInput } from "../../repositories/decisionRepository.js";
import { prisma } from "../../db/prisma.js";

type ManualReviewRepositoryClient = Pick<typeof prisma, "manualReview" | "assessmentDecision" | "submission">;

export function createManualReviewRepository(client: ManualReviewRepositoryClient = prisma) {
  return {
    findOpenByUserAndModule(userId: string, moduleId: string) {
      return client.manualReview.findMany({
        where: {
          reviewStatus: "OPEN",
          submission: { userId, moduleId },
        },
        select: { id: true, submissionId: true },
      });
    },

    supersedeMany(reviewIds: string[], newSubmissionId: string, supersededAt: Date) {
      return client.manualReview.updateMany({
        where: { id: { in: reviewIds }, reviewStatus: "OPEN" },
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

    markManualReviewClaimed(reviewId: string, reviewerId: string, reviewStatus: ReviewStatusType) {
      return client.manualReview.update({
        where: { id: reviewId },
        data: {
          reviewerId,
          reviewStatus,
        },
      });
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

    resolveManualReview(data: {
      reviewId: string;
      reviewerId: string;
      reviewStatus: ReviewStatusType;
      reviewedAt: Date;
      overrideDecision: string;
      overrideReason: string;
    }) {
      return client.manualReview.update({
        where: { id: data.reviewId },
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
