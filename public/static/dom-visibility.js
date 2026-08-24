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
//
// #975: de to mekanismene taper cascaden på HVER SIN måte, og forskjellen avgjør hva som faktisk
// er ødelagt i dag:
//   • `.hidden`-KLASSEN er en forfatter-regel (shared.css:847). Den taper bare mot forfatter-regler
//     som kommer SENERE eller er mer spesifikke — i praksis `<style>`-blokkene i HTML-sidene.
//   • `hidden`-ATTRIBUTTET er bare UA-arkets regel. Origin slår spesifisitet, så det taper mot
//     ENHVER forfatter-regel som setter display — også `.workspace-nav{display:flex}` i shared.css.
// Attributtet er altså det klart farligste, og alle sju feilene #975 fant i nettleseren var
// `el.hidden = …`, ikke `.hidden`-klassen.
//
// Derfor setter `setHidden` BEGGE: attributtet bærer semantikken (hjelpemidler, og kode som LESER
// `el.hidden` — f.eks. utfoldingen i participant.js), mens inline `style.display` gjør selve
// skjulingen. Å sette bare inline display var også en felle i seg selv: et element som står med
// `hidden` i markupen ble aldri synlig igjen av `setHidden(el, false)`, fordi attributtet overlevde
// (se kommentaren ved `tabPanelSettings` i admin-content.html).
export function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = hidden;
  el.style.display = hidden ? "none" : "";
}
