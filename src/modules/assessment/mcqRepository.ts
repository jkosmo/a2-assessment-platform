import { prisma } from "../../db/prisma.js";

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

    // #794: guarded finalization — only completes an attempt that is still open (completedAt IS NULL), so
    // two concurrent submits can't both finalize it. count===0 → already submitted → the caller conflicts.
    completeAttemptGuarded(data: {
      attemptId: string;
      completedAt: Date;
      rawScore: number;
      percentScore: number;
      scaledScore: number;
      // #949: `null` = «ikke aktuelt» — modulen har ingen MCQ-port å bestå. Kolonnen er nullable i
      // skjemaet fra før; det var denne typen som var strengere enn databasen.
      passFailMcq: boolean | null;
    }) {
      return client.mCQAttempt.updateMany({
        where: { id: data.attemptId, completedAt: null },
        data: {
          completedAt: data.completedAt,
          rawScore: data.rawScore,
          percentScore: data.percentScore,
          scaledScore: data.scaledScore,
          passFailMcq: data.passFailMcq,
        },
      });
    },

    // #794: plain row re-read after the guarded finalization (updateMany can't return the row).
    findAttemptById(attemptId: string) {
      return client.mCQAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    },
  };
}

export const mcqRepository = createMcqRepository();
