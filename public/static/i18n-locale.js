import { getDefaultLocale } from "/static/api-client.js";
// #596 (EPIC #595) slice 3 — single source of truth for initial-locale resolution.
//
// Replaces 9 copies of `resolveInitialLocale` across the page scripts (review, admin-content,
// calibration, participant, participant-completed, profile, results, certificate, admin-platform).
// `supportedLocales` is passed in because each page imports its own (identical) list from its
// translations module.
//
// Behaviour matches the dominant 8 copies: a valid stored "participant.locale" wins, otherwise the
// browser language prefix maps nb/no/nn/en → nb/nb/nn/en-GB, otherwise the organisation default (#1191; was "en-GB"). (certificate.js omitted
// the `en` branch, but since the default is also "en-GB" its output was identical.) results.js
// previously matched via `supportedLocales.find(l => browser.startsWith(l))` WITHOUT a null guard —
// folding it in here removes that latent throw on a null `navigator.language`; the output is the
// same for every real browser string.
// #1191: sidene lagrer språket ved oppstart, også når det bare er gjettet ut fra nettleseren. Et gjettet en-GB (den gamle reserven
// for «no», «da», «sv» …) ble dermed et fast valg som slo alt annet. Et språk brukeren velger i språkvelgeren (#localeSelect, likt
// på alle sidene) merkes derfor her, ett sted for alle sidene.
const CHOSEN_LOCALE_KEY = "participant.localeChosen";
if (typeof document !== "undefined") {
  document.addEventListener("change", (event) => {
    const el = event.target;
    if (!el || el.id !== "localeSelect" || typeof el.value !== "string") return;
    try {
      localStorage.setItem(CHOSEN_LOCALE_KEY, el.value);
    } catch {
      // Blokkert lagring: valget huskes ikke som valgt, og et lagret en-GB kan bli gjettet på nytt neste gang.
    }
  });
}

export function resolveInitialLocale(supportedLocales) {
  const stored = localStorage.getItem("participant.locale");
  const normalized = (navigator.language ?? "").toLowerCase();
  if (stored && supportedLocales.includes(stored)) {
    // #1191: et lagret en-GB i en nettleser som ikke er engelsk, og som brukeren ikke har valgt selv, er den gamle reserven.
    // Da gjettes språket på nytt. Alt annet lagret står, også valg gjort før merket fantes.
    let chosen = null;
    try { chosen = localStorage.getItem(CHOSEN_LOCALE_KEY); } catch { /* blokkert lagring */ }
    const oldEnglishFallback = stored === "en-GB" && !normalized.startsWith("en") && chosen !== stored;
    if (!oldEnglishFallback) return stored;
  }
  // #1191: «no» er norsk uten målform (enkelte nettlesere oppgir det); bokmål, som tjeneren (src/i18n/locale.ts).
  if (normalized.startsWith("nb") || normalized === "no" || normalized.startsWith("no-")) return "nb";
  if (normalized.startsWith("nn")) return "nn";
  if (normalized.startsWith("en")) return "en-GB";
  // #1191: ukjent nettleserspråk («da», «sv», …) gir organisasjonens standardspråk, slik tjeneren gjør (DEFAULT_LOCALE), ikke
  // engelsk. Språket sendes som x-locale og blir mottakerens språk i e-postene, så engelsk her ga engelske e-poster.
  const orgDefault = getDefaultLocale();
  return supportedLocales.includes(orgDefault) ? orgDefault : "en-GB";
}

// #1046 punkt 3: ÉN oversetter for forfattersidene — fem sider hadde hver sin `t`/`tf` over det
// samme språkkartet (og skallets `tf` byttet bare første forekomst). Språket leses ved hvert kall,
// så et bytte i menyen virker uten at oversetteren lages på nytt.
export function createTranslator(translations, getLocale) {
  const t = (key) => translations[getLocale()]?.[key] ?? translations["en-GB"]?.[key] ?? key;
  const tf = (key, vars = {}) => {
    let s = t(key);
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
  return { t, tf };
}

// #1046 (produkteier 12.09: «Ja til NB som påkrevd»): når en innholdstekst mangler på leserens språk,
// vises organisasjonens standardspråk (nb hos A-2) — ikke engelsk. Samme regel som tjeneren
// (src/i18n/content.ts). Klientene brukte «?? value["en-GB"]» hver for seg; nå ett sted.
export function contentFallbackOrder(locale) {
  return [...new Set([locale, getDefaultLocale(), "en-GB"])];
}

/** Første ikke-tomme verdi i et språkkart, i rekkefølgen leserens språk → standardspråket → engelsk → det som finnes. */
export function pickLocalizedText(map, locale) {
  if (!map || typeof map !== "object") return "";
  for (const key of contentFallbackOrder(locale)) {
    const value = map[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  const first = Object.values(map).find((v) => typeof v === "string" && v.trim().length > 0);
  return typeof first === "string" ? first : "";
}
