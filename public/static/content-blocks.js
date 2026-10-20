// Innholdsblokker i seksjonstekst (#1079): «Kopier»-knappen i en prompt-boks, «sjekk deg selv»
// (#1074, med følge per alternativ #1110), steg for steg (#1075), skriv selv (#1076), repetisjonskort
// (#1078) og finn parene (#1107).
//
// Tjeneren tegner blokkene (src/modules/course/contentBlocks.ts), og alt kan leses uten skript.
// Klikk og taster fanges av én lytter på dokumentet, så de virker også for tekst som settes inn etter
// at siden er lastet (leseren, forhåndsvisningen). Steg, skriv selv og repetisjonskort trenger i
// tillegg å gjøres klare når de dukker opp (enhanceContentBlocks): det gjør en MutationObserver,
// av samme grunn.

const SHOWN_MS = 2000;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Uten tilgang til utklippstavla (eldre nettleser, ikke sikker side): marker teksten, så
    // deltakeren kan kopiere selv.
    return false;
  }
}

function selectText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// #1074 «Sjekk deg selv»: deltakeren velger ett alternativ. Det riktige markeres, et feil valg
// markeres som feil, og forklaringen vises. Ingenting sendes eller lagres — svaret teller ikke.
// aria-disabled, ikke disabled: fokus blir stående på knappen deltakeren trykket på, og
// tilbakemeldingen leses opp fra aria-live-feltet.
export function answerCheck(option) {
  const box = option.closest("[data-content-check]");
  if (!box || box.dataset.answered === "true") return;
  box.dataset.answered = "true";
  const right = option.dataset.correct === "true";
  for (const button of box.querySelectorAll("[data-check-option]")) {
    button.setAttribute("aria-disabled", "true");
    const mark = button.querySelector(".content-check-mark");
    if (button.dataset.correct === "true") {
      button.classList.add("is-correct");
      if (mark) mark.textContent = "✓";
    } else if (button === option) {
      button.classList.add("is-wrong");
      if (mark) mark.textContent = "✗";
    } else {
      button.classList.add("is-dimmed");
    }
  }
  option.setAttribute("aria-pressed", "true");
  // For skjermlesere: hvilket alternativ som er riktig, og hvilket deltakeren valgte (QA 2.94.0).
  const addSrText = (button, text) => {
    if (!button || !text) return;
    const span = document.createElement("span");
    span.className = "sr-only";
    span.textContent = ` (${text})`;
    button.appendChild(span);
  };
  addSrText(box.querySelector('[data-check-option][data-correct="true"]'), box.dataset.srRight);
  if (!right) addSrText(option, box.dataset.srChosen);
  // #1110: følgen til det valgte alternativet, hvis forfatteren har skrevet en. Plassen i rekken av
  // alternativer er nøkkelen — knappene bærer ingen egen merking, så HTML uten følger er som før.
  const index = [...box.querySelectorAll("[data-check-option]")].indexOf(option);
  const feedback = box.querySelector(`[data-check-feedback="${index}"]`);
  if (feedback) feedback.hidden = false;
  const explanation = box.querySelector(".content-check-explanation");
  if (explanation) explanation.hidden = false;
  const verdict = box.querySelector(".content-check-verdict");
  if (verdict) {
    verdict.classList.add(right ? "is-ok" : "is-bad");
    verdict.textContent = (right ? box.dataset.right : box.dataset.wrong) ?? "";
  }
}

if (typeof document !== "undefined") document.addEventListener("click", (event) => {
  const option = event.target instanceof Element ? event.target.closest("[data-check-option]") : null;
  if (option) answerCheck(option);
});

// Uten et dokument (en enhetstest som importerer en modul som importerer denne) er det ingenting å lytte på.
if (typeof document !== "undefined") document.addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest(".content-prompt-copy") : null;
  if (!button) return;
  const text = button.closest(".content-prompt")?.querySelector(".content-prompt-text");
  if (!text) return;

  if (!(await copyText(text.textContent ?? ""))) {
    selectText(text);
    return;
  }
  const label = button.dataset.label ?? button.textContent ?? "";
  button.dataset.label = label;
  button.textContent = button.dataset.copiedLabel || label;
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => {
    button.textContent = label;
  }, SHOWN_MS));
});

// ── Steg for steg, skriv selv, repetisjonskort (#1075, #1076, #1078) ────────────────────────────────
// Ingenting her sendes til tjeneren eller teller på resultatet. Tekstene (etikettene) kommer fra
// data-attributter tjeneren har satt på deltakerens språk; skriptet har ingen egne oversettelser.

