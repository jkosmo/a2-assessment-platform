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
export function detectSectionRoute(search) {
  const params = new URLSearchParams(search ?? "");
  if (params.has("new")) return { view: "editor", sectionId: null };
  const id = params.get("id");
  if (id) return { view: "editor", sectionId: id };
  return { view: "list" };
}
