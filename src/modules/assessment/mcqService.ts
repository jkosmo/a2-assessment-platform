import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { mcqRepository, createMcqRepository } from "./mcqRepository.js";
import { enqueueAssessmentJob, processSubmissionJobNow } from "./assessmentJobService.js";
import { runInTransaction } from "../../db/transaction.js";
import { ConflictError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import {
  localizeContentArray,
  localizeContentText,
  matchesLocalizedContentVariant,
} from "../../i18n/content.js";

const TERMINAL_SUBMISSION_STATUSES: ReadonlySet<(typeof SubmissionStatus)[keyof typeof SubmissionStatus]> = new Set([
  SubmissionStatus.SCORED,
  SubmissionStatus.COMPLETED,
  SubmissionStatus.UNDER_REVIEW,
  SubmissionStatus.REJECTED,
]);

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

  if (TERMINAL_SUBMISSION_STATUSES.has(submission.submissionStatus)) {
    throw new Error("MCQ attempt cannot be started: assessment is already completed or under review.");
  }

  let attempt = await mcqRepository.findOpenAttemptForSubmission(submission.id);

  if (!attempt) {
    if (submission.submissionStatus === SubmissionStatus.PROCESSING) {
      throw new Error("MCQ attempt cannot be started: submission has already been processed.");
    }
    // #578: FREETEXT_ONLY modules have no MCQ set — they should never reach the MCQ flow.
    const mcqSetVersionId = submission.moduleVersion.mcqSetVersionId;
    if (mcqSetVersionId == null) {
      throw new Error("This module has no multiple-choice component.");
    }
    attempt = await mcqRepository.createAttempt({
      submissionId: submission.id,
      mcqSetVersionId,
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

  if (TERMINAL_SUBMISSION_STATUSES.has(submission.submissionStatus)) {
    throw new Error("MCQ cannot be submitted: assessment is already completed or under review.");
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

  const rawScore = evaluated.filter((response) => response.isCorrect).length;
  const totalQuestions = questions.length || 1;
  const percentScore = (rawScore / totalQuestions) * 100;
  const rules = getAssessmentRules();
  const scaledScore = (rawScore / totalQuestions) * rules.weights.mcqMaxScore;
  const passFailMcq = percentScore >= 50;

  // #794: finalize atomically — replace the responses, guard-complete the attempt (only while still open),
  // and move the submission to PROCESSING in ONE transaction. A failure can no longer leave a completed
  // attempt with no responses / wrong status, and two concurrent submits can't both finalize (count 0 →
  // ConflictError). The @@unique([mcqAttemptId, questionId]) backs the response replacement.
  const completedAttempt = await runInTransaction(async (tx) => {
    const repo = createMcqRepository(tx);
    await repo.deleteResponsesForAttempt(attempt.id);
    if (evaluated.length > 0) {
      await repo.createResponses(
        evaluated.map((item) => ({
          mcqAttemptId: attempt.id,
          questionId: item.questionId,
          selectedAnswer: item.selectedAnswer,
          isCorrect: item.isCorrect,
        })),
      );
    }
    const done = await repo.completeAttemptGuarded({
      attemptId: attempt.id,
      completedAt: new Date(),
      rawScore,
      percentScore,
      scaledScore,
      passFailMcq,
    });
    if (done.count === 0) {
      throw new ConflictError("mcq_already_submitted", "This MCQ attempt was already submitted.");
    }
    await tx.submission.update({
      where: { id: submission.id },
      data: { submissionStatus: SubmissionStatus.PROCESSING },
    });
    // #803: the submission audit commits atomically with the finalization. Recorded here (inside the
    // tx), before the post-commit enqueue/synchronous-assessment I/O below.
    await recordAuditEvent(
      {
        entityType: auditEntityTypes.mcqAttempt,
        entityId: attempt.id,
        action: auditActions.assessment.mcqSubmitted,
        actorId: input.userId,
        metadata: {
          submissionId: submission.id,
          rawScore,
          percentScore,
          scaledScore,
        },
      },
      tx,
    );
    return repo.findAttemptById(attempt.id);
  });

  await enqueueAssessmentJob(submission.id);

  // #546 feedback: MCQ-only modules are graded deterministically (no LLM). Process the assessment
  // synchronously so the participant gets the result immediately, instead of waiting for the async
  // worker + poll cycle. Falls back to the enqueued job if synchronous processing fails.
  let assessmentComplete = false;
  if (submission.moduleVersion?.assessmentMode === "MCQ_ONLY") {
    try {
      await processSubmissionJobNow(submission.id);
      assessmentComplete = true;
    } catch (error) {
      console.warn("Synchronous MCQ-only assessment failed; leaving job for async worker.", error);
    }
  }

  await recordAuditEvent({
    entityType: auditEntityTypes.mcqAttempt,
    entityId: attempt.id,
    action: auditActions.assessment.mcqSubmitted,
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
    // #546/#2: when true the assessment was already finalised synchronously (MCQ-only) — the client
    // must NOT auto-run the assessment again (that would 409 against the recert re-run guard).
    assessmentComplete,
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