const STEPS = "[data-content-steps]";
const WRITE = "[data-content-write]";
const FLASH = "[data-content-flash]";
const PAIRS = "[data-content-pairs]";

/** Fyller `{n}`, `{total}` … i en etikett fra tjeneren. */
function fillLabel(template, values) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (all, name) => (Object.hasOwn(values, name) ? String(values[name]) : all));
}

function makeButton(className, attribute, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `content-block-btn ${className}`;
  button.setAttribute(attribute, "");
  button.textContent = text;
  return button;
}

/** Elementene i en blokk, med tilstanden skriptet trenger. Kun i minnet — ingenting lagres (#1078). */
const blockState = new WeakMap();

// #1075: lista med alle stegene blir ett steg av gangen, med Forrige/Neste, «Steg 2 av 4» og prikker.
// aria-disabled, ikke disabled, på første og siste: fokus blir stående på knappen deltakeren brukte.
export function enhanceSteps(block) {
  if (block.dataset.ready === "true") return;
  const list = block.querySelector(":scope > .content-steps-list");
  const items = list ? [...list.children].filter((item) => item.matches(".content-step")) : [];
  if (items.length < 2) return;
  block.dataset.ready = "true";
  // Fokuserbar med klikk (ikke i tabulatorrekkefølgen), så piltastene virker etter et klikk i teksten.
  block.tabIndex = -1;

  const nav = document.createElement("div");
  nav.className = "content-steps-nav";
  const prev = makeButton("content-steps-prev", "data-steps-prev", "");
  const next = makeButton("content-steps-next content-block-btn--primary", "data-steps-next", "");
  const arrow = (text) => {
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.textContent = text;
    return span;
  };
  prev.append(arrow("← "), block.dataset.prev ?? "");
  next.append(block.dataset.next ?? "", arrow(" →"));
  const status = document.createElement("div");
  status.className = "content-steps-status";
  // Kunngjøres ved hvert bytte: «Steg 2 av 4», og for skjermlesere stegets tittel.
  const count = document.createElement("p");
  count.className = "content-steps-count";
  count.setAttribute("aria-live", "polite");
  count.setAttribute("aria-atomic", "true");
  const dots = document.createElement("div");
  dots.className = "content-steps-dots";
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < items.length; i += 1) dots.appendChild(document.createElement("span"));
  status.append(count, dots);
  nav.append(prev, status, next);

  blockState.set(block, { items, prev, next, count, dots: [...dots.children], at: 0 });
  // Teksten settes FØR lista settes inn, så startteksten ikke leses opp som et bytte.
  showStep(block, 0);
  block.appendChild(nav);
}

export function showStep(block, index) {
  const state = blockState.get(block);
  if (!state) return;
  const total = state.items.length;
  const at = Math.min(Math.max(index, 0), total - 1);
  state.at = at;
  // Står fokus på en lenke eller knapp i steget som skjules, mister nettleseren fokus til <body>, og
  // neste piltast treffer ikke gjennomgangen (QA-porten, 2.96.0). Fokus flyttes da til blokken selv.
  const active = block.ownerDocument.activeElement;
  const hidesFocus = Boolean(active) && state.items.some((item, i) => i !== at && item.contains(active));
  state.items.forEach((item, i) => item.classList.toggle("is-current", i === at));
  if (hidesFocus) block.focus();
  state.dots.forEach((dot, i) => dot.classList.toggle("is-on", i === at));
  state.prev.setAttribute("aria-disabled", at === 0 ? "true" : "false");
  state.next.setAttribute("aria-disabled", at === total - 1 ? "true" : "false");
  state.count.textContent = fillLabel(block.dataset.count, { n: at + 1, total });
  const title = state.items[at].querySelector(".content-step-title")?.textContent?.trim();
  if (title) {
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = `: ${title}`;
    state.count.appendChild(sr);
  }
}

/** Ett steg fram (1) eller tilbake (-1). Ingenting skjer forbi første og siste. */
export function moveStep(block, delta) {
  const state = blockState.get(block);
  if (!state) return;
  const target = state.at + delta;
  if (target < 0 || target >= state.items.length) return;
  showStep(block, target);
}

// #1076: tekstfeltet virker uten skript. Skriptet tar bare vare på teksten i denne fanen, så den ikke
// forsvinner om siden lastes på nytt. sessionStorage, ikke localStorage (QA-porten, 2.96.0): teksten
// forsvinner når fanen lukkes, så neste bruker av en delt PC ikke finner den. Nøkkelen (data-write-key)
// lager tjeneren av oppgaven og eksempelsvaret — den skiller øvelsene fra hverandre, også på tvers av
// seksjoner og språk. Alt mot lagringen står i try/catch: privat vindu, blokkert lagring eller full
// kvote skal bare bety at teksten ikke huskes.
const WRITE_PREFIX = "a2.skriv.";

