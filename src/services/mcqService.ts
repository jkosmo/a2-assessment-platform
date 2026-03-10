import { SubmissionStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import { getAssessmentRules } from "../config/assessmentRules.js";
import { enqueueAssessmentJob } from "./assessmentJobService.js";
import { recordAuditEvent } from "./auditService.js";
import type { SupportedLocale } from "../i18n/locale.js";
import {
  localizeContentArray,
  localizeContentText,
  matchesLocalizedContentVariant,
} from "../i18n/content.js";

export async function startMcqAttempt(
  moduleId: string,
  submissionId: string,
  userId: string,
  locale: SupportedLocale = "en-GB",
) {
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId, moduleId },
    include: { moduleVersion: true },
  });

  if (!submission) {
    throw new Error("Submission not found for module.");
  }

  let attempt = await prisma.mCQAttempt.findFirst({
    where: {
      submissionId: submission.id,
      completedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!attempt) {
    attempt = await prisma.mCQAttempt.create({
      data: {
        submissionId: submission.id,
        mcqSetVersionId: submission.moduleVersion.mcqSetVersionId,
        startedAt: new Date(),
      },
    });
  }

  const questions = await prisma.mCQQuestion.findMany({
    where: {
      mcqSetVersionId: attempt.mcqSetVersionId,
      active: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    attemptId: attempt.id,
    questions: questions.map((question) => ({
      id: question.id,
      stem: localizeContentText(locale, question.stem) ?? question.stem,
      options: localizeContentArray(locale, JSON.parse(question.optionsJson) as unknown[]),
    })),
  };
}

export async function submitMcqAttempt(input: {
  moduleId: string;
  submissionId: string;
  attemptId: string;
  userId: string;
  responses: Array<{ questionId: string; selectedAnswer: string }>;
}) {
  const submission = await prisma.submission.findFirst({
    where: { id: input.submissionId, userId: input.userId, moduleId: input.moduleId },
    include: { moduleVersion: true },
  });
  if (!submission) {
    throw new Error("Submission not found for module.");
  }

  const attempt = await prisma.mCQAttempt.findFirst({
    where: { id: input.attemptId, submissionId: submission.id },
  });
  if (!attempt) {
    throw new Error("MCQ attempt not found.");
  }
  if (attempt.completedAt) {
    throw new Error("MCQ attempt already submitted.");
  }

  const questions = await prisma.mCQQuestion.findMany({
    where: { mcqSetVersionId: attempt.mcqSetVersionId, active: true },
  });

  const questionById = new Map(questions.map((question) => [question.id, question]));
  const evaluated = input.responses
    .map((response) => {
      const question = questionById.get(response.questionId);
      if (!question) {
        return null;
      }
      return {
        questionId: response.questionId,
        selectedAnswer: response.selectedAnswer,
        isCorrect: matchesLocalizedContentVariant(question.correctAnswer, response.selectedAnswer),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  await prisma.mCQResponse.deleteMany({ where: { mcqAttemptId: attempt.id } });
  if (evaluated.length > 0) {
    await prisma.mCQResponse.createMany({
      data: evaluated.map((item) => ({
        mcqAttemptId: attempt.id,
        questionId: item.questionId,
        selectedAnswer: item.selectedAnswer,
        isCorrect: item.isCorrect,
      })),
    });
  }

  const rawScore = evaluated.filter((response) => response.isCorrect).length;
  const totalQuestions = questions.length || 1;
  const percentScore = (rawScore / totalQuestions) * 100;
  const rules = getAssessmentRules();
  const scaledScore = (rawScore / totalQuestions) * rules.weights.mcqMaxScore;
  const passFailMcq = percentScore >= rules.thresholds.mcqMinPercent;

  const completedAttempt = await prisma.mCQAttempt.update({
    where: { id: attempt.id },
    data: {
      completedAt: new Date(),
      rawScore,
      percentScore,
      scaledScore,
      passFailMcq,
    },
  });

  await prisma.submission.update({
    where: { id: submission.id },
    data: { submissionStatus: SubmissionStatus.PROCESSING },
  });

  await enqueueAssessmentJob(submission.id);

  await recordAuditEvent({
    entityType: "mcq_attempt",
    entityId: attempt.id,
    action: "mcq_submitted",
    actorId: input.userId,
    metadata: {
      submissionId: submission.id,
      rawScore,
      percentScore,
      scaledScore,
    },
  });

  return {
    attemptId: completedAttempt.id,
    rawScore,
    percentScore,
    scaledScore,
    passFailMcq,
  };
}
