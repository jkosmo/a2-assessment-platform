// #596 (EPIC #595) slice 3 — single source of truth for initial-locale resolution.
//
// Replaces 9 copies of `resolveInitialLocale` across the page scripts (review, admin-content,
// calibration, participant, participant-completed, profile, results, certificate, admin-platform).
// `supportedLocales` is passed in because each page imports its own (identical) list from its
// translations module.
//
// Behaviour matches the dominant 8 copies: a valid stored "participant.locale" wins, otherwise the
// browser language prefix maps nb/nn/en → nb/nn/en-GB, otherwise "en-GB". (certificate.js omitted
// the `en` branch, but since the default is also "en-GB" its output was identical.) results.js
// previously matched via `supportedLocales.find(l => browser.startsWith(l))` WITHOUT a null guard —
// folding it in here removes that latent throw on a null `navigator.language`; the output is the
// same for every real browser string.
export function resolveInitialLocale(supportedLocales) {
  const stored = localStorage.getItem("participant.locale");
  if (stored && supportedLocales.includes(stored)) return stored;
  const normalized = (navigator.language ?? "").toLowerCase();
  if (normalized.startsWith("nb")) return "nb";
  if (normalized.startsWith("nn")) return "nn";
  if (normalized.startsWith("en")) return "en-GB";
  return "en-GB";
}
