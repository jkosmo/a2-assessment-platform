import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

type SubmissionRepositoryClient = Pick<typeof prisma, "submission">;

export function createSubmissionRepository(client: SubmissionRepositoryClient = prisma) {
  return {
    create(data: Prisma.SubmissionUncheckedCreateInput) {
      return client.submission.create({ data });
    },

    findOwnedSubmission(submissionId: string, userId: string) {
      return client.submission.findFirst({
        where: { id: submissionId, userId },
        include: {
          moduleVersion: true,
          appeals: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              appealStatus: true,
              createdAt: true,
              resolvedAt: true,
            },
          },
          mcqAttempts: {
            orderBy: { createdAt: "desc" },
            include: { responses: true },
          },
          llmEvaluations: { orderBy: { createdAt: "desc" } },
          decisions: { orderBy: { finalisedAt: "desc" } },
        },
      });
    },

    findSubmissionForAssessmentView(submissionId: string, userId: string) {
      return client.submission.findFirst({
        where: { id: submissionId, userId },
        include: {
          assessmentJobs: { orderBy: { createdAt: "desc" } },
          llmEvaluations: { orderBy: { createdAt: "desc" } },
          decisions: { orderBy: { finalisedAt: "desc" } },
        },
      });
    },

    findOwnedSubmissionHistory(userId: string, limit: number) {
      return client.submission.findMany({
        where: { userId },
        orderBy: { submittedAt: "desc" },
        take: limit,
        include: {
          module: {
            select: {
              id: true,
              title: true,
            },
          },
          mcqAttempts: {
            where: { completedAt: { not: null } },
            orderBy: { completedAt: "desc" },
            take: 1,
            select: {
              id: true,
              scaledScore: true,
              percentScore: true,
              passFailMcq: true,
              completedAt: true,
            },
          },
          llmEvaluations: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              practicalScoreScaled: true,
              passFailPractical: true,
              manualReviewRecommended: true,
              createdAt: true,
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
              decisionReason: true,
              finalisedAt: true,
            },
          },
        },
      });
    },
  };
}

export const submissionRepository = createSubmissionRepository();
