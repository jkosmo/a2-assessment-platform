// #596 (EPIC #595) slice 2 — single source of truth for number formatting.
//
// Replaces 7 near-identical `formatNumber` copies (participant.js, participant-completed.js,
// profile.js, calibration.js, admin-content.js, review.js, static/admin-content-calibration.js).
// All used `Intl.NumberFormat(currentLocale, { minimumFractionDigits: 0, maximumFractionDigits })`
// with a non-number guard; the ONLY difference was the placeholder ("-" everywhere except
// profile.js which used the em-dash "—").
//
// Each host file owns its OWN mutable `currentLocale`, so this is a factory: pass a locale GETTER
// that is read lazily at call time. That keeps every call site unchanged — `formatNumber(value)` /
// `formatNumber(value, maxFractionDigits)` — while the formatting logic lives in one place.
export function createNumberFormatter(getLocale, placeholder = "-") {
  return function formatNumber(value, maxFractionDigits = 2) {
    if (typeof value !== "number") return placeholder;
    return new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    }).format(value);
  };
}
