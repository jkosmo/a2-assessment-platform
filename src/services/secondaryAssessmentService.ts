import { getAssessmentRules } from "../config/assessmentRules.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";

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

  const reasons: string[] = [];
  if (policy.triggerRules.manualReviewRecommended && input.primaryResult.manual_review_recommended) {
    reasons.push("primary_result_manual_review_recommended");
  }

  const confidenceNote = input.primaryResult.confidence_note.toLowerCase();
  const hasConfidenceTrigger = policy.triggerRules.confidenceNotePatterns.some((pattern) =>
    confidenceNote.includes(pattern.toLowerCase()),
  );
  if (hasConfidenceTrigger) {
    reasons.push("primary_result_low_or_medium_confidence");
  }

  const triggerSeverities = new Set(policy.triggerRules.redFlagSeverities.map((severity) => severity.toLowerCase()));
  const hasFlagSeverityTrigger = input.primaryResult.red_flags.some((flag) =>
    triggerSeverities.has(flag.severity.toLowerCase()),
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

  if (policy.disagreementRules.passFailMismatch && primaryResult.pass_fail_practical !== secondaryResult.pass_fail_practical) {
    reasons.push("pass_fail_mismatch");
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
