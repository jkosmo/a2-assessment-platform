// #524: pure, testable state helpers for the section editor (U1), extracted from
// admin-content-sections.js. No DOM/window access here — the editor imports these. The locale-
// validation logic below is the source of the «empty locale → 400» retest bug, so pulling it out gives
// it automatic coverage (see test/dom/admin-content-sections-state.dom.test.js).

export const SECTION_EDITOR_LOCALES = ["nb", "nn", "en-GB"];

// Only the locales the author actually filled. The API rejects empty strings (each present locale must
// be min 1 char) but accepts a partial object — so drop blank/whitespace-only locales before sending.
export function nonEmptyLocales(obj, locales = SECTION_EDITOR_LOCALES) {
  const out = {};
  for (const loc of locales) {
    if (((obj?.[loc]) ?? "").trim().length > 0) out[loc] = obj[loc];
  }
  return out;
}

// A section is savable only when BOTH title and body have at least one non-empty locale.
export function hasSavableContent(title, body, locales = SECTION_EDITOR_LOCALES) {
  return (
    Object.keys(nonEmptyLocales(title, locales)).length > 0 &&
    Object.keys(nonEmptyLocales(body, locales)).length > 0
  );
}

// Section route from a URL search string ("?id=abc" | "?new" | ""). Pure so it is testable without
// touching window.location.
/**
 * #1052: hvor «Tilbake» skal føre, når det finnes to veier inn.
 *
 * ⚠️ EN ÅPEN OMDIRIGERING ER DET LETTESTE Å GJØRE FEIL HER. `returnTo` kommer fra URL-en, altså fra
 * hvem som helst som kan få en forfatter til å klikke på en lenke. Uten denne kontrollen ville
 * `?returnTo=https://ondsinnet.example/logg-inn` gjort vår egen «Tilbake»-knapp til et
 * phishing-hopp — fra en side forfatteren stoler på.
 *
 * Derfor en HVITELISTE, ikke en svarteliste: bare en relativ sti under `/admin-content/` slipper
 * gjennom. Alt annet — absolutte URL-er, andre verter, punktumsegmenter, `javascript:` — faller
 * lar kalleren bruke sitt vanlige mål.
 *
 * `//vert` er verdt å nevne særskilt: den ser relativ ut fordi den starter med `/`, men nettleseren
 * leser den som protokollrelativ og går til en annen vert. En sjekk på «starter med /» alene er
 * derfor ikke nok.
 */
export function safeReturnTo(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!value.startsWith("/admin-content/")) return null;

  // ⚠️ PREFIKSET ALENE ER IKKE NOK, OG MUTASJONSTESTING MÅTTE FORTELLE MEG DET.
  //
  // Første utgave hadde en sjekk mot protokollrelative stier, med en selvsikker kommentar om at
  // den var nødvendig. Den var DØD KODE: alt slikt er allerede avvist av prefikset over. Da jeg
  // fjernet den, ble ingen test rød.
  //
  // Den ekte veien ut sto derimot åpen: `/admin-content/../../evil` består prefikssjekken, og
  // nettleseren løser den til `/evil`. Vi løser derfor stien og krever at den FORTSATT ligger
  // under /admin-content/ etterpå — forskjellen mellom å sjekke hva strengen SER UT SOM, og hva
  // nettleseren faktisk GJØR med den.
  let løst;
  try {
    løst = new URL(value, "https://intern.invalid");
  } catch {
    return null;
  }
  if (løst.origin !== "https://intern.invalid") return null;
  if (!løst.pathname.startsWith("/admin-content/")) return null;
  // Kodede segmenter løses ikke av `URL()`, så de avvises for seg.
  if (/%2e|%2f/i.test(value)) return null;
  return value;
}

export function detectSectionRoute(search) {
  const params = new URLSearchParams(search ?? "");
  const returnTo = safeReturnTo(params.get("returnTo"));
  if (params.has("new")) return { view: "editor", sectionId: null, returnTo };
  const id = params.get("id");
  if (id) return { view: "editor", sectionId: id, returnTo };
  return { view: "list", returnTo };
}
