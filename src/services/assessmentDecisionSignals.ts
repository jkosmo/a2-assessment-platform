import type { LlmStructuredAssessment } from "./llmAssessmentService.js";

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
  "requires additional materials",
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

export function shouldSuppressManualReviewForInsufficientEvidenceDisagreement(
  primaryResult: LlmStructuredAssessment,
  secondaryResult: LlmStructuredAssessment,
): boolean {
  return (
    primaryResult.red_flags.length === 0 &&
    secondaryResult.red_flags.length === 0 &&
    !primaryResult.pass_fail_practical &&
    !secondaryResult.pass_fail_practical &&
    hasInsufficientEvidenceSignal(primaryResult) &&
    hasInsufficientEvidenceSignal(secondaryResult)
  );
}
