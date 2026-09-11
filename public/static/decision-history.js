import { OUTCOME_PENDING, deriveOutcome, rawPassFailState } from "/static/outcome.js";

/**
 * #1034: raden for et vedtak i sensorens beslutningshistorikk — HVEM og HVA.
 *
 * ⚠️ Etiketten var fast: «Vurderer-overstyring» på HVERT vedtak, også det automatiske som lå og
 * ventet på at sensor skulle gjøre noe. Sammen med #948 — som lar et vedtak rutet til manuell
 * vurdering bære `passFailTotal: false` selv om terskelen passerte — leste raden
 * «Vurderer-overstyring · Ikke bestått · 72» der terskelen var 70. Det første tallet et menneske
 * ser setter forventningen, og her sa det «en kollega har alt strøket hen». Ingen hadde det.
 *
 * To ting, hver for seg:
 *   1. Etiketten følger `decisionType`. Et automatisk vedtak heter det.
 *   2. Verdien for et AUTOMATISK vedtak i en sak som fortsatt er åpen er «til vurdering», ikke
 *      ett av to utfall ingen har landet på. `deriveOutcome` er allerede regelen for «hva viser
 *      jeg» — statusen først, så flagget (FEATURE_SURFACE_MAP §28).
 *
 * ⚠️ Bare den automatiske raden leser status. En overstyring eller en ankebeslutning ER et
 * menneskes vedtak; der er `rawPassFailState` riktig, som før. Å la alle radene følge status
 * ville skjult et faktisk strykvedtak bak «til vurdering» så snart en anke åpnet saken igjen.
 */

const ACTOR_KEYS = Object.freeze({
  AUTOMATIC: "case.history.automatic",
  MANUAL_OVERRIDE: "case.history.review",
  APPEAL_RESOLUTION: "case.history.appealResolution",
});

/** i18n-nøkkelen for hvem som fattet vedtaket. Ukjent type → den gamle teksten, ikke en tom rad. */
export function decisionHistoryActorKey(decisionType) {
  return ACTOR_KEYS[decisionType] ?? ACTOR_KEYS.MANUAL_OVERRIDE;
}

/**
 * Hva raden skal si om utfallet.
 * @returns {"passed"|"failed"|"pending"|"unknown"}
 */
export function decisionHistoryOutcome({ decisionType, passFailTotal, submissionStatus }) {
  if (decisionType === "AUTOMATIC") {
    const outcome = deriveOutcome({ passFailTotal, submissionStatus });
    if (outcome === OUTCOME_PENDING) return OUTCOME_PENDING;
  }
  return rawPassFailState(passFailTotal);
}
