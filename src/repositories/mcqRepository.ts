import { prisma } from "../db/prisma.js";

type McqRepositoryClient = Pick<typeof prisma, "submission" | "mCQAttempt" | "mCQQuestion" | "mCQResponse">;

export function createMcqRepository(client: McqRepositoryClient = prisma) {
  return {
    findSubmissionForModuleMcq(submissionId: string, userId: string, moduleId: string) {
      return client.submission.findFirst({
        where: { id: submissionId, userId, moduleId },
        include: { moduleVersion: true },
      });
    },

    findOpenAttemptForSubmission(submissionId: string) {
      return client.mCQAttempt.findFirst({
        where: {
          submissionId,
          completedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
    },

    createAttempt(data: { submissionId: string; mcqSetVersionId: string; startedAt: Date }) {
      return client.mCQAttempt.create({ data });
    },

    findActiveQuestionsForSet(mcqSetVersionId: string) {
      return client.mCQQuestion.findMany({
        where: {
          mcqSetVersionId,
          active: true,
        },
        orderBy: { createdAt: "asc" },
      });
    },

    findAttemptForSubmission(attemptId: string, submissionId: string) {
      return client.mCQAttempt.findFirst({
        where: { id: attemptId, submissionId },
      });
    },

    deleteResponsesForAttempt(mcqAttemptId: string) {
      return client.mCQResponse.deleteMany({ where: { mcqAttemptId } });
    },

    createResponses(data: Array<{
      mcqAttemptId: string;
      questionId: string;
      selectedAnswer: string;
      isCorrect: boolean;
    }>) {
      return client.mCQResponse.createMany({ data });
    },

    completeAttempt(data: {
      attemptId: string;
      completedAt: Date;
      rawScore: number;
      percentScore: number;
      scaledScore: number;
      passFailMcq: boolean;
    }) {
      return client.mCQAttempt.update({
        where: { id: data.attemptId },
        data: {
          completedAt: data.completedAt,
          rawScore: data.rawScore,
          percentScore: data.percentScore,
          scaledScore: data.scaledScore,
          passFailMcq: data.passFailMcq,
        },
      });
    },
  };
}

export const mcqRepository = createMcqRepository();
