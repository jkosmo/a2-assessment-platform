import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

type CreateSubmissionInput = {
  userId: string;
  moduleId: string;
  moduleVersionId: string;
  locale: string;
  deliveryType: string;
  responseJson: string;
  attachmentUri?: string;
  submissionStatus: SubmissionStatusType;
};

type SubmissionRepositoryClient = Pick<typeof prisma, "submission">;

export function createSubmissionRepository(client: SubmissionRepositoryClient = prisma) {
  return {
    create(data: CreateSubmissionInput) {
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

export async function queryLatestSubmissionsForModules(userId: string, moduleIds: string[]) {
  return prisma.submission.findMany({
    where: { userId, moduleId: { in: moduleIds } },
    orderBy: [{ moduleId: "asc" }, { submittedAt: "desc" }],
    select: {
      id: true,
      moduleId: true,
      submittedAt: true,
      submissionStatus: true,
      decisions: {
        orderBy: { finalisedAt: "desc" },
        take: 1,
        select: {
          totalScore: true,
          passFailTotal: true,
          decisionType: true,
          finalisedAt: true,
        },
      },
    },
  });
}

export async function queryCompletedSubmissionsForUser(
  userId: string,
  statuses: SubmissionStatusType[],
  limit: number,
) {
  return prisma.submission.findMany({
    where: { userId, submissionStatus: { in: statuses } },
    orderBy: { submittedAt: "desc" },
    take: limit,
    select: {
      id: true,
      moduleId: true,
      submittedAt: true,
      submissionStatus: true,
      module: { select: { id: true, title: true } },
      decisions: {
        orderBy: { finalisedAt: "desc" },
        take: 1,
        select: {
          totalScore: true,
          passFailTotal: true,
          decisionType: true,
          finalisedAt: true,
        },
      },
    },
  });
}

export async function getModuleWithActiveVersion(moduleId: string) {
  return prisma.module.findUnique({
    where: { id: moduleId },
    include: { activeVersion: true },
  });
}
