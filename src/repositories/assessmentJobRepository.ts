import type { AssessmentJobStatus as AssessmentJobStatusType, SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { prisma } from "../db/prisma.js";

type CreateAssessmentJobInput = {
  submissionId: string;
  status: AssessmentJobStatusType;
  maxAttempts: number;
};

type CreateLlmEvaluationInput = {
  submissionId: string;
  moduleVersionId: string;
  modelName: string;
  promptTemplateVersionId: string;
  requestPayloadHash: string;
  responseJson: string;
  rubricTotal: number;
  practicalScoreScaled: number;
  passFailPractical: boolean;
  manualReviewRecommended: boolean;
  confidenceNote: string;
};

type AssessmentJobRepositoryClient = Pick<typeof prisma, "assessmentJob" | "submission" | "lLMEvaluation">;

export function createAssessmentJobRepository(client: AssessmentJobRepositoryClient = prisma) {
  return {
    findPendingOrRunningJobForSubmission(submissionId: string, statuses: AssessmentJobStatusType[]) {
      return client.assessmentJob.findFirst({
        where: {
          submissionId,
          status: { in: statuses },
        },
      });
    },

    findPendingOrRunningJobIdForSubmission(submissionId: string, statuses: AssessmentJobStatusType[]) {
      return client.assessmentJob.findFirst({
        where: {
          submissionId,
          status: { in: statuses },
        },
        select: { id: true },
      });
    },

    createAssessmentJob(data: CreateAssessmentJobInput) {
      return client.assessmentJob.create({ data });
    },

    findNextRunnableJob(now: Date, maxAttempts: number, submissionId?: string) {
      return client.assessmentJob.findFirst({
        where: {
          ...(submissionId ? { submissionId } : {}),
          status: "PENDING",
          availableAt: { lte: now },
          attempts: { lt: maxAttempts },
        },
        orderBy: { createdAt: "asc" },
      });
    },

    tryLockPendingJob(jobId: string, now: Date, lockedBy: string, leaseExpiresAt: Date) {
      return client.assessmentJob.updateMany({
        where: {
          id: jobId,
          status: "PENDING",
        },
        data: {
          status: "RUNNING",
          lockedAt: now,
          lockedBy,
          leaseExpiresAt,
          attempts: { increment: 1 },
        },
      });
    },

    markJobSucceeded(jobId: string) {
      return client.assessmentJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", errorMessage: null, leaseExpiresAt: null },
      });
    },

    findAssessmentJobOrThrow(jobId: string) {
      return client.assessmentJob.findUniqueOrThrow({ where: { id: jobId } });
    },

    markJobForRetryOrFailure(jobId: string, data: {
      status: AssessmentJobStatusType;
      availableAt: Date;
      errorMessage: string;
    }) {
      return client.assessmentJob.update({
        where: { id: jobId },
        data: { ...data, leaseExpiresAt: null },
      });
    },

    findAssessmentJobWithSubmissionOrThrow(jobId: string) {
      return client.assessmentJob.findUniqueOrThrow({
        where: { id: jobId },
        include: {
          submission: {
            include: {
              user: true,
              moduleVersion: {
                include: {
                  promptTemplateVersion: true,
                  rubricVersion: true,
                  module: true,
                },
              },
              mcqAttempts: { where: { completedAt: { not: null } }, orderBy: { completedAt: "desc" } },
            },
          },
        },
      });
    },

    updateSubmissionStatus(submissionId: string, submissionStatus: SubmissionStatusType) {
      return client.submission.update({
        where: { id: submissionId },
        data: { submissionStatus },
      });
    },

    createLlmEvaluation(data: CreateLlmEvaluationInput) {
      return client.lLMEvaluation.create({ data });
    },

    countJobsByStatus(status: AssessmentJobStatusType) {
      return client.assessmentJob.count({
        where: { status },
      });
    },

    findExpiredRunningJobs(now: Date) {
      return client.assessmentJob.findMany({
        where: {
          status: "RUNNING",
          leaseExpiresAt: { lt: now },
        },
        select: { id: true, attempts: true, maxAttempts: true, submissionId: true },
      });
    },

    findLongRunningJobs(lockedBefore: Date) {
      return client.assessmentJob.findMany({
        where: {
          status: "RUNNING",
          lockedAt: { lt: lockedBefore },
        },
        select: { id: true, submissionId: true, lockedAt: true, lockedBy: true, attempts: true },
      });
    },

    resetExpiredJob(jobId: string, data: {
      status: AssessmentJobStatusType;
      availableAt: Date;
      errorMessage: string;
    }) {
      return client.assessmentJob.update({
        where: { id: jobId },
        data: {
          ...data,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
        },
      });
    },
  };
}

export const assessmentJobRepository = createAssessmentJobRepository();
