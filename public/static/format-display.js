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

// #596 slice 4 — date-time formatting. Replaces 7 copies of `formatDateTime`/`formatDateTimeValue`
// (participant.js, participant-completed.js, profile.js, calibration.js, review.js, results.js,
// static/admin-content-calibration.js) that all did `Intl.DateTimeFormat(currentLocale,
// { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))` with a falsy guard and a
// try/catch → String(value) fallback. Same lazy-locale factory as numbers; the only difference was
// the falsy placeholder ("-" vs the em-dash "—", kept via the param). Date variants that differ in
// shape (dateStyle long/medium-only, the toLocaleDateString numeric form, and admin-content.js's
// NaN-guard variant) are intentionally left for later slices.
export function createDateTimeFormatter(getLocale, placeholder = "-") {
  return function formatDateTime(value) {
    if (!value) return placeholder;
    try {
      return new Intl.DateTimeFormat(getLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  };
}

// #596 slice 6 — short numeric date (no time). Consolidates the two identical `formatDate` copies
// in static/admin-content-courses.js and static/admin-content-library.js, which used
// `toLocaleDateString(currentLocale, { day: "numeric", month: "short", year: "numeric" })` with the
// em-dash placeholder. (The originals wrote `currentLocale === "en-GB" ? "en-GB" : currentLocale`,
// which is just `currentLocale` — both ternary branches are equal — so `getLocale()` is identical.)
// Single-of-a-kind date formatters elsewhere (certificate `dateStyle:"long"`, profile.formatDate
// `dateStyle:"medium"`, admin-content's NaN-guard variant) are distinct formats, not duplicates,
// and are intentionally left in place.
export function createDateFormatter(getLocale, placeholder = "—") {
  return function formatDate(iso) {
    if (!iso) return placeholder;
    return new Date(iso).toLocaleDateString(getLocale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };
}
