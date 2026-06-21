// Robust visibility toggling for the vanilla-JS frontend.
//
// WHY THIS EXISTS: the `.hidden` utility class is `display: none` WITHOUT `!important`, and several
// layout classes set `display` (`.row`, `.inline`, `.card`, `.content-card`, `.module-brief`,
// `.summary-grid`, …). Those rules are defined later in the cascade, so for an element carrying
// such a class the `.hidden` class (and the `[hidden]` attribute, which the UA sheet expresses the
// same way) is OVERRIDDEN — `el.classList.toggle("hidden", true)` / `el.hidden = true` then does
// nothing and the element stays visible. This has caused the same bug repeatedly
// (empty MCQ-only brief, content cards, threshold rows, ack labels — see CLAUDE.md).
//
// Inline `style.display` beats class rules, so toggling it is always correct. Use `setHidden` for
// ANY element that has (or might gain) a display-setting class. For plain elements the `.hidden`
// class is fine, but `setHidden` is safe everywhere, so prefer it for conditional UI.

export function setHidden(el, hidden) {
  if (!el) return;
  el.style.display = hidden ? "none" : "";
}
