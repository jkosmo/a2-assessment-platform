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

/**
 * #1019: hvor sikker vurderingen var, som en VERDI — ikke som en engelsk setning å gjette på.
 *
 * ⚠️ Klienten leste tidligere `confidence_note` og lette etter delstrenger: «low confidence» pluss
 * «sparse» eller «limited cues» eller «partial evidence». Bommet den, sto språkmodellens engelske
 * setning ordrett i et norsk skjermbilde. Og notatet er GENERERT — det kan formuleres om når som
 * helst, uten at noe i repoet endres. En gjetning på fri tekst kan ikke være stabil.
 *
 * Feltene under er derimot strukturerte, og prompten ber allerede om dem
 * (`llmAssessmentService.ts:556-558`).
 *
 * Returnerer `null` når det ikke er noe forbehold å melde. ⚠️ Det inkluderer «høy konfidens»: en
 * rad som forteller deltakeren at alt er som det skal, bruker plass uten å si noe — samme regel
 * som #940 innførte for de tomme radene.
 */
export function deriveConfidenceLevel(
  input: Pick<LlmStructuredAssessment, "evidence_sufficiency" | "manual_review_reason_code">,
): "low" | "medium" | null {
  // ⚠️ BARE ekte usikkerhet. To felt som ser like ut betyr helt ulike ting:
  //
  //   evidence_sufficiency  = var det NOK I BESVARELSEN til å vurdere?
  //   low_confidence        = hvor sikker er modellen på DOMMEN sin?
  //
  // Et første utkast lot `insufficient` gi «lav konfidens». Ekte data fra stage 2026-08-27 viste at
  // det er FEIL, og ofte det motsatte: i tre av tre slike vurderinger skrev modellen selv «Det er
  // høy sikkerhet i vurderingen på grunn av svarets svært begrensede innhold». Leverer noen noe
  // tomt, er modellen nettopp SIKKER på at det stryker.
  //
  // Å si «vurderingen ble gjort med lav sikkerhet, en sensor kan se på den igjen om du klager» til
  // den deltakeren er usant, og inviterer til en klage uten grunnlag. At det ikke var nok i
  // besvarelsen står allerede i BEGRUNNELSEN (`AUTO_FAIL_INSUFFICIENT_EVIDENCE`) — det hører hjemme
  // der, ikke som et forbehold om vurderingens sikkerhet.
  if (input.manual_review_reason_code === "low_confidence") return "low";
  if (input.evidence_sufficiency === "uncertain") return "medium";
  return null;
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
