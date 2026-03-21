import { prisma } from "../../db/prisma.js";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";

type CalibrationRepositoryClient = Pick<typeof prisma, "module" | "submission" | "promptTemplateVersion">;

export function createCalibrationRepository(client: CalibrationRepositoryClient = prisma) {
  return {
    findModuleSummary(moduleId: string) {
      return client.module.findUnique({
        where: { id: moduleId },
        select: {
          id: true,
          title: true,
          activeVersionId: true,
          activeVersion: {
            select: {
              id: true,
              versionNo: true,
              assessmentPolicyJson: true,
              rubricVersionId: true,
              promptTemplateVersionId: true,
              mcqSetVersionId: true,
              taskText: true,
              guidanceText: true,
              submissionSchemaJson: true,
            },
          },
        },
      });
    },

    findSubmissionsForWorkspace(input: {
      moduleId: string;
      moduleVersionId?: string;
      statuses: SubmissionStatusType[];
      dateFrom?: Date;
      dateTo?: Date;
      limit: number;
    }) {
      return client.submission.findMany({
        where: {
          moduleId: input.moduleId,
          ...(input.moduleVersionId ? { moduleVersionId: input.moduleVersionId } : {}),
          ...(input.statuses.length > 0 ? { submissionStatus: { in: input.statuses } } : {}),
          ...(input.dateFrom || input.dateTo
            ? {
                submittedAt: {
                  ...(input.dateFrom ? { gte: input.dateFrom } : {}),
                  ...(input.dateTo ? { lte: input.dateTo } : {}),
                },
              }
            : {}),
        },
        orderBy: { submittedAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          submittedAt: true,
          submissionStatus: true,
          moduleVersion: {
            select: {
              id: true,
              versionNo: true,
              promptTemplateVersionId: true,
            },
          },
          user: {
            select: {
              id: true,
            },
          },
          decisions: {
            orderBy: { finalisedAt: "desc" },
            take: 1,
            select: {
              decisionType: true,
              totalScore: true,
              passFailTotal: true,
              practicalScaledScore: true,
              mcqScaledScore: true,
              finalisedAt: true,
              redFlagsJson: true,
            },
          },
          llmEvaluations: {
            orderBy: { evaluatedAt: "desc" },
            take: 1,
            select: {
              manualReviewRecommended: true,
              confidenceNote: true,
              evaluatedAt: true,
            },
          },
          mcqAttempts: {
            where: {
              completedAt: { not: null },
            },
            orderBy: { completedAt: "desc" },
            take: 1,
            select: {
              percentScore: true,
              scaledScore: true,
              passFailMcq: true,
              completedAt: true,
            },
          },
        },
      });
    },

    findPromptTemplateVersionsForBenchmarkAnchors(moduleId: string) {
      return client.promptTemplateVersion.findMany({
        where: { moduleId },
        orderBy: { versionNo: "desc" },
        select: {
          id: true,
          versionNo: true,
          createdAt: true,
          examplesJson: true,
        },
      });
    },
  };
}

export const calibrationRepository = createCalibrationRepository();
