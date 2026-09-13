// #1046 J6: tom tabell = bare teksten, ikke et tomt tabellhode. ÉN regel for rapporttabellene
// (Resultater, Status). Listesida (list-page.js) har sin egen tomtilstand med tittel og knapp —
// den er en annen ting (en tom LISTE man kan fylle), ikke en rapport uten rader.
//
//   setTableEmpty(tbody, null)      → rader finnes: tabellen vises, teksten skjules
//   setTableEmpty(tbody, "")        → tom, uten egen tekst (forklaringen står alt over tabellen)
//   setTableEmpty(tbody, "Ingen …") → tom, teksten står der tabellen var
import { setHidden } from "./dom-visibility.js";

export function setTableEmpty(tbody, message) {
  const wrap = tbody?.closest(".list-table-wrap");
  if (!wrap) return;
  let note = wrap.nextElementSibling;
  if (!note || !note.classList.contains("table-empty-note")) {
    note = document.createElement("p");
    note.className = "small table-empty-note";
    wrap.after(note);
  }
  const hasRows = message === null || message === undefined;
  setHidden(wrap, !hasRows);
  setHidden(note, hasRows || !message);
  note.textContent = message ?? "";
}
