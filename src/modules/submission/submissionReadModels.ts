import { llmResponseCodec } from "../../codecs/llmResponseCodec.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";

export type SubmissionHistoryItem = {
  id: string;
  submittedAt: Date;
  submissionStatus: string;
  module: { id: string; title: string };
  decisions: Array<{
    id: string;
    decisionType: string;
    passFailTotal: boolean;
    totalScore: number;
    decisionReason: string;
    finalisedAt: Date | null;
  }>;
  mcqAttempts: Array<{
    id: string;
    scaledScore: number | null;
    percentScore: number | null;
    passFailMcq: boolean | null;
    completedAt: Date | null;
  }>;
  llmEvaluations: Array<{
    id: string;
    practicalScoreScaled: number;
    passFailPractical: boolean;
    manualReviewRecommended: boolean;
    createdAt: Date;
  }>;
};

export type OwnedSubmission = {
  id: string;
  submissionStatus: string;
  decisions: Array<{
    id: string;
    decisionReason: string;
    mcqScaledScore: number;
    practicalScaledScore: number;
    totalScore: number;
  }>;
  appeals: Array<{
    id: string;
    appealStatus: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }>;
  mcqAttempts: Array<{
    id: string;
    scaledScore: number | null;
    completedAt: Date | null;
  }>;
  llmEvaluations: Array<{
    id: string;
    practicalScoreScaled: number;
    confidenceNote: string | null;
    responseJson: string;
  }>;
};

function parseStructuredLlmResponse(responseJson: string | null | undefined) {
  if (!responseJson) {
    return null;
  }

  try {
    return llmResponseCodec.parse(JSON.parse(responseJson));
  } catch {
    return null;
  }
}

function getSubmissionStatusExplanation(status: string) {
  if (status === "UNDER_REVIEW") {
    return "Your submission is under manual review because confidence/red-flag rules require a human decision.";
  }
  if (status === "COMPLETED") {
    return "Final decision is available.";
  }
  return "Assessment is still processing.";
}

export function toSubmissionHistoryItemView(submission: SubmissionHistoryItem, locale: string) {
  const normalizedLocale = normalizeLocale(locale) ?? "en-GB";

  return {
    submissionId: submission.id,
    module: {
      ...submission.module,
      title: localizeContentText(normalizedLocale, submission.module.title) ?? submission.module.title,
    },
    submittedAt: submission.submittedAt,
    status: submission.submissionStatus,
    latestDecision: submission.decisions[0] ?? null,
    latestMcqAttempt: submission.mcqAttempts[0] ?? null,
    latestLlmEvaluation: submission.llmEvaluations[0] ?? null,
  };
}

export function toSubmissionHistoryResponseView(submissions: SubmissionHistoryItem[], locale: string) {
  return {
    history: submissions.map((submission) => toSubmissionHistoryItemView(submission, locale)),
  };
}

export function toSubmissionResultView(submission: OwnedSubmission) {
  const decision = submission.decisions[0] ?? null;
  const latestAppeal = submission.appeals[0] ?? null;
  const llmEvaluation = submission.llmEvaluations[0] ?? null;
  const mcqAttempt = submission.mcqAttempts.find((attempt) => attempt.completedAt !== null) ?? null;
  const llmStructured = parseStructuredLlmResponse(llmEvaluation?.responseJson);

  return {
    submissionId: submission.id,
    status: submission.submissionStatus,
    statusExplanation: getSubmissionStatusExplanation(submission.submissionStatus),
    scoreComponents: {
      mcqScaledScore: decision?.mcqScaledScore ?? mcqAttempt?.scaledScore ?? null,
      practicalScaledScore: decision?.practicalScaledScore ?? llmEvaluation?.practicalScoreScaled ?? null,
      totalScore: decision?.totalScore ?? null,
    },
    decision,
    latestAppeal,
    participantGuidance: {
      decisionReason: decision?.decisionReason ?? null,
      confidenceNote: llmEvaluation?.confidenceNote ?? null,
      improvementAdvice: llmStructured?.improvement_advice ?? [],
      criterionRationales: llmStructured?.criterion_rationales ?? null,
      decisionMetadata: llmStructured
        ? {
            evidenceSufficiency: llmStructured.evidence_sufficiency ?? null,
            recommendedOutcome: llmStructured.recommended_outcome ?? null,
            manualReviewReasonCode: llmStructured.manual_review_reason_code ?? null,
          }
        : null,
    },
  };
}

export type SubmissionHistoryResponseView = ReturnType<typeof toSubmissionHistoryResponseView>;
export type SubmissionResultView = ReturnType<typeof toSubmissionResultView>;
