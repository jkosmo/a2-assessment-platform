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
  return `${shown.join("")}<details class="row-more"><summary class="row-action-btn">${moreLabel}</summary><div class="row-more-menu">${rest.join("")}</div></details>`;
}

/**
 * #1169 skive 2 (doc/DECISIONS.md, produkteier 26. og 28.11.2026): hodet har faste plasser, i denne rekkefølgen —
 *   hovedhandlingen for tilstanden (`primary`, en fylt knapp) · innholdsverktøyene (`tools`, bare modulen) · «Mer» (`more`).
 * «Mer» står alltid når den har noe i seg, også med én handling, og rekkefølgen inni den er sidens (fast: Dupliser · Eksporter
 * · Erstatt fra fil · Forkast utkast · Avpubliser · Arkiver / Gjenopprett · Slett). På smal skjerm (`narrow`) legges verktøyene
 * først i «Mer» i stedet for å stå som egne knapper (de ga fire linjer med knapper på 390 px).
 *
 * #1169 skive 3: radene i listene bruker samme regel — `primary` er «Åpne» og hovedhandlingen (uten fyll i en rad), og `after`
 * er merket «Kun for eier» etter «Mer».
 *
 * @param {{ primary?: Array<string|false|null|undefined>, tools?: Array<string|false|null|undefined>, more?: Array<string|false|null|undefined>, after?: Array<string|false|null|undefined> }} slots
 * @param {{ moreLabel?: string, narrow?: boolean }} [options]
 */
export function slotActionsHtml(slots, options = {}) {
  const keep = (list) => (list ?? []).filter((b) => typeof b === "string" && b.trim().length > 0);
  const moreLabel = options.moreLabel ?? "Mer";
  const primary = keep(slots.primary);
  const tools = keep(slots.tools);
  const more = [...(options.narrow ? tools : []), ...keep(slots.more)];
  const menu = more.length
    ? `<details class="row-more"><summary class="row-action-btn">${moreLabel}</summary><div class="row-more-menu">${more.join("")}</div></details>`
    : "";
  return primary.join("") + (options.narrow ? "" : tools.join("")) + menu + keep(slots.after).join("");
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
    // #1169: menyen henger fra høyre kant av «Mer». Står «Mer» langt til venstre (telefon, når raden brekker), gikk menyen ut av
    // skjermen. Da åpner den mot høyre i stedet.
    if (menu) {
      menu.classList.remove("row-more-menu--start");
      if (menu.getBoundingClientRect().left < 0) menu.classList.add("row-more-menu--start");
    }
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
    for (const open of root.querySelectorAll("details.row-more[open]")) {
      // QA-porten 2.189.0: stod fokuset på et valg i menyen, ble det liggende i det skjulte innholdet. «Mer» får det.
      const hadFocus = open.contains(document.activeElement) && !open.querySelector("summary")?.contains(document.activeElement);
      open.removeAttribute("open");
      if (hadFocus) open.querySelector("summary")?.focus();
    }
  });
}
