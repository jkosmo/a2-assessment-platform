import type { LlmStructuredAssessment } from "./llmAssessmentService.js";

type AssessmentRedFlag = LlmStructuredAssessment["red_flags"][number];

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

export function isInsufficientSubmissionRedFlag(flag: AssessmentRedFlag): boolean {
  return flag.code.trim().toLowerCase() === "insufficient_submission";
}

export function hasOnlyInsufficientSubmissionRedFlags(input: LlmStructuredAssessment): boolean {
  return input.red_flags.length > 0 && input.red_flags.every((flag) => isInsufficientSubmissionRedFlag(flag));
}

export function hasForcingRedFlag(
  input: LlmStructuredAssessment,
  forcingSeverities: string[],
): boolean {
  const severitySet = new Set(forcingSeverities.map((severity) => severity.toLowerCase()));
  return input.red_flags.some(
    (flag) => severitySet.has(flag.severity.toLowerCase()) && !isInsufficientSubmissionRedFlag(flag),
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
    (primaryResult.red_flags.length === 0 || hasOnlyInsufficientSubmissionRedFlags(primaryResult)) &&
    (secondaryResult.red_flags.length === 0 || hasOnlyInsufficientSubmissionRedFlags(secondaryResult)) &&
    !primaryResult.pass_fail_practical &&
    !secondaryResult.pass_fail_practical &&
    hasInsufficientEvidenceSignal(primaryResult) &&
    hasInsufficientEvidenceSignal(secondaryResult)
  );
}
