// #1046 D5: knapperaden i listene, én regel for alle fire listesidene (moduler, kurs, seksjoner,
// klasser).
//
// Regelen: raden brekker aldri til to linjer. Målt på galleribildene (1280 px bredt) er det plass
// til fire korte knapper i handlingskolonnen. Er det flere handlinger, viser raden de tre første
// pluss «Mer», og resten ligger i menyen under den. Rekkefølgen sidene sender inn er rekkefølgen
// som vises — fra det ufarlige til det farlige, venstre mot høyre (D2).
//
// «Mer» er et <details>-element: åpne/lukke virker uten skript og med tastatur. Skriptet under
// gjør bare to ting: lukker menyen når man klikker utenfor, og når man har valgt noe i den.

export const ROW_ACTIONS_MAX = 4;

/**
 * @param {Array<string | null | undefined | false>} buttons ferdig HTML for hver knapp, i rekkefølge;
 *   tomme verdier hoppes over
 * @param {{ max?: number, moreLabel?: string }} [options]
 * @returns {string} HTML for innholdet i `.row-actions`
 */
export function rowActionsHtml(buttons, options = {}) {
  const max = options.max ?? ROW_ACTIONS_MAX;
  const moreLabel = options.moreLabel ?? "Mer";
  const items = buttons.filter((b) => typeof b === "string" && b.trim().length > 0);
  if (items.length <= max) return items.join("");
  const shown = items.slice(0, max - 1);
  const rest = items.slice(max - 1);
  return `${shown.join("")}<details class="row-more"><summary class="row-action-btn" aria-label="${moreLabel} handlinger">${moreLabel}</summary><div class="row-more-menu">${rest.join("")}</div></details>`;
}

let installed = false;

// #1081: menyen henger under knappen, og tabellrammen klipper alt som stikker ut av den (ramma har
// `overflow-x: auto`, og da klipper nettleseren begge akser). I nederste rad lå derfor handlingene
// under «Mer» skjult bak rammekanten. Løsningen måler i stedet for å anta en høyde: når en meny
// åpnes, får den nærmeste ramma som klipper akkurat så mye luft i bunnen som menyen trenger, og
// lufta tas tilbake når menyen lukkes. Virker uansett rad, antall rader og antall valg i menyen.
const ROOM_MARK = "rowMoreRoom";

function clippingAncestor(el) {
  for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    if (getComputedStyle(node).overflowY !== "visible") return node;
  }
  return null;
}

function fitOpenMenus(root) {
  for (const el of root.querySelectorAll(`[data-row-more-room]`)) {
    el.style.paddingBottom = "";
    delete el.dataset[ROOM_MARK];
  }
  for (const open of root.querySelectorAll("details.row-more[open]")) {
    const menu = open.querySelector(".row-more-menu");
    const clip = clippingAncestor(open);
    if (!menu || !clip) continue;
    const over = menu.getBoundingClientRect().bottom - clip.getBoundingClientRect().bottom;
    if (over <= 0) continue;
    const own = Number.parseFloat(getComputedStyle(clip).paddingBottom) || 0;
    clip.style.paddingBottom = `${Math.ceil(own + over) + 8}px`;
    clip.dataset[ROOM_MARK] = "1";
  }
}

/** Lukker åpne «Mer»-menyer ved klikk utenfor og etter et valg. Trygt å kalle flere ganger. */
export function installRowMoreMenus(root = document) {
  if (installed) return;
  installed = true;
  // `toggle` bobler ikke, så den fanges på vei ned. Den fyrer både når <details> åpnes og lukkes —
  // også når skriptet under lukker den — så lufta følger menyen uansett hvordan den ble lukket.
  root.addEventListener("toggle", (event) => {
    if (event.target instanceof Element && event.target.matches("details.row-more")) fitOpenMenus(root);
  }, true);
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const inside = target?.closest(".row-more");
    for (const open of root.querySelectorAll("details.row-more[open]")) {
      if (open !== inside) open.removeAttribute("open");
    }
    // Et valg i menyen lukker den. Klikk på selve «Mer» (summary) lar <details> styre.
    if (inside && target && !target.closest("summary")) inside.removeAttribute("open");
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const open of root.querySelectorAll("details.row-more[open]")) open.removeAttribute("open");
  });
}
