import { getAssessmentRules } from "../../config/assessmentRules.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import {
  hasOnlyInsufficientEvidenceRedFlags,
  hasInsufficientEvidenceSignal,
  hasLowConfidenceManualReviewSignal,
  recommendsManualReview,
} from "./assessmentDecisionSignals.js";
import { isConfiguredSecondaryTriggerRedFlag, normalizeRedFlags } from "./assessmentRedFlagPolicy.js";

export type SecondaryAssessmentPolicy = ReturnType<typeof getAssessmentRules>["secondaryAssessment"];

type TriggerInput = {
  moduleId: string;
  primaryResult: LlmStructuredAssessment;
};

export type SecondaryTriggerDecision = {
  enabled: boolean;
  shouldRun: boolean;
  reasons: string[];
};

export type SecondaryDisagreementDecision = {
  hasDisagreement: boolean;
  reasons: string[];
};

export function evaluateSecondaryAssessmentTrigger(
  input: TriggerInput,
  policy: SecondaryAssessmentPolicy = getAssessmentRules().secondaryAssessment,
): SecondaryTriggerDecision {
  const enabled = policy.moduleOverrides[input.moduleId] ?? policy.enabledByDefault;
  if (!enabled) {
    return {
      enabled: false,
      shouldRun: false,
      reasons: ["secondary assessment disabled by policy"],
    };
  }

  if (
    (input.primaryResult.red_flags.length === 0 ||
      hasOnlyInsufficientEvidenceRedFlags(input.primaryResult)) &&
    hasInsufficientEvidenceSignal(input.primaryResult)
  ) {
    return {
      enabled: true,
      shouldRun: false,
      reasons: ["primary_result_insufficient_evidence_auto_fail"],
    };
  }

  const reasons: string[] = [];
  if (policy.triggerRules.manualReviewRecommended && recommendsManualReview(input.primaryResult)) {
    reasons.push("primary_result_manual_review_recommended");
  }

  const confidenceNote = input.primaryResult.confidence_note.toLowerCase();
  const hasConfidenceTrigger =
    hasLowConfidenceManualReviewSignal(input.primaryResult) ||
    policy.triggerRules.confidenceNotePatterns.some((pattern) =>
      confidenceNote.includes(pattern.toLowerCase()),
    );
  if (hasConfidenceTrigger) {
    reasons.push("primary_result_low_or_medium_confidence");
  }

  const hasFlagSeverityTrigger = normalizeRedFlags(input.primaryResult.red_flags).some((flag) =>
    isConfiguredSecondaryTriggerRedFlag(flag),
  );
  if (hasFlagSeverityTrigger) {
    reasons.push("primary_result_red_flag_trigger");
  }

  return {
    enabled: true,
    shouldRun: reasons.length > 0,
    reasons,
  };
}

export function evaluateSecondaryAssessmentDisagreement(
  primaryResult: LlmStructuredAssessment,
  secondaryResult: LlmStructuredAssessment,
  policy: SecondaryAssessmentPolicy = getAssessmentRules().secondaryAssessment,
): SecondaryDisagreementDecision {
  const reasons: string[] = [];

  const practicalDelta = Math.abs(primaryResult.practical_score_scaled - secondaryResult.practical_score_scaled);
  if (practicalDelta >= policy.disagreementRules.practicalScoreDeltaMin) {
    reasons.push("practical_score_delta_exceeded");
  }

  const rubricDelta = Math.abs(primaryResult.rubric_total - secondaryResult.rubric_total);
  if (rubricDelta >= policy.disagreementRules.rubricTotalDeltaMin) {
    reasons.push("rubric_total_delta_exceeded");
  }

  if (
    policy.disagreementRules.manualReviewRecommendationMismatch &&
    primaryResult.manual_review_recommended !== secondaryResult.manual_review_recommended
  ) {
    reasons.push("manual_review_recommendation_mismatch");
  }

  return {
    hasDisagreement: reasons.length > 0,
    reasons,
  };
}
