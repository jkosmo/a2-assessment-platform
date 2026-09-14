// Lokaliserte verdier slik de lagres: `{ nb: "...", "en-GB": "..." }` — eller en bar streng fra før
// språket ble registrert. Delt mellom skallet og Innstillinger-fanen (#1046 punkt 2).

// The stored value read as one language.
//
// A bare string is legacy content whose language was never recorded, and the SERVER resolves it as
// nb (`missingLocalesFor`'s sourceLocale default). The client must agree, or the two disagree
// about the same bytes: this used to hand the string back for whatever locale was asked, so with
// an English UI a Norwegian legacy title was accepted as the en-GB source, saved under en-GB, and
// nb ended up missing — the republish then failed on a gap the gap-fill had just created.
export const LEGACY_STRING_LOCALE = "nb";

/**
 * #896 S3c: replace ONE locale in a stored localized value, keeping the others.
 *
 * The composer writes `promptTemplate.systemPrompt` verbatim — it does not merge. So an editor that
 * edits one language has to do the merging itself, or the two languages it never showed are gone.
 * That exact mistake has been made three times in this epic (title #892, description and
 * certification level in S3b); this helper exists so it is made once and fixed once.
 */
export function mergeLocaleInto(stored, locale, text) {
  const next = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === "string" && value.trim()) next[key] = value;
    }
  } else if (typeof stored === "string" && stored.trim()) {
    // A bare string is legacy content the server reads as nb (#896 S4).
    next[LEGACY_STRING_LOCALE] = stored;
  }
  if (typeof text === "string" && text.trim()) next[locale] = text;
  else delete next[locale];
  return Object.keys(next).length > 0 ? next : undefined;
}
