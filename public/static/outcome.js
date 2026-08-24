// #978: ETT sted som avgjør «er dette forsøket bestått».
//
// ⚠️ Hvorfor denne fila finnes.
//
// Spørsmålet ble besvart åtte steder i klienten, etter TRE ulike regelsett:
//
//   1. `outcomeClass` / `localizeDecisionType` i participant.js  — ser `submissionStatus`
//   2. participant-completed.js, profile.js, admin-content-calibration.js — rå tri-state på
//      `passFailTotal`, statusen ignoreres
//   3. review.js — to formattere for samme verdi, i samme fil
//
// Konsekvensen var to svar til samme deltaker i samme økt: en innlevering med
// `passFailTotal === false` mens den fortsatt er UNDER_REVIEW vises som rød «Ikke bestått» på
// /profile og /participant/completed, mens resultatbanneret holder den nøytral.
//
// ⚠️ MEN «ER DETTE BESTÅTT» ER IKKE ÉTT SPØRSMÅL. Kartleggingen av alle 24 kallstedene viste at de
// deler seg i flere, og at de har ULIKE riktige svar:
//
//   «hva skal jeg VISE?»        → statusen teller. En uavgjort sak er ikke en fail.
//   «kan hen anke?»             → statusen teller. Man kan ikke anke noe som ennå vurderes.
//   «har hen alt bestått?»      → statusen teller IKKE. Se `hasPassingDecision` under.
//
// Derfor er dette fire navngitte funksjoner og ikke én. Å feie alle kallstedene inn i én
// hjelpefunksjon ville vært å gjenta feilen i motsatt retning: ett svar der det trengs flere.
// Kalleren må si hvilket spørsmål den stiller — det er #958-formen, anvendt på klienten.
//
// `test/outcome-derivation-guard.test.js` nekter nye rå `passFailTotal ===`-sammenligninger
// utenfor denne fila.

/** Avgjort bestått. */
export const OUTCOME_PASSED = "passed";
/** Avgjort ikke bestått. */
export const OUTCOME_FAILED = "failed";
/** Under behandling — utfallet er ikke avgjort ennå, uansett hva `passFailTotal` sier. */
export const OUTCOME_PENDING = "pending";
/** Ingen beslutning finnes. */
export const OUTCOME_UNKNOWN = "unknown";

/** Statusen som betyr «ikke avgjort ennå». */
const UNDER_REVIEW = "UNDER_REVIEW";

function normalizeStatus(submissionStatus) {
  return typeof submissionStatus === "string" ? submissionStatus.toUpperCase() : "";
}

/**
 * «Hva skal jeg VISE for dette forsøket?»
 *
 * Den kanoniske regelen, hentet fra `outcomeClass` i participant.js — den eneste av de tre
 * variantene som var riktig.
 *
 * ⚠️ Rekkefølgen er regelen: statusen sjekkes FØRST. En innlevering under vurdering er `pending`
 * selv når `passFailTotal` allerede er satt, fordi verdien kan bli overstyrt av vurdereren. Å
 * vise «Ikke bestått» på noe som ennå behandles er både feil og unødig nedslående.
 *
 * @param {{ passFailTotal?: unknown, submissionStatus?: unknown }} input
 * @returns {"passed"|"failed"|"pending"|"unknown"}
 */
export function deriveOutcome(input) {
  const { passFailTotal, submissionStatus } = input ?? {};
  if (normalizeStatus(submissionStatus) === UNDER_REVIEW) return OUTCOME_PENDING;
  if (passFailTotal === true) return OUTCOME_PASSED;
  if (passFailTotal === false) return OUTCOME_FAILED;
  return OUTCOME_UNKNOWN;
}

/**
 * CSS-klassen for et utfall. Tom streng for `unknown`, slik at kallstedet kan sette den
 * ubetinget uten å måtte teste først.
 *
 * @param {"passed"|"failed"|"pending"|"unknown"} outcome
 * @returns {string}
 */
export function outcomeClass(outcome) {
  if (outcome === OUTCOME_PENDING) return "outcome--review";
  if (outcome === OUTCOME_PASSED) return "outcome--pass";
  if (outcome === OUTCOME_FAILED) return "outcome--fail";
  return "";
}

