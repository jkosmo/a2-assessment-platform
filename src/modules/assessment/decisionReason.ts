/**
 * #950/#940: HVA som avgjorde en vurdering, som data — ikke som en engelsk setning.
 *
 * ⚠️ Bakgrunnen: `decisionReason` var én tekststreng som serveren skrev på engelsk, og klienten
 * forsøkte å oversette ved å slå den opp i et kart over engelsk prosa. Det kan ikke holde. Kartet
 * driftet fra serverens strenger så snart en av dem ble endret (borderline-vinduet ble skilt ut, og
 * nøkkelen på klienten nevnte fortsatt «borderline»), og flere grunner sto aldri i kartet i det hele
 * tatt. Grunner med tall i seg — «score 64 er i vinduet [60, 70]» — kan aldri slås opp som tekst.
 *
 * Feltet har dessuten TO slags innhold: maskinskrevne grunner, og fritekst en sensor eller
 * klagebehandler har skrevet selv. Klienten kunne ikke se forskjell, og risikerte å «oversette» det
 * et menneske hadde formulert.
 *
 * Regelen nå: en maskinskrevet grunn har en kode og eventuelle tall. Klienten formulerer setningen
 * på deltakerens språk. En grunn UTEN kode er skrevet av et menneske og vises ordrett — det er
 * personens egne ord, og de skal ikke oversettes.
 *
 * Teksten beholdes ved siden av koden fordi den ligger lagret på alle eksisterende rader, brukes i
 * logg og regresjonskjøringer, og er det sensor ser i dag.
 */

export const decisionReasonCodes = {
  manualReviewLlmDisagreement: "MANUAL_REVIEW_LLM_DISAGREEMENT",
  manualReviewScoreInconsistency: "MANUAL_REVIEW_SCORE_INCONSISTENCY",
  manualReviewBorderline: "MANUAL_REVIEW_BORDERLINE",
  manualReviewRedFlagOrConfidence: "MANUAL_REVIEW_RED_FLAG_OR_CONFIDENCE",
  manualReviewAiDeclaration: "MANUAL_REVIEW_AI_DECLARATION",
  manualReviewContentSimilarity: "MANUAL_REVIEW_CONTENT_SIMILARITY",
  autoFailInsufficientEvidence: "AUTO_FAIL_INSUFFICIENT_EVIDENCE",
  autoFailMcqBelowMinimum: "AUTO_FAIL_MCQ_BELOW_MINIMUM",
  autoFailPracticalBelowMinimum: "AUTO_FAIL_PRACTICAL_BELOW_MINIMUM",
  autoFailThresholds: "AUTO_FAIL_THRESHOLDS",
  autoPassThresholds: "AUTO_PASS_THRESHOLDS",
  mcqOnlyPass: "MCQ_ONLY_PASS",
  mcqOnlyFail: "MCQ_ONLY_FAIL",
} as const;

export type DecisionReasonCode = (typeof decisionReasonCodes)[keyof typeof decisionReasonCodes];

/** Alle kodene som finnes. Brukt av vakttesten som krever oversettelse på alle tre språk. */
export const ALL_DECISION_REASON_CODES: DecisionReasonCode[] = Object.values(decisionReasonCodes);

/**
 * Tallene og tekstbitene setningen trenger. Bare primitiver — dette serialiseres til JSON og
 * settes inn i en oversatt setning på klienten.
 */
export type DecisionReasonParams = Record<string, string | number>;

export type DecisionReason = {
  code: DecisionReasonCode;
  params: DecisionReasonParams;
  /** Engelsk (eller for KI-signalene norsk) tekst, som før. Lagres og vises til sensor. */
  text: string;
};

export function decisionReason(
  code: DecisionReasonCode,
  text: string,
  params: DecisionReasonParams = {},
): DecisionReason {
  return { code, params, text };
}

/**
 * Serialiser parametrene for lagring. Et tomt sett lagres som null, slik at en rad uten tall ikke
 * ser ut som en rad med et tomt objekt.
 */
export function serializeDecisionReasonParams(params: DecisionReasonParams | null | undefined): string | null {
  if (!params || Object.keys(params).length === 0) return null;
  return JSON.stringify(params);
}

/**
 * Les parametrene tilbake. Tåler null, tom streng og ugyldig JSON — en ødelagt rad skal gi en
 * setning uten tall, ikke et kastet unntak midt i resultatvisningen.
 */
export function parseDecisionReasonParams(value: string | null | undefined): DecisionReasonParams {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DecisionReasonParams = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof entry === "string" || typeof entry === "number") out[key] = entry;
    }
    return out;
  } catch {
    return {};
  }
}
