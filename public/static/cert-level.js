/**
 * #1045: ÉN måte å vise et sertifiseringsnivå på.
 *
 * ⚠️ FIRE FLATER, TRE NØKKELFAMILIER, TO UTEN. Da saken ble tatt viste admin `shell.certLevel.*`,
 * kursbeviset `certLevel.*`, deltakerkonsollet `modules.levelBadge.*` — og profilen og
 * fullførte-lista viste råverdien «basic» rett fra databasen. Familiene var dessuten uenige:
 * deltakeren så «Middels» på modulbadgen og «Videregående» på kursbeviset for SAMME nivå.
 *
 * ⚠️ NIVÅ ER ET LUKKET SETT AV NØKLER. `CERTIFICATION_LEVELS` er tre verdier, `LEVEL_SCOPE` og
 * nedtrekkslista bygger på dem (#1049). Kolonnen inneholder likevel to former — nøkler, og
 * språkkart fra da feltet var fritekst. Denne hjelperen behandler begge: en kjent nøkkel slås opp,
 * alt annet vises som det er. Det er arv, ikke innhold, og skal ikke oversettes.
 *
 * Nøklene bor i `participant-translations.js` (basen alle bundlene arver fra). De tre eldre
 * familiene står igjen inntil videre; en vakt holder dem enige med basen så de kan slettes trygt.
 */

const KJENTE = new Set(["basic", "intermediate", "advanced"]);

/**
 * Normaliser det databasen kan inneholde til en nøkkel, eller null.
 * - "basic" → "basic"
 * - {"nb":"basic","en-GB":"basic"} → "basic" (språkkart der alle verdier er nøkkelen)
 * - "Nivå 1" / {"nb":"Viderekommen"} → null (arv)
 */
export function certLevelKey(value) {
  if (typeof value === "string") {
    const k = value.trim().toLowerCase();
    return KJENTE.has(k) ? k : null;
  }
  if (value && typeof value === "object") {
    const first = Object.values(value).find((v) => typeof v === "string" && v.trim().length > 0);
    if (typeof first === "string") {
      const k = first.trim().toLowerCase();
      return KJENTE.has(k) ? k : null;
    }
  }
  return null;
}

/**
 * Tekst for visning. `t` er flatens egen oversetter; nøklene arves fra basen.
 * Ukjent form vises som den er — en verdi som «Nivå 1» er noen forfatters ord, ikke en feil.
 */
export function localizeCertLevel(value, t, { empty = "—" } = {}) {
  const key = certLevelKey(value);
  if (key) {
    const label = t(`certLevel.${key}`);
    if (typeof label === "string" && label !== `certLevel.${key}`) return label;
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const first = Object.values(value).find((v) => typeof v === "string" && v.trim().length > 0);
    if (first) return first.trim();
  }
  return empty;
}
