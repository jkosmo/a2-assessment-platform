// Innholdsblokker i seksjonstekst (#1079): «Kopier»-knappen i en prompt-boks, «sjekk deg selv»
// (#1074), steg for steg (#1075), skriv selv (#1076) og repetisjonskort (#1078).
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

const ENHANCERS = [
  [STEPS, enhanceSteps],
  [WRITE, enhanceWrite],
  [FLASH, enhanceFlash],
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
