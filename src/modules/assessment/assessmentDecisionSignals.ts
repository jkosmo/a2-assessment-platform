import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import {
  type AssessmentRedFlag,
  isConfiguredInsufficientEvidenceRedFlag,
  isConfiguredManualReviewRedFlag,
  normalizeRedFlags,
} from "./assessmentRedFlagPolicy.js";

const insufficientEvidencePatterns = [
  "minimal artefact content",
  "minimal content",
  "minimal and non-substantive submission",
  "minimal and non-specific submission",
  "non-substantive submission",
  "non-specific submission",
  "little content",
  "lite innhold",
  "partial documentation",
  "delvis dokumentasjon",
  "placeholder",
  "insufficient evidence",
  "insufficient submission evidence",
  "cannot assess reliably",
  "reliable assessment",
  "requires additional materials",
  "additional material required",
  "additional material",
  "requires resubmission",
  "request for expanded submission",
  "additional materials",
  "detailed reflection",
  "iteration/qa notes",
  "no iteration history",
  "no qa checks",
  "missing assessment artifacts",
];

export function hasInsufficientEvidenceSignal(input: LlmStructuredAssessment): boolean {
  if (
    input.evidence_sufficiency === "insufficient" ||
    input.manual_review_reason_code === "insufficient_evidence"
  ) {
    return true;
  }

  const searchableTexts = [
    input.confidence_note,
    ...Object.values(input.criterion_rationales ?? {}),
    ...(input.improvement_advice ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  return searchableTexts.some((text) =>
    insufficientEvidencePatterns.some((pattern) => text.includes(pattern)),
  );
}

export function isInsufficientEvidenceRedFlag(flag: AssessmentRedFlag): boolean {
  return isConfiguredInsufficientEvidenceRedFlag(flag);
}

export function hasOnlyInsufficientEvidenceRedFlags(input: LlmStructuredAssessment): boolean {
  const normalizedRedFlags = normalizeRedFlags(input.red_flags);
  return normalizedRedFlags.length > 0 && normalizedRedFlags.every((flag) => isInsufficientEvidenceRedFlag(flag));
}

export function hasForcingRedFlag(
  input: LlmStructuredAssessment,
  _forcingSeverities: string[],
): boolean {
  return normalizeRedFlags(input.red_flags).some(
    (flag) => isConfiguredManualReviewRedFlag(flag) && !isInsufficientEvidenceRedFlag(flag),
  );
}

export function recommendsManualReview(input: LlmStructuredAssessment): boolean {
  return input.recommended_outcome === "manual_review" || input.manual_review_recommended;
}

export function isExplicitAutomaticFailRecommendation(input: LlmStructuredAssessment): boolean {
  return input.recommended_outcome === "fail";
}

export function hasLowConfidenceManualReviewSignal(input: LlmStructuredAssessment): boolean {
  return input.manual_review_reason_code === "low_confidence";
}

export function shouldSuppressManualReviewForInsufficientEvidenceDisagreement(
  primaryResult: LlmStructuredAssessment,
  secondaryResult: LlmStructuredAssessment,
): boolean {
  return (
    (primaryResult.red_flags.length === 0 || hasOnlyInsufficientEvidenceRedFlags(primaryResult)) &&
    (secondaryResult.red_flags.length === 0 || hasOnlyInsufficientEvidenceRedFlags(secondaryResult)) &&
    hasInsufficientEvidenceSignal(primaryResult) &&
    hasInsufficientEvidenceSignal(secondaryResult)
  );
}