function writeStorageKey(block) {
  const key = block?.dataset.writeKey ?? "";
  return /^[a-z0-9-]{1,64}$/i.test(key) ? `${WRITE_PREFIX}${key}` : null;
}

export function enhanceWrite(block) {
  if (block.dataset.ready === "true") return;
  block.dataset.ready = "true";
  const field = block.querySelector("[data-write-field]");
  const key = writeStorageKey(block);
  // Har deltakeren alt skrevet noe her, skal ikke en lagret tekst skrive over det.
  if (!field || !key || field.value) return;
  try {
    const saved = window.sessionStorage.getItem(key);
    if (saved) field.value = saved;
  } catch {
    // Ingen lagring: feltet står tomt.
  }
}

export function saveWrite(field) {
  const key = writeStorageKey(field.closest(WRITE));
  if (!key) return;
  try {
    if (field.value) window.sessionStorage.setItem(key, field.value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Ingen lagring: teksten huskes ikke etter en omlasting, men står i feltet.
  }
}

// #1078: definisjonslista blir en øving med ett kort av gangen. Lista står igjen for skjermlesere
// (shared.css skjuler den bare for øyet). «Øv mer»-kortene tas igjen etter runden, til deltakeren
// kunne alle eller begynner på nytt. Ingenting lagres.
export function enhanceFlash(block) {
  if (block.dataset.ready === "true") return;
  const list = block.querySelector(":scope > .content-flash-list");
  const cards = [];
  for (const term of list ? list.children : []) {
    const definition = term.nextElementSibling;
    if (term.tagName !== "DT" || definition?.tagName !== "DD") continue;
    cards.push({ front: term, back: definition });
  }
  if (cards.length < 2) return;
  block.dataset.ready = "true";

  const practice = document.createElement("div");
  practice.className = "content-flash-practice";
  practice.setAttribute("role", "group");
  practice.setAttribute("aria-label", block.dataset.practice ?? "");
  const stage = document.createElement("div");
  stage.className = "content-flash-stage";
  // Kunngjør resultatet når runden er ferdig; står fast, så skjermleseren hører endringen.
  const status = document.createElement("p");
  status.className = "sr-only";
  status.setAttribute("aria-live", "polite");
  practice.append(stage, status);

  const all = cards.map((_, i) => i);
  blockState.set(block, { cards, stage, status, queue: all, pos: 0, flipped: false, again: new Set(), needsPractice: new Set() });
  renderFlash(block, null);
  block.appendChild(practice);
}

function flashFace(block, card, flipped) {
  const face = document.createElement("span");
  face.className = `content-flash-face ${flipped ? "is-back" : "is-front"}`;
  for (const node of (flipped ? card.back : card.front).childNodes) face.appendChild(node.cloneNode(true));
  const side = document.createElement("span");
  side.className = "content-flash-side";
  side.textContent = (flipped ? block.dataset.back : block.dataset.front) ?? "";
  const wrap = document.createElement("span");
  wrap.className = "content-flash-faces";
  wrap.append(side, face);
  return wrap;
}

/** Tegner kortet (eller sluttskjermen) på nytt. `focus` sier hva som skal ha fokus etterpå. */
function renderFlash(block, focus) {
  const state = blockState.get(block);
  const d = block.dataset;
  state.stage.replaceChildren();
  state.status.textContent = "";

  if (state.pos >= state.queue.length) {
    const total = state.cards.length;
    const known = total - state.needsPractice.size;
    const done = document.createElement("div");
    done.className = "content-flash-done";
    const title = document.createElement("p");
    title.className = "content-flash-done-title";
    title.textContent = d.done ?? "";
    const score = document.createElement("p");
    score.className = "content-flash-score";
    score.textContent = fillLabel(d.score, { known, total });
    const row = document.createElement("div");
    row.className = "content-flash-row";
    const again = [...state.again];
    if (again.length > 0) {
      const label = again.length === 1 ? d.againOne : fillLabel(d.againMany, { n: again.length });
      row.appendChild(makeButton("content-flash-repeat content-block-btn--primary", "data-flash-repeat", label ?? ""));
    }
    row.appendChild(makeButton("content-flash-restart", "data-flash-restart", d.restart ?? ""));
    done.append(title, score, row);
    state.stage.appendChild(done);
    state.status.textContent = `${title.textContent} ${score.textContent}`;
    if (focus) row.querySelector("button")?.focus();
    return;
  }

  const card = state.cards[state.queue[state.pos]];
  const front = card.front.textContent.trim();
  const button = makeButton("content-flash-card", "data-flash-card", "");
  // Navnet på knappen er det skjermleseren sier: forsiden og «snu», eller forsiden og baksiden.
  button.setAttribute("aria-label", state.flipped ? `${front}: ${card.back.textContent.trim()}` : `${front}. ${d.flip ?? ""}`);
  button.appendChild(flashFace(block, card, state.flipped));
  const row = document.createElement("div");
  row.className = "content-flash-row";
  const count = document.createElement("span");
  count.className = "content-flash-count";
  const position = fillLabel(d.count, { n: state.pos + 1, total: state.queue.length });
  if (state.flipped) {
    count.textContent = position;
    row.append(
      makeButton("content-flash-again", "data-flash-again", d.again ?? ""),
      count,
      makeButton("content-flash-known", "data-flash-known", d.known ?? ""),
    );
  } else {
    count.textContent = `${position} · ${d.hint ?? ""}`;
    row.appendChild(count);
  }
  state.stage.append(button, row);
  if (focus === "card") button.focus();
}

/** Snu kortet, eller marker det: «known» (kunne det) eller «again» (øv mer). */
export function flashAction(block, action) {
  const state = blockState.get(block);
  if (!state) return;
  if (action === "flip") {
    state.flipped = !state.flipped;
    renderFlash(block, "card");
    return;
  }
  if (action === "known" || action === "again") {
    const index = state.queue[state.pos];
    if (action === "again") {
      state.again.add(index);
      state.needsPractice.add(index);
    } else state.needsPractice.delete(index);
    state.pos += 1;
    state.flipped = false;
    renderFlash(block, "card");
    return;
  }
  if (action === "repeat" || action === "restart") {
    // «Øv på de N igjen»: bare kortene deltakeren ville øve mer på, i samme rekkefølge som før.
    // «Begynn på nytt» trenger ingen nullstilling av poengsummen: runden går gjennom alle kortene, og
    // hvert svar overskriver det forrige for det kortet.
    state.queue = action === "repeat" ? [...state.again].sort((a, b) => a - b) : state.cards.map((_, i) => i);
    state.again = new Set();
    state.pos = 0;
    state.flipped = false;
    renderFlash(block, "card");
  }
}

// #1107: lista med par blir et spill: begrepene i én kolonne, forklaringene stokket i den andre. Velg ett
// fra hver side; et riktig par blir grønt og står, et feil par blinker rødt. Lista står igjen for
// skjermlesere (shared.css skjuler den bare for øyet), som for repetisjonskortene. Ingenting lagres.
const MISS_MS = 700;

/** Stokker rekkefølgen — aldri slik at ALLE forklaringene står i sin egen rekkefølge (enkelte kan havne rett
 *  overfor sitt eget begrep; med tre par skjer det ofte, og det er greit). */
function shuffledOrder(count, random = Math.random) {
  const order = [...Array(count).keys()];
  if (count < 2) return order;
  do {
    for (let i = count - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  } while (order.every((value, i) => value === i));
  return order;
}

export function enhancePairs(block, random = Math.random) {
  if (block.dataset.ready === "true") return;
  const list = block.querySelector(":scope > .content-pairs-list");
  const pairs = [];
  for (const item of list ? list.children : []) {
    const term = item.querySelector(".content-pairs-term");
    const def = item.querySelector(".content-pairs-def");
    if (term && def) pairs.push({ term, def });
  }
  if (pairs.length < 2) return;
  block.dataset.ready = "true";

  const game = document.createElement("div");
  game.className = "content-pairs-game";
  const column = (label) => {
    const col = document.createElement("div");
    col.className = "content-pairs-col";
    col.setAttribute("role", "group");
    col.setAttribute("aria-label", label ?? "");
    return col;
  };
  const left = column(block.dataset.terms);
  const right = column(block.dataset.defs);
  const item = (source, key, side) => {
    const button = makeButton(`content-pairs-item content-pairs-item--${side === "L" ? "term" : "def"}`, "data-pair-item", "");
    for (const node of source.childNodes) button.appendChild(node.cloneNode(true));
    // En lenke inni en knapp ville både valgt og navigert bort fra siden (QA-porten, 2.98.0): teksten står,
    // lenken ikke. Lista for skjermlesere beholder lenken.
    for (const link of button.querySelectorAll("a")) {
      const span = document.createElement("span");
      span.append(...link.childNodes);
      link.replaceWith(span);
    }
    button.dataset.pairKey = String(key);
    button.dataset.pairSide = side;
    button.setAttribute("aria-pressed", "false");
    return button;
  };
  pairs.forEach((pair, i) => left.appendChild(item(pair.term, i, "L")));
  for (const i of shuffledOrder(pairs.length, random)) right.appendChild(item(pairs[i].def, i, "R"));
  const status = document.createElement("p");
  status.className = "content-pairs-status";
  status.setAttribute("aria-live", "polite");
  game.append(left, right);

  blockState.set(block, { status, total: pairs.length, done: 0, selected: null });
  pairsStatus(block);
  block.append(game, status);
}

function pairsStatus(block, text) {
  const state = blockState.get(block);
  const finished = state.done === state.total;
  state.status.classList.toggle("is-done", finished);
  state.status.textContent = text ?? fillLabel(finished ? block.dataset.done : block.dataset.status, { n: state.done, total: state.total });
}

/** Et trykk på et begrep eller en forklaring. To fra hver sin side avgjør om det er et par. */
export function pickPair(button) {
  const block = button.closest(PAIRS);
  const state = block && blockState.get(block);
  if (!state || button.getAttribute("aria-disabled") === "true") return;
  const selected = state.selected;
  const select = (target, on) => {
    target.classList.toggle("is-selected", on);
    target.setAttribute("aria-pressed", on ? "true" : "false");
  };
  // Første valg, eller et nytt valg på samme side: det nye er valgt.
  if (!selected || selected === button || selected.dataset.pairSide === button.dataset.pairSide) {
    if (selected) select(selected, false);
    if (selected === button) {
      state.selected = null;
      return;
    }
    state.selected = button;
    select(button, true);
    return;
  }
  state.selected = null;
  select(selected, false);
  if (selected.dataset.pairKey === button.dataset.pairKey) {
    for (const target of [selected, button]) {
      target.classList.add("is-done");
      target.setAttribute("aria-disabled", "true");
      const sr = document.createElement("span");
      sr.className = "sr-only";
      sr.textContent = ` (${block.dataset.matched ?? ""})`;
      target.appendChild(sr);
    }
    state.done += 1;
    pairsStatus(block);
    return;
  }
  for (const target of [selected, button]) {
    target.classList.add("is-miss");
    setTimeout(() => target.classList.remove("is-miss"), MISS_MS);
  }
  pairsStatus(block, block.dataset.miss ?? "");
}

const ENHANCERS = [
  [STEPS, enhanceSteps],
  [WRITE, enhanceWrite],
  [FLASH, enhanceFlash],
  [PAIRS, (block) => enhancePairs(block)],
];

/** Gjør blokkene i `root` klare (og `root` selv, er den en blokk). Kan kalles flere ganger. */
export function enhanceContentBlocks(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  for (const [selector, enhance] of ENHANCERS) {
    if (typeof root.matches === "function" && root.matches(selector)) enhance(root);
    for (const block of root.querySelectorAll(selector)) enhance(block);
  }
}

const FLASH_ACTIONS = [
  ["[data-flash-card]", "flip"],
  ["[data-flash-known]", "known"],
  ["[data-flash-again]", "again"],
  ["[data-flash-repeat]", "repeat"],
  ["[data-flash-restart]", "restart"],
];

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const stepButton = target.closest("[data-steps-prev], [data-steps-next]");
    if (stepButton) {
      const block = stepButton.closest(STEPS);
      if (block) moveStep(block, stepButton.matches("[data-steps-next]") ? 1 : -1);
      return;
    }
    for (const [selector, action] of FLASH_ACTIONS) {
      const button = target.closest(selector);
      const block = button?.closest(FLASH);
      if (block) {
        flashAction(block, action);
        return;
      }
    }
    const pairButton = target.closest("[data-pair-item]");
    if (pairButton) pickPair(pairButton);
  });

  // Piltastene blar når fokus er i en gjennomgang — men ikke mens deltakeren skriver i et felt.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("input, textarea, select, [contenteditable]")) return;
    const block = target.closest(`${STEPS}[data-ready="true"]`);
    if (!block) return;
    event.preventDefault();
    moveStep(block, event.key === "ArrowRight" ? 1 : -1);
  });

  document.addEventListener("input", (event) => {
    const field = event.target instanceof Element ? event.target.closest("[data-write-field]") : null;
    if (field) saveWrite(field);
  });

  // Seksjonstekst settes inn etter sidelast (leseren, forhåndsvisningen, oppgaveteksten i en modul).
  // Modulskript kjører etter at dokumentet er lest, så det som alt står der, tas med en gang.
  enhanceContentBlocks(document);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === 1) enhanceContentBlocks(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
