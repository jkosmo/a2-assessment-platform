import type {
  AppealStatus as AppealStatusType,
  SubmissionStatus as SubmissionStatusType,
} from "@prisma/client";
import type { CreateAssessmentDecisionInput } from "../../repositories/decisionRepository.js";
import { prisma } from "../../db/prisma.js";

type AppealRepositoryClient = Pick<typeof prisma, "appeal" | "submission" | "user" | "assessmentDecision">;

export function createAppealRepository(client: AppealRepositoryClient = prisma) {
  return {
    findOwnedSubmissionWithLatestDecision(submissionId: string, userId: string) {
      return client.submission.findFirst({
        where: {
          id: submissionId,
          userId,
        },
        include: {
          module: {
            select: { title: true },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
          },
        },
      });
    },

    findOpenByUserAndModule(userId: string, moduleId: string) {
      return client.appeal.findMany({
        where: {
          appealStatus: { in: ["OPEN", "IN_REVIEW"] },
          submission: { userId, moduleId },
        },
        select: { id: true, submissionId: true },
      });
    },

    supersedeMany(appealIds: string[], newSubmissionId: string, supersededAt: Date) {
      return client.appeal.updateMany({
        where: { id: { in: appealIds }, appealStatus: { in: ["OPEN", "IN_REVIEW"] } },
        data: {
          appealStatus: "SUPERSEDED",
          resolvedAt: supersededAt,
          resolutionNote: `superseded_by_submission:${newSubmissionId}`,
        },
      });
    },

    findActiveAppealForSubmission(submissionId: string, statuses: AppealStatusType[]) {
      return client.appeal.findFirst({
        where: {
          submissionId,
          appealStatus: { in: statuses },
        },
        select: { id: true },
      });
    },

    createAppeal(data: {
      submissionId: string;
      appealedById: string;
      appealReason: string;
      appealStatus: AppealStatusType;
    }) {
      return client.appeal.create({ data });
    },

    updateSubmissionStatus(submissionId: string, submissionStatus: SubmissionStatusType) {
      return client.submission.update({
        where: { id: submissionId },
        data: { submissionStatus },
      });
    },

    findUserNotificationRecipient(userId: string) {
      return client.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true },
      });
    },

    findAppealsForQueue(statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED" | "SUPERSEDED">, limit: number) {
      return client.appeal.findMany({
        where: { appealStatus: { in: statuses } },
        orderBy: { createdAt: "asc" },
        take: limit,
        include: {
          appealedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          resolvedBy: {
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

    findAppealsForSlaMonitor() {
      return client.appeal.findMany({
        where: {
          appealStatus: { in: ["OPEN", "IN_REVIEW"] },
        },
        select: {
          createdAt: true,
          claimedAt: true,
          resolvedAt: true,
          appealStatus: true,
        },
      });
    },

    findAppealWorkspace(appealId: string) {
      return client.appeal.findUnique({
        where: { id: appealId },
        include: {
          appealedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
            },
          },
          resolvedBy: {
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
              manualReviews: { orderBy: { createdAt: "desc" } },
            },
          },
        },
      });
    },

    findAppealForClaim(appealId: string) {
      return client.appeal.findUnique({
        where: { id: appealId },
        select: {
          id: true,
          submissionId: true,
          appealStatus: true,
          claimedAt: true,
          resolvedById: true,
          appealedBy: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          submission: {
            select: {
              locale: true,
              module: {
                select: { title: true },
              },
            },
          },
        },
      });
    },

    markAppealInReview(appealId: string, handlerId: string, claimedAt?: Date | null) {
      return client.appeal.update({
        where: { id: appealId },
        data: {
          appealStatus: "IN_REVIEW",
          resolvedById: handlerId,
          ...(claimedAt ? {} : { claimedAt: new Date() }),
        },
      });
    },

    findAppealForResolution(appealId: string) {
      return client.appeal.findUnique({
        where: { id: appealId },
        include: {
          appealedBy: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          submission: {
            include: {
              module: {
                select: { title: true },
              },
              decisions: {
                orderBy: { finalisedAt: "desc" },
              },
            },
          },
        },
      });
    },

    createResolutionDecision(data: CreateAssessmentDecisionInput) {
      return client.assessmentDecision.create({ data });
    },

    markAppealResolved(appealId: string, handlerId: string, resolvedAt: Date, resolutionNote: string) {
      return client.appeal.update({
        where: { id: appealId },
        data: {
          appealStatus: "RESOLVED",
          resolvedAt,
          resolvedById: handlerId,
          resolutionNote,
        },
      });
    },
  };
}

export const appealRepository = createAppealRepository();
