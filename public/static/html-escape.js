// #596 (EPIC #595) slice 1 — single source of truth for HTML escaping.
//
// Replaces 6 byte-identical copies that each did `String(x ?? "")` followed by the 4-char entity
// escape (& < > "): admin-content.js (escapeHtml), participant.js (escapeHtmlP),
// participant-completed.js (escapeHtmlC), results.js (escapeHtmlR), admin-content-courses.js and
// admin-content-library.js (escapeHtml). All six are ES modules and import this canonical version.
//
// Intentionally NOT folded in here (each is a real behaviour difference → its own follow-up slice):
//   - admin-content-preview.js / admin-content-shell.js / static/loading.js use `String(x)` WITHOUT
//     the `?? ""` guard, so null/undefined render as "null"/"undefined" rather than "".
//   - admin-content-sections.js also escapes the single quote (' → &#39;).
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
