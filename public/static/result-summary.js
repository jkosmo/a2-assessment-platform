/**
 * #940: hva resultatskjermen skal si, og hva som skal stå åpent.
 *
 * Produkteier, stage 2026-08-20, rett etter en ren flervalgsmodul:
 *
 *   «Skjermbildet viser hvordan resultat blir vist. Dette er ikke optimal bruk av skjermen og kan
 *    gjøres på en mer konsis og enklere måte.»
 *
 * Åtte likestilte rader for å si «bestått, 100 %». Prinsippet nå: **utfallet avgjør hva som står
 * åpent.** Bestod du, er poengsummen svaret og resten er detaljer. Strøk du, er begrunnelsen
 * svaret. Venter du på en sensor, er «du får e-post, gjør ingenting» svaret — og det sto ingen
 * steder i det hele tatt.
 *
 * ⚠️ Trukket ut av participant.js fordi reglene ellers bare kunne prøves ved å rendre hele
 * resultatflaten. En regel som bare kan prøves gjennom hele flaten, blir i praksis ikke prøvd
 * (#982).
 */

import { deriveOutcome } from "/static/outcome.js";

/** Radene skjermen kan vise. Rekkefølgen her er rekkefølgen de vises i. */
export const ROWS = {
  status: "status",
  totalScore: "totalScore",
  mcqScore: "mcqScore",
  practicalScore: "practicalScore",
  decision: "decision",
  decisionReason: "decisionReason",
  confidence: "confidence",
  submissionId: "submissionId",
};

/**
 * Utfallet, som én verdi.
 *
 * ⚠️ Avgjørelsen tas IKKE her. `deriveOutcome` i outcome.js er det ene stedet som svarer på «hva
 * skal jeg vise for dette forsøket» (#978), og `test/outcome-derivation-guard.test.js` nekter nye
 * rå `passFailTotal ===`-sammenligninger utenfor den fila. Et første utkast her utledet utfallet på
 * nytt — vakten fanget det, som er nettopp det den er til for.
 *
 * Det denne funksjonen legger til er ett DISPLAY-skille som outcome.js ikke trenger å kjenne:
 * `pending` dekker både «en sensor ser på den» og «maskinen jobber». For deltakeren er det to helt
 * ulike beskjeder — den ene sier «du får e-post, gjør ingenting», den andre «vent litt».
 */
export function resolveOutcome(status, passFailTotal) {
  const outcome = deriveOutcome({ passFailTotal, submissionStatus: status });
  if (outcome === "passed" || outcome === "failed") return outcome;
  if (String(status ?? "").toUpperCase() === "UNDER_REVIEW") return "review";
  // ⚠️ `unknown` er ikke det samme som «holder på». En AVGJORT status uten vedtak — REJECTED er den
  // ene som finnes i enumet — ville med «pending» fått overskrifta «Besvarelsen din blir vurdert»,
  // altså en påstand vi ikke har dekning for. Da sier vi heller mindre, og lar statusraden stå.
  return outcome === "unknown" && SETTLED_STATUSES.has(String(status ?? "").toUpperCase())
    ? "unknown"
    : "pending";
}

// Speiler `SETTLED_STATUSES` i outcome.js. Holdes bevisst kort: den brukes bare til å skille «vi vet
// ingenting, og det kommer ikke mer» fra «det holder på».
const SETTLED_STATUSES = new Set(["COMPLETED", "REJECTED"]);

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * Overskriften og underlinja.
 *
 * Returnerer oversettelsesnøkler og tall — teksten formuleres av kalleren på deltakerens språk,
 * samme mønster som #950.
 *
 * ⚠️ Tallene kan mangle. En modul uten terskel i reglene har ingen «kravet var»-verdi, og en
 * besvarelse under vurdering har ingen endelig poengsum. Da skal linja si mindre, ikke vise
 * «kravet var undefined».
 */
