import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { mcqRepository } from "./mcqRepository.js";
import { enqueueAssessmentJob } from "./assessmentJobService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import {
  localizeContentArray,
  localizeContentText,
  matchesLocalizedContentVariant,
} from "../../i18n/content.js";

export async function startMcqAttempt(
  moduleId: string,
  submissionId: string,
  userId: string,
  locale: SupportedLocale = "en-GB",
) {
  const submission = await mcqRepository.findSubmissionForModuleMcq(submissionId, userId, moduleId);

  if (!submission) {
    throw new Error("Submission not found for module.");
  }

  let attempt = await mcqRepository.findOpenAttemptForSubmission(submission.id);

  if (!attempt) {
    attempt = await mcqRepository.createAttempt({
      submissionId: submission.id,
      mcqSetVersionId: submission.moduleVersion.mcqSetVersionId,
      startedAt: new Date(),
    });
  }

  const questions = await mcqRepository.findActiveQuestionsForSet(attempt.mcqSetVersionId);

  return {
    attemptId: attempt.id,
    questions: questions.map((question) => {
      const options = localizeContentArray(locale, JSON.parse(question.optionsJson) as unknown[]);
      return {
        id: question.id,
        stem: localizeContentText(locale, question.stem) ?? question.stem,
        options: shuffleArray(options),
      };
    }),
  };
}

export async function submitMcqAttempt(input: {
  moduleId: string;
  submissionId: string;
  attemptId: string;
  userId: string;
  responses: Array<{ questionId: string; selectedAnswer: string }>;
}) {
  const submission = await mcqRepository.findSubmissionForModuleMcq(input.submissionId, input.userId, input.moduleId);
  if (!submission) {
    throw new Error("Submission not found for module.");
  }

  const attempt = await mcqRepository.findAttemptForSubmission(input.attemptId, submission.id);
  if (!attempt) {
    throw new Error("MCQ attempt not found.");
  }
  if (attempt.completedAt) {
    throw new Error("MCQ attempt already submitted.");
  }

  const questions = await mcqRepository.findActiveQuestionsForSet(attempt.mcqSetVersionId);

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

  await mcqRepository.deleteResponsesForAttempt(attempt.id);
  if (evaluated.length > 0) {
    await mcqRepository.createResponses(
      evaluated.map((item) => ({
        mcqAttemptId: attempt.id,
        questionId: item.questionId,
        selectedAnswer: item.selectedAnswer,
        isCorrect: item.isCorrect,
      })),
    );
  }

  const rawScore = evaluated.filter((response) => response.isCorrect).length;
  const totalQuestions = questions.length || 1;
  const percentScore = (rawScore / totalQuestions) * 100;
  const rules = getAssessmentRules();
  const scaledScore = (rawScore / totalQuestions) * rules.weights.mcqMaxScore;
  const passFailMcq = percentScore >= 50;

  const completedAttempt = await mcqRepository.completeAttempt({
    attemptId: attempt.id,
    completedAt: new Date(),
    rawScore,
    percentScore,
    scaledScore,
    passFailMcq,
  });

  await assessmentJobRepository.updateSubmissionStatus(submission.id, SubmissionStatus.PROCESSING);

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

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
