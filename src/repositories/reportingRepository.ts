import { prisma } from "../db/prisma.js";
import type {
  AppealStatus as AppealStatusType,
  ReviewStatus as ReviewStatusType,
  SubmissionStatus as SubmissionStatusType,
} from "@prisma/client";

type ReportingRepositoryClient = Pick<
  typeof prisma,
  "submission" | "manualReview" | "appeal" | "mCQResponse" | "certificationStatus"
>;

export function createReportingRepository(client: ReportingRepositoryClient = prisma) {
  return {
    findSubmissionsForCompletionReport(where: object) {
      return client.submission.findMany({
        where,
        select: {
          moduleId: true,
          submissionStatus: true,
          module: { select: { id: true, title: true } },
        },
      });
    },

    findSubmissionsForPassRatesReport(where: object) {
      return client.submission.findMany({
        where,
        select: {
          id: true,
          submissionStatus: true,
          module: { select: { id: true, title: true } },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: {
              passFailTotal: true,
            },
          },
        },
      });
    },

    findManualReviewsForQueueReport(input: {
      statuses: ReviewStatusType[];
      moduleId?: string;
      orgUnit?: string;
      dateFrom?: Date;
      dateTo?: Date;
    }) {
      return client.manualReview.findMany({
        where: {
          ...(input.statuses.length > 0 ? { reviewStatus: { in: input.statuses } } : {}),
          ...(input.dateFrom || input.dateTo
            ? {
                createdAt: {
                  ...(input.dateFrom ? { gte: input.dateFrom } : {}),
                  ...(input.dateTo ? { lte: input.dateTo } : {}),
                },
              }
            : {}),
          submission: {
            ...(input.moduleId ? { moduleId: input.moduleId } : {}),
            ...(input.orgUnit ? { user: { department: input.orgUnit } } : {}),
          },
        },
        orderBy: { createdAt: "asc" },
        include: {
          submission: {
            select: {
              id: true,
              submissionStatus: true,
              user: {
                select: {
                  email: true,
                  department: true,
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
                  decisionType: true,
                  passFailTotal: true,
                },
              },
            },
          },
        },
      });
    },

    findAppealsForReport(input: {
      statuses: AppealStatusType[];
      moduleId?: string;
      orgUnit?: string;
      dateFrom?: Date;
      dateTo?: Date;
    }) {
      return client.appeal.findMany({
        where: {
          ...(input.statuses.length > 0 ? { appealStatus: { in: input.statuses } } : {}),
          ...(input.dateFrom || input.dateTo
            ? {
                createdAt: {
                  ...(input.dateFrom ? { gte: input.dateFrom } : {}),
                  ...(input.dateTo ? { lte: input.dateTo } : {}),
                },
              }
            : {}),
          submission: {
            ...(input.moduleId ? { moduleId: input.moduleId } : {}),
            ...(input.orgUnit ? { user: { department: input.orgUnit } } : {}),
          },
        },
        orderBy: { createdAt: "asc" },
        include: {
          appealedBy: {
            select: {
              email: true,
            },
          },
          resolvedBy: {
            select: {
              email: true,
            },
          },
          submission: {
            select: {
              id: true,
              user: {
                select: {
                  email: true,
                  department: true,
                },
              },
              module: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
        },
      });
    },

    findMcqResponsesForQualityReport(where: object) {
      return client.mCQResponse.findMany({
        where,
        select: {
          questionId: true,
          isCorrect: true,
          question: {
            select: {
              id: true,
              stem: true,
              module: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
          mcqAttempt: {
            select: {
              id: true,
              percentScore: true,
            },
          },
        },
      });
    },

    findCertificationsForStatusReport(input: {
      moduleId?: string;
      orgUnit?: string;
      dateFrom?: Date;
      dateTo?: Date;
    }) {
      return client.certificationStatus.findMany({
        where: {
          ...(input.moduleId ? { moduleId: input.moduleId } : {}),
          ...(input.orgUnit ? { user: { department: input.orgUnit } } : {}),
          ...(input.dateFrom || input.dateTo
            ? {
                updatedAt: {
                  ...(input.dateFrom ? { gte: input.dateFrom } : {}),
                  ...(input.dateTo ? { lte: input.dateTo } : {}),
                },
              }
            : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              department: true,
            },
          },
          module: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: [{ moduleId: "asc" }, { updatedAt: "desc" }],
      });
    },

    findSubmissionsForAnalyticsSemanticModel(where: object) {
      return client.submission.findMany({
        where,
        select: {
          id: true,
          submissionStatus: true,
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: { passFailTotal: true },
          },
          appeals: {
            select: { id: true },
          },
        },
      });
    },

    findSubmissionsForAnalyticsTrends(where: object) {
      return client.submission.findMany({
        where,
        select: {
          submittedAt: true,
          submissionStatus: true,
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: { passFailTotal: true },
          },
        },
      });
    },

    findSubmissionsForAnalyticsCohorts(where: object) {
      return client.submission.findMany({
        where,
        select: {
          userId: true,
          submittedAt: true,
          submissionStatus: true,
          user: {
            select: {
              department: true,
            },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: { passFailTotal: true },
          },
        },
      });
    },

    findSubmissionsForDataQuality(where: object) {
      return client.submission.findMany({
        where,
        select: {
          id: true,
          submissionStatus: true,
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: { id: true },
          },
          llmEvaluations: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });
    },
  };
}

export const reportingRepository = createReportingRepository();
