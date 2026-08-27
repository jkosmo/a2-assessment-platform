/**
 * #982: hva en KOPI skal si om innholdets oversettelsesstatus.
 *
 * ⚠️ Trukket ut av `admin-content-shell.js` fordi regelen ikke var testbar der — den var en
 * modul-lokal funksjon, og en e2e måtte laste et helt modulbunt for å komme til den. En regel som
 * bare kan prøves gjennom hele flaten, blir i praksis ikke prøvd.
 *
 * Invarianten (#892): en tekst som ikke er oversatt skal se uoversatt ut. Fyller man alle tre
 * lokaler med samme tekst, kan ingen etterpå skille «oversatt til bokmål» fra «det sto bokmål der
 * fra før». `missingLocalesFor` finner ingenting å savne, publiseringsgaten slipper modulen
 * gjennom, og en nynorskdeltaker får bokmål uten at noe sier fra.
 */

/**
 * Et lokalisert språkkart, eller null hvis verdien er én tekst uten språkmerke.
 *
 * ⚠️ Verdien kan være en JSON-STRENG, ikke et objekt — lokaliserte tekster lagres som tekst i
 * databasen. `typeof value === "object"` alene traff derfor ikke et lagret kart i det hele tatt,
 * og hele objekt-grenen sto ubrukt mens streng-grenen gjorde skaden.
 */
export function parseLocalizedMap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null; // ren streng = ett språk, ikke oversatt
  }
}

/**
 * Kopiens tittel, med samme oversettelsesstatus som originalen.
 *
 * Returnerer:
 *   - ren streng  → originalen var uoversatt, og kopien er det også
 *   - fullt kart  → alle språk var oversatt
 *   - delvis kart → bare de språkene som faktisk hadde tekst
 */
export function buildLocalizedCopyValue(value, { locales, suffix, fallbackLabel }) {
  const withSuffix = (text) => `${text} ${suffix}`.trim();
  const map = parseLocalizedMap(value);

  if (map) {
    const filled = {};
    for (const locale of locales) {
      const text = String(map[locale] ?? "").trim();
      if (text) filled[locale] = withSuffix(text);
    }
    if (Object.keys(filled).length > 0) return filled;
  }

  const fallback = typeof value === "string" ? value.trim() : "";
  return withSuffix(fallback || fallbackLabel);
}

/**
 * Sant når kartet mangler minst ett språk.
 *
 * Kalleren trenger dette fordi opprettelsen (`localizedTextSchema`) godtar EN STRENG eller ALLE
 * TRE — ikke noe imellom. Et delvis kart må derfor settes med en PATCH etterpå.
 */
export function isPartialLocalizedMap(value, locales) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && locales.some((locale) => !value[locale]);
}

/**
 * #982: hva vi beholder fra et oversettelsessvar.
 *
 * ⚠️ Skrev tidligere `draft?.taskText ?? taskText` — altså kildeteksten — inn i mållokalen når
 * svaret var tomt. Kartet så komplett ut, og en oversettelse som aldri kom ble umulig å skille fra
 * en ekte. Regelen er trukket ut hit fordi den lå inne i en funksjon som gjør nettverkskall, og
 * dermed bare kunne prøves gjennom hele forfatterflaten.
 *
 * Returnerer `null` når svaret ikke er en oversettelse i det hele tatt — da skal lokalen SLIPPES,
 * ikke fylles. Ellers de feltene som faktisk har innhold; et felt som mangler er ikke oversatt, og
 * skal heller ikke fylles med kilde.
 */
export function selectTranslatedDraftFields(draft) {
  if (!draft?.taskText) return null;
  const fields = { taskText: draft.taskText };
  if (draft.assessorExpectedContent) fields.assessorExpectedContent = draft.assessorExpectedContent;
  if (draft.candidateTaskConstraints) fields.candidateTaskConstraints = draft.candidateTaskConstraints;
  return fields;
}
