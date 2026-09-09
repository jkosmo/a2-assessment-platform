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

/**
 * Kode → nøkkelSTAMME. Prefikset settes av kalleren, fordi de to målgruppene trenger ULIKE
 * setninger for samme kode:
 *
 *   deltaker: «Bestått: du fikk 100 %, og kravet var 80 %.»
 *   sensor:   «Bestått automatisk: 100 % mot et krav på 80 %.»
 *
 * Deltakerens tekst står i andreperson. På en sensors skjerm handler den om en annen person, og
 * «du fikk» ville vært direkte feil. Det er derfor #1018 ikke bare var å importere språkfila.
 */
export const DECISION_REASON_KEYS = {
  MANUAL_REVIEW_LLM_DISAGREEMENT: "llmDisagreement",
  MANUAL_REVIEW_SCORE_INCONSISTENCY: "scoreInconsistency",
  MANUAL_REVIEW_BORDERLINE: "borderline",
  MANUAL_REVIEW_RED_FLAG_OR_CONFIDENCE: "redFlagOrConfidence",
  MANUAL_REVIEW_AI_DECLARATION: "aiDeclaration",
  MANUAL_REVIEW_CONTENT_SIMILARITY: "contentSimilarity",
  AUTO_FAIL_INSUFFICIENT_EVIDENCE: "insufficientEvidence",
  AUTO_FAIL_MCQ_BELOW_MINIMUM: "mcqBelowMinimum",
  AUTO_FAIL_PRACTICAL_BELOW_MINIMUM: "practicalBelowMinimum",
  AUTO_FAIL_THRESHOLDS: "autoFail",
  AUTO_PASS_THRESHOLDS: "autoPass",
  MCQ_ONLY_PASS: "mcqOnlyPass",
  MCQ_ONLY_FAIL: "mcqOnlyFail",
};

/**
 * Deltakerens egen beskrivelse av KI-bruken følger med som parameter. Er den tom, skal setningen
 * ikke ha et tomt sitat hengende bakerst — da brukes en variant uten.
 */
export function decisionReasonKeyFor(code, params, prefix = "result.decisionReasonCode.") {
  const stem = code === "MANUAL_REVIEW_AI_DECLARATION"
    ? (String(params?.description ?? "").trim() ? "aiDeclarationDescribed" : "aiDeclaration")
    : DECISION_REASON_KEYS[code];
  return stem ? `${prefix}${stem}` : null;
}

/** Tåler både objekt, JSON-streng, null og ugyldig JSON. En ødelagt rad skal gi en setning uten
 *  tall, ikke et kastet unntak midt i en saksvisning. */
export function parseReasonParams(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
 * @param guidance participantGuidance fra resultatsvaret, eller en avgjørelsesrad
 * @param options  { translate, formatNumber, keyPrefix } — `translate` slår opp en nøkkel,
 *                 `formatNumber` skriver tall på brukerens språk (uten den blir det punktum), og
 *                 `keyPrefix` velger MÅLGRUPPE: deltakerens setninger eller sensorens.
 * @returns setningen som skal vises, eller "-" når det ikke finnes noen grunn
 */
export function localizeDecisionReason(guidance, options) {
  const { translate, formatNumber = String, keyPrefix = "result.decisionReasonCode." } = options ?? {};
  const text = typeof guidance?.decisionReason === "string" ? guidance.decisionReason : null;
  const code = guidance?.decisionReasonCode ?? null;
  // ⚠️ Parametrene kan være et OBJEKT eller en JSON-STRENG. Deltakerflaten får dem tolket av
  // lesemodellen; sensorflaten får avgjørelsesraden rått fra databasen, der kolonnen er tekst.
  // Uten dette ville `Object.entries` på en streng gitt tegn-par, ingen plassholder ville blitt
  // fylt, og «poengsummen {totalScore} ligger i …» hadde stått på skjermen.
  const params = parseReasonParams(guidance?.decisionReasonParams);

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
  const key = code ? decisionReasonKeyFor(code, params, keyPrefix) : null;
  if (!key) return text ?? "-";

  const translated = translate(key);
  // Fant ikke nøkkelen i språkfilen? `t()` gir nøkkelen tilbake. Å vise «result.decisionReasonCode.x»
  // til en deltaker er verre enn å vise serverens engelske setning.
  if (translated === key) return text ?? "-";

  const filled = fillReasonPlaceholders(translated, params, formatNumber);
  // ⚠️ Får vi ikke fylt inn tallene — ødelagt JSON, eller en kode hvis parametre mangler — ville
  // «du fikk {scorePercent} %» stått på skjermen. Serverens lagrede setning har tallene i seg, på
  // engelsk. Den er ikke bra, men den er sann, og en synlig plassholder er verken.
  return /\{\w+\}/.test(filled) ? (text ?? filled) : filled;
}
