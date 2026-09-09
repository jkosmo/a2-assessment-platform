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

/**
 * De STRUKTURERTE feltene alene. Dette er signalet slik det bør være.
 *
 * #1025 viser at modellen alltid fyller ut `evidence_sufficiency` (10 av 10 i ekte data), så denne
 * dekker det reelle tilfellet uten å tolke fri tekst.
 */
export function hasStructuredInsufficientEvidenceSignal(input: LlmStructuredAssessment): boolean {
  return (
    input.evidence_sufficiency === "insufficient" ||
    input.manual_review_reason_code === "insufficient_evidence"
  );
}

/**
 * Delstreng-reserven, skilt ut for å kunne MÅLES.
 *
 * ⚠️ #1026: den søker i `improvement_advice` — altså i FORBEDRINGSRÅDENE. Mønstrene inkluderer
 * «additional material» og «detailed reflection», som er helt vanlige fraser i et råd til en GOD
 * besvarelse: «add a more detailed reflection on your process».
 *
 * Et treff er ikke uskyldig. Det undertrykker en andre vurdering
 * (`secondaryAssessmentService.ts`), og det inngår i `autoFailForInsufficientEvidence` — som igjen
 * undertrykker MANUELL VURDERING. Anbefaler modellen at et menneske ser på saken, kan en frase i et
 * råd gjøre det om til automatisk stryk i stedet.
 *
 * Returnerer hvilke mønstre som traff, ikke bare om noe traff — måledataene trenger å vite hvilke.
 */
export function matchedInsufficientEvidencePatterns(input: LlmStructuredAssessment): string[] {
  const searchableTexts = [
    input.confidence_note,
    ...Object.values(input.criterion_rationales ?? {}),
    ...(input.improvement_advice ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  return insufficientEvidencePatterns.filter((pattern) =>
    searchableTexts.some((text) => text.includes(pattern)),
  );
}

/**
 * #1026: delstreng-reserven er TATT UT av vedtaket. Bare de strukturerte feltene teller.
 *
 * ⚠️ HVORFOR DETTE KUNNE AVGJØRES UTEN Å VENTE PÅ SKYGGEMÅLINGEN. Signalet har tre lesere, og alle
 * tre bruker det til å FJERNE kontroll:
 *   - `autoFailForInsufficientEvidence` gjør «stryker på terskel» om til automatisk stryk i stedet
 *     for manuell vurdering
 *   - `shouldSuppressManualReviewForInsufficientEvidenceDisagreement` undertrykker manuell vurdering
 *   - `evaluateSecondaryAssessmentTrigger` hopper over den andre vurderingen helt
 *
 * Å ta reserven ut gir derfor MER menneskelig vurdering, aldri mindre. Endringen er ensrettet mot
 * kandidatens fordel, og prisen er sensorarbeid i de tilfellene reserven traff.
 *
 * ⚠️ OG DEN TRAFF IKKE. Målt mot ekte data i repoet: 0 treff i 239 modellsvars `criterionRationales`
 * (`doc/benchmarks/model-comparison-2026-03-23.jsonl`), og 0 treff i 22 ekte forbedringsråd. Mens
 * seks helt vanlige råd utløser den — «Add a more detailed reflection on your process», «Du har
 * delvis dokumentasjon av testene». To av de seks er NORSKE, så språkinstruksjonen beskytter ikke.
 *
 * #1025 målte at modellen fyller `evidence_sufficiency` i 10 av 10 ekte svar, så det strukturerte
 * feltet finnes å lene seg på.
 *
 * `matchedInsufficientEvidencePatterns` blir stående: skyggehendelsen
 * `assessment.insufficientEvidencePatternOnly` er nå protokollen over hva vi IKKE lenger handler på.
 * Sletter vi lista, mister vi muligheten til å se hva vi ga slipp på.
 */
export function hasInsufficientEvidenceSignal(input: LlmStructuredAssessment): boolean {
  return hasStructuredInsufficientEvidenceSignal(input);
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