export function buildHeadline(outcome, data) {
  const { scoreComponents = {}, requirement = {}, isMcqOnly = false, isFreetextOnly = false } = data ?? {};

  if (outcome === "review") {
    return { key: "result.headline.review", params: {}, subKey: "result.headline.reviewSub", subParams: {} };
  }
  if (outcome === "pending") {
    return { key: "result.headline.pending", params: {}, subKey: null, subParams: {} };
  }
  if (outcome === "unknown") {
    // Ingen påstand om utfall. Statusraden under bærer det vi faktisk vet.
    return { key: "result.headline.unknown", params: {}, subKey: null, subParams: {} };
  }

  const passed = outcome === "passed";
  const key = passed ? "result.headline.passed" : "result.headline.failed";

  // En ren flervalgsmodul måles i prosent, og kravet er en prosent. Det er den vanligste veien
  // gjennom systemet, og den eneste der begge tallene finnes.
  if (isMcqOnly) {
    const percent = scoreComponents.mcqPercentScore;
    const min = requirement.mcqMinPercent;
    if (isNumber(percent)) {
      return {
        key: `${key}Percent`,
        params: { percent: roundTo2(percent) },
        subKey: isNumber(min) ? "result.headline.requirementPercent" : null,
        subParams: isNumber(min) ? { min: roundTo2(min) } : {},
      };
    }
  }

  const total = scoreComponents.totalScore;
  if (!isNumber(total)) {
    return { key, params: {}, subKey: null, subParams: {} };
  }

  // En blandet modul har ekte delpoeng, og de er informasjon — de blir stående, på underlinja.
  const parts = [];
  if (!isFreetextOnly && isNumber(scoreComponents.mcqScaledScore)) {
    // ⚠️ Egne, korte etiketter for underlinja. Radetikettene ("MCQ-poeng") er
    // kolonneoverskrifter, og leser som maskintekst når de settes inn i en setning.
    parts.push({ labelKey: "result.headline.partMcq", value: roundTo2(scoreComponents.mcqScaledScore) });
  }
  if (!isMcqOnly && isNumber(scoreComponents.practicalScaledScore)) {
    parts.push({ labelKey: "result.headline.partPractical", value: roundTo2(scoreComponents.practicalScaledScore) });
  }

  // Delpoengene vises bare når de er MER enn totalen sagt på nytt. For en ren flervalgsmodul er
  // total og flervalgspoeng samme tall, og to rader med samme verdi sier ingenting.
  const showParts = parts.length > 1;
  const min = requirement.totalMin;
  const showMin = isNumber(min);

  return {
    key: `${key}Score`,
    params: { score: roundTo2(total) },
    subKey: showParts
      ? (showMin ? "result.headline.partsWithRequirement" : "result.headline.parts")
      : (showMin ? "result.headline.requirementScore" : null),
    subParams: {
      ...(showParts ? { parts } : {}),
      ...(showMin ? { min: roundTo2(min) } : {}),
    },
  };
}

function roundTo2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Hvilke rader som står åpne, og hvilke som ligger bak «Vis detaljer».
 *
 * ⚠️ Én utforming kan ikke tjene alle utfallene. Bestod du, er begrunnelsen en detalj. Strøk du, er
 * den selve svaret. Det er derfor utfallet — ikke en fast mal — bestemmer hva som er utfoldet.
 */
export function planRows(outcome, context) {
  const { hasConfidence = false, isMcqOnly = false, isFreetextOnly = false, hasDecisionReason = false } = context ?? {};

  const open = [];
  const detail = [];

  if (outcome === "failed" && hasDecisionReason) open.push(ROWS.decisionReason);
  if (outcome === "review" && hasDecisionReason) open.push(ROWS.decisionReason);
  // Kan vi ikke si noe om utfallet, er statusen det eneste vi har — den skal ikke ligge bak et klikk.
  if (outcome === "unknown") open.push(ROWS.status);

  if (outcome !== "unknown") detail.push(ROWS.status);

  // Poengsummen står i overskriften for et avgjort utfall. Under vurdering er den ikke endelig, og
  // hører hjemme blant detaljene.
  if (outcome === "review" || outcome === "pending") {
    detail.push(ROWS.totalScore);
    // ⚠️ For en REN flervalgsmodul er totalen og flervalgspoengene samme tall, og det samme gjelder
    // en ren fritekstmodul og den praktiske poengsummen. Overskrifta har slått dem sammen siden
    // første utkast — men detaljradene gjorde det ikke, så vente-tilstandene viste «TOTAL POENGSUM
    // 64 / MCQ-POENG 64» rett under hverandre. Funnet ved å SE på den ekte siden; ingen måling
    // fanget det, fordi to like tall ikke er et avvik i seg selv.
    if (!isFreetextOnly && !isMcqOnly) detail.push(ROWS.mcqScore);
    if (!isMcqOnly && !isFreetextOnly) detail.push(ROWS.practicalScore);
  }

  detail.push(ROWS.decision);
  if (hasDecisionReason && !open.includes(ROWS.decisionReason)) detail.push(ROWS.decisionReason);
  // Tom rad som sier at den er tom — den vises ikke lenger.
  if (hasConfidence) detail.push(ROWS.confidence);
  detail.push(ROWS.submissionId);

  return { open, detail };
}

const DETAILS_STORAGE_KEY = "participant.resultDetailsOpen";

/**
 * Husker om deltakeren åpnet detaljene. Per nettleser — det er en bekvemmelighet, ikke data.
 *
 * ⚠️ Både lesing og skriving må tåle å kaste. En nettleser i privat modus, eller med
 * lagring avslått, feiler på selve oppslaget — og en resultatskjerm skal ikke bli blank fordi vi
 * ikke fikk huske en utfelling.
 */
export function readDetailsOpen(storage) {
  try {
    return storage?.getItem(DETAILS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeDetailsOpen(storage, open) {
  try {
    storage?.setItem(DETAILS_STORAGE_KEY, open ? "true" : "false");
  } catch {
    /* uten lagring starter detaljene lukket hver gang — det er en akseptabel nedgradering */
  }
}
