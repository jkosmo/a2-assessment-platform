/**
 * #950: setningen som forklarer en avgjørelse, skrevet på deltakerens språk.
 *
 * ⚠️ Før dette forsøkte klienten å oversette serverens engelske setning ved å slå den opp i et kart
 * over engelsk prosa. Det kunne ikke holde:
 *
 *   - Kartet driftet. Nøkkelen sa «... red flag / confidence / borderline rule.» lenge etter at
 *     serveren sluttet å skrive «borderline» i den strengen. Ingenting sa fra; oppslaget bommet
 *     bare, og deltakeren fikk engelsk.
 *   - Grunner med tall i seg — «poengsum 64 er i vinduet [60, 70]» — kan ALDRI slås opp som tekst.
 *   - Feltet inneholder to slags innhold: maskinskrevne grunner OG fritekst en sensor eller
 *     klagebehandler har skrevet selv. Kartet kunne ikke se forskjell, og risikerte å bytte ut et
 *     menneskes egne ord med en standardsetning.
 *
 * Regelen nå: serveren sender en KODE. Har raden en kode, er grunnen maskinskrevet, og setningen
 * formuleres her. Har den ingen kode, er teksten et menneskes egne ord — eller en rad fra før
 * kodene fantes — og vises ordrett.
 *
 * Trukket ut av participant.js fordi regelen ellers bare kunne prøves gjennom hele resultatflaten.
 */

/** Kode → oversettelsesnøkkel. Én oppføring per kode serveren kan sende. */
export const DECISION_REASON_KEYS = {
  MANUAL_REVIEW_LLM_DISAGREEMENT: "result.decisionReasonCode.llmDisagreement",
  MANUAL_REVIEW_SCORE_INCONSISTENCY: "result.decisionReasonCode.scoreInconsistency",
  MANUAL_REVIEW_BORDERLINE: "result.decisionReasonCode.borderline",
  MANUAL_REVIEW_RED_FLAG_OR_CONFIDENCE: "result.decisionReasonCode.redFlagOrConfidence",
  MANUAL_REVIEW_AI_DECLARATION: "result.decisionReasonCode.aiDeclaration",
  MANUAL_REVIEW_CONTENT_SIMILARITY: "result.decisionReasonCode.contentSimilarity",
  AUTO_FAIL_INSUFFICIENT_EVIDENCE: "result.decisionReasonCode.insufficientEvidence",
  AUTO_FAIL_MCQ_BELOW_MINIMUM: "result.decisionReasonCode.mcqBelowMinimum",
  AUTO_FAIL_PRACTICAL_BELOW_MINIMUM: "result.decisionReasonCode.practicalBelowMinimum",
  AUTO_FAIL_THRESHOLDS: "result.decisionReasonCode.autoFail",
  AUTO_PASS_THRESHOLDS: "result.decisionReasonCode.autoPass",
  MCQ_ONLY_PASS: "result.decisionReasonCode.mcqOnlyPass",
  MCQ_ONLY_FAIL: "result.decisionReasonCode.mcqOnlyFail",
};

/**
 * Deltakerens egen beskrivelse av KI-bruken følger med som parameter. Er den tom, skal setningen
 * ikke ha et tomt sitat hengende bakerst — da brukes en variant uten.
 */
export function decisionReasonKeyFor(code, params) {
  if (code === "MANUAL_REVIEW_AI_DECLARATION") {
    return String(params?.description ?? "").trim()
      ? "result.decisionReasonCode.aiDeclarationDescribed"
      : "result.decisionReasonCode.aiDeclaration";
  }
  return DECISION_REASON_KEYS[code] ?? null;
}

/**
 * Setter inn {navn} fra parametrene. Samme konvensjon som resten av participant.js.
 *
 * ⚠️ TALL skal gjennom kallerens tallformatering. QA-porten runde 6 (#940) så «du fikk 66.67 %» med
 * PUNKTUM her, rett under en overskrift som sa «66,67 %» med komma — to skrivemåter for samme tall
 * på samme kort. Uten en formatterer faller den tilbake på `String`, som er det den gjorde før.
 */
export function fillReasonPlaceholders(template, params, formatNumber = String) {
  if (typeof template !== "string") return "";
  let out = template;
  for (const [key, value] of Object.entries(params ?? {})) {
    const shown = typeof value === "number" ? formatNumber(value) : String(value);
    out = out.split(`{${key}}`).join(shown);
  }
  return out;
}

/**
 * @param guidance     participantGuidance fra resultatsvaret
 * @param translate    en funksjon (nøkkel) → tekst på gjeldende språk
 * @param formatNumber en funksjon (tall) → tekst på deltakerens språk. Utelates den, skrives tall
 *                     med `String`, altså med punktum — se advarselen i fillReasonPlaceholders.
 * @returns setningen som skal vises, eller "-" når det ikke finnes noen grunn
 */
export function localizeDecisionReason(guidance, translate, formatNumber = String) {
  const text = typeof guidance?.decisionReason === "string" ? guidance.decisionReason : null;
  const code = guidance?.decisionReasonCode ?? null;
  const params = guidance?.decisionReasonParams ?? {};

  // Ingen kode, eller en kode denne klienten ikke kjenner: vis serverens tekst ordrett.
  //
  //   - Ingen kode betyr at et menneske skrev grunnen selv (sensor eller klagebehandler), eller at
  //     raden er eldre enn kodene. Personens egne ord skal ikke byttes ut.
  //   - En ukjent kode betyr at serveren er nyere enn denne klienten. Serverens setning er da det
  //     beste vi har — bedre enn en kode på skjermen, og bedre enn å skjule grunnen helt.
  //
  // ⚠️ De to tilfellene deler én gren med vilje. Et tidligere utkast hadde en egen `if (!code)`
  // FORAN denne, og den kunne ikke observeres: oppslaget under gir uansett null for en manglende
  // kode. En mutasjonstest avslørte at grenen var død — testene besto med den fjernet.
  const key = code ? decisionReasonKeyFor(code, params) : null;
  if (!key) return text ?? "-";

  const translated = translate(key);
  // Fant ikke nøkkelen i språkfilen? `t()` gir nøkkelen tilbake. Å vise «result.decisionReasonCode.x»
  // til en deltaker er verre enn å vise serverens engelske setning.
  if (translated === key) return text ?? "-";

  return fillReasonPlaceholders(translated, params, formatNumber);
}