/**
 * «Kan deltakeren anke dette forsøket?»
 *
 * ⚠️ Denne fantes allerede — riktig — ett sted: `participant-completed.js` krevde
 * `latestStatus === "COMPLETED"` før anke-lenka ble vist. Resultatbanneret i participant.js gjorde
 * det IKKE, og tilbød anke på en innlevering som fortsatt var under vurdering.
 *
 * To innganger til samme handling, to svar. Den strengeste var den riktige: en sak som allerede
 * behandles kan ikke ankes — ankebehandleren ville fått en anke på et vedtak som ikke er endelig.
 *
 * ⚠️ Merk at kravet er `COMPLETED`, ikke bare «ikke UNDER_REVIEW». Det er bevisst strengere enn
 * `deriveOutcome`: en innlevering i en hvilken som helst mellomtilstand har ikke et endelig
 * vedtak å anke. Å bruke `deriveOutcome` alene her ville LØSNET regelen fra
 * `participant-completed.js`, altså rettet divergensen i feil retning.
 *
 * @param {{ passFailTotal?: unknown, submissionStatus?: unknown }} input
 * @returns {boolean}
 */
export function isAppealableFail(input) {
  const settled = normalizeStatus(input?.submissionStatus) === "COMPLETED";
  return settled && deriveOutcome(input) === OUTCOME_FAILED;
}

/**
 * «Har deltakeren allerede en beståttbeslutning på denne modulen?»
 *
 * ⚠️ DENNE SER MED VILJE BORT FRA STATUSEN, og det er den eneste som gjør det.
 *
 * Brukes til å la være å starte et nytt forsøk automatisk (MCQ-only-modulene starter ellers med
 * én gang), og til å unngå en unødig retake som gir 409. Spørsmålet er «finnes det allerede en
 * bestått her», ikke «er den endelig».
 *
 * Ville vi krevd avgjort status, ville en bestått-men-under-vurdering modul startet et nytt
 * forsøk av seg selv — altså det motsatte av hensikten. Her er en falsk positiv ufarlig (vi lar
 * være å autostarte) mens en falsk negativ er skadelig.
 *
 * @param {unknown} passFailTotal
 * @returns {boolean}
 */
export function hasPassingDecision(passFailTotal) {
  return passFailTotal === true;
}

/**
 * «Hva SIER vedtaket, uavhengig av om det er endelig?»
 *
 * ⚠️ For PRAKTIKERFLATER — vurdererkøen, ankekøen, kalibreringsarbeidsflaten. Der er jobben
 * nettopp å inspisere den automatiske beslutningen, og å skjule den bak «under vurdering» ville
 * fjernet informasjonen brukeren er der for å vurdere.
 *
 * Skillet er hvem som leser: en kandidat skal ikke se «Ikke bestått» på noe som ennå kan endres,
 * mens en vurderer skal se nøyaktig hva maskinen foreslo. Begge praktikerflatene viser dessuten
 * `submissionStatus` i en egen kolonne ved siden av, så konteksten går ikke tapt.
 *
 * Dette er grunnen til at #978 løses med fem navngitte spørsmål og ikke én hjelpefunksjon: de
 * fem har ULIKE riktige svar, og en felles «bestått?» ville tvunget fram ett av dem overalt.
 *
 * @param {unknown} passFailTotal
 * @returns {"passed"|"failed"|"unknown"}
 */
export function rawPassFailState(passFailTotal) {
  if (passFailTotal === true) return OUTCOME_PASSED;
  if (passFailTotal === false) return OUTCOME_FAILED;
  return OUTCOME_UNKNOWN;
}

/**
 * «Skal vi feire?»
 *
 * Bare et AVGJORT bestått. En feiring med konfetti på noe som fortsatt vurderes måtte i verste
 * fall trekkes tilbake, og det er en verre opplevelse enn å vente noen minutter på den.
 *
 * @param {{ passFailTotal?: unknown, submissionStatus?: unknown }} input
 * @returns {boolean}
 */
export function isSettledPass(input) {
  return deriveOutcome(input) === OUTCOME_PASSED;
}
