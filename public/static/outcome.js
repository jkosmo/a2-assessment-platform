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

/**
 * Statusene som bærer et AUTORITATIVT utfall. Alt annet er uavklart.
 *
 * ⚠️ DETTE VAR EN SVARTELISTE, og QA-porten fant feilen. Den listet `UNDER_REVIEW` og `SCORED` som
 * uavklarte og regnet ALT annet som avgjort — inkludert `PROCESSING`, `SUBMITTED` og en hvilken
 * som helst ukjent streng.
 *
 * Konsekvensen var levende: en innlevering under behandling med `passFailTotal: true` ble vist som
 * BESTÅTT, med konfetti, før vurderingen var ferdig. Verdien finnes allerede på det tidspunktet —
 * det er nettopp derfor statusen må bestemme.
 *
 * En hvitliste kan ikke feile på den måten: en ny status i enumet er uavklart til noen aktivt
 * legger den til her. En svarteliste antar at alt ukjent er trygt, som er feil retning for en
 * regel om hva som er endelig.
 *
 * `REJECTED` er med fordi den ER et endelig utfall, selv om ingen kodesti skriver den i dag (#953).
 */
const SETTLED_STATUSES = new Set(["COMPLETED", "REJECTED"]);

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
  const hasDecision = passFailTotal === true || passFailTotal === false;

  if (!SETTLED_STATUSES.has(normalizeStatus(submissionStatus))) {
    // ⚠️ Skillet mellom `pending` og `unknown` er ikke kosmetisk: `pending` sier «dette behandles»,
    // `unknown` sier «vi vet ingenting». En rad uten beslutning OG uten avgjort status er det
    // siste — å vise den som «under behandling» ville vært en påstand vi ikke har dekning for.
    return hasDecision ? OUTCOME_PENDING : OUTCOME_UNKNOWN;
  }

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
 * Det finnes et strykvedtak å anke. Statusen teller IKKE.
 *
 * ⚠️ DETTE VAR OMVENDT I FØRSTE UTKAST, og korreksjonen er verdt å lese.
 *
 * `participant-completed.js` krevde `latestStatus === "COMPLETED"`; resultatbanneret gjorde det
 * ikke. Jeg kanoniserte den strengeste med begrunnelsen «man kan ikke anke noe som fortsatt
 * vurderes» — som hørtes riktig ut, men var en regel jeg fant på.
 *
 * Produkteier 2026-08-24: *«Anke er kraftigere lut enn manuell behandling, jeg kan heller ikke se
 * negative konsekvenser av dette, så la oss ikke lage en regel uten skjellig grunn.»*
 *
 * En anke er altså ikke et NESTE steg etter manuell vurdering — den er et sterkere virkemiddel,
 * og kandidaten skal kunne velge det med en gang. Serveren har alltid tillatt det; det var
 * klienten som var i ferd med å bli strengere enn serveren, og det er den farlige retningen:
 * regelen SER håndhevet ut mens ethvert annet kall går rundt den.
 *
 * ⚠️ Dobbeltanke er ikke en risiko her: `appealService` avviser en ny anke når det allerede
 * finnes en åpen på innleveringen. Sperren ligger der den skal.
 *
 * @param {{ passFailTotal?: unknown, submissionStatus?: unknown }} input
 * @returns {boolean}
 */
export function isAppealableFail(input) {
  return rawPassFailState(input?.passFailTotal) === OUTCOME_FAILED;
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
