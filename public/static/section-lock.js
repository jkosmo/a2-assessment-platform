/**
 * #976: lås en seksjon slik at den faktisk er låst — for mus, tastatur og skjermleser.
 */
// ⚠️ #976: EN LÅS SOM BARE LÅSTE TASTATURET. Denne satte `tabindex="-1"` og en klasse — ikke
// `disabled`. Alt inne i seksjonen som ikke var en av de fire navngitte knappene (som styres for
// seg i renderFlowGating) var fullt klikkbart med mus: MCQ-radioer, ankefeltet, lenker. Seksjonen
// SÅ låst ut og oppførte seg ikke slik.
//
// Nå settes `disabled` på skjemakontrollene også, med samme husk-og-gjenopprett som tabindex, så
// en kontroll som var deaktivert av en annen grunn ikke blir aktivert ved opplåsing. Lenker kan ikke
// deaktiveres; de får `aria-disabled` her, og CSS-en (`pointer-events: none` på `.section-locked`)
// tar museklikkene. `aria-disabled` på selve seksjonen gjør låsen hørbar for skjermlesere.
//
// ⚠️ De fire navngitte knappene beregner sin egen `disabled` ETTER dette, på hver render, og
// inkluderer allerede låsevilkåret — så de vinner uansett rekkefølge. Dette dekker resten.
export function setSectionLocked(section, locked) {
  section.classList.toggle("section-locked", locked);
  section.setAttribute("aria-disabled", locked ? "true" : "false");
  for (const el of section.querySelectorAll("button, input, textarea, select, a[href]")) {
    const erLenke = el.tagName === "A";
    if (locked) {
      el.dataset.preLockTabindex = el.getAttribute("tabindex") ?? "";
      el.setAttribute("tabindex", "-1");
      if (erLenke) {
        el.setAttribute("aria-disabled", "true");
      } else {
        // Husk om den ALLEREDE var deaktivert, ellers ville opplåsing skrudd på noe som skulle
        // vært av av en annen grunn.
        el.dataset.preLockDisabled = el.disabled ? "1" : "0";
        el.disabled = true;
      }
    } else {
      const pre = el.dataset.preLockTabindex;
      if (pre === "") {
        el.removeAttribute("tabindex");
      } else if (pre != null) {
        el.setAttribute("tabindex", pre);
      }
      delete el.dataset.preLockTabindex;
      if (erLenke) {
        el.removeAttribute("aria-disabled");
      } else if (el.dataset.preLockDisabled != null) {
        el.disabled = el.dataset.preLockDisabled === "1";
        delete el.dataset.preLockDisabled;
      }
    }
  }
}
