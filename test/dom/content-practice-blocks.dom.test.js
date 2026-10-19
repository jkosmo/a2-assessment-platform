import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSectionBlocks } from "../../src/modules/course/contentBlocks.ts";
import {
  enhanceContentBlocks,
  enhanceFlash,
  enhanceSteps,
  enhanceWrite,
  flashAction,
  moveStep,
  saveWrite,
  showStep,
} from "../../public/static/content-blocks.js";

// ⚠️ Ligger i test/dom/ fordi skriptet rører `document`. Enhetskonfigen kjører i node.
//
// #1075, #1076, #1078: det content-blocks.js gjør med blokkene tjeneren tegner. HTML-en er tjenerens
// egen tegning (renderSectionBlocks), så testene måler skriptet mot det deltakeren faktisk får — ikke mot
// en hjemmelaget kopi som kan gli fra. Det som må prøves i en ekte nettleser (synlighet, fokus,
// tastatur, omlasting), står i test/e2e/participant-practice-blocks-1075-1076-1078.spec.ts.

const NL = String.fromCharCode(10);
const STEPS = [":::steg Tittel", "### Først", "en", "### Så", "to", "### Til slutt", "tre", ":::"].join(NL);
const WRITE = [":::skriv Oppgaven", "Eksempelsvaret.", "", "- [ ] et punkt", ":::"].join(NL);
const FLASH = [":::repetisjon", "### Vedtak", "Det møtet bestemte.", "### Referent", "Den som skriver.", "### Habil", "Uten interesse i saken.", ":::"].join(NL);

function mount(markdown) {
  const host = document.createElement("div");
  host.innerHTML = renderSectionBlocks(markdown, "nb");
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
  try { window.localStorage.clear(); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

describe("#1075 steg for steg", () => {
  it("lista blir ett steg av gangen: Forrige låst på første, Neste på siste, «Steg n av N» og prikker", () => {
    const block = mount(STEPS).querySelector("[data-content-steps]");
    enhanceSteps(block);
    expect(block.dataset.ready).toBe("true");
    const items = block.querySelectorAll(".content-step");
    const prev = block.querySelector("[data-steps-prev]");
    const next = block.querySelector("[data-steps-next]");
    const count = block.querySelector(".content-steps-count");
    expect([...items].map((item) => item.classList.contains("is-current"))).toEqual([true, false, false]);
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(next.getAttribute("aria-disabled")).toBe("false");
    expect(count.textContent).toBe("Steg 1 av 3: Først");
    expect(count.getAttribute("aria-live")).toBe("polite");
    expect(block.querySelectorAll(".content-steps-dots span")).toHaveLength(3);
    expect(prev.textContent).toBe("← Forrige");
    expect(next.textContent).toBe("Neste →");

    moveStep(block, 1);
    moveStep(block, 1);
    expect([...items].map((item) => item.classList.contains("is-current"))).toEqual([false, false, true]);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(prev.getAttribute("aria-disabled")).toBe("false");
    expect(count.textContent).toBe("Steg 3 av 3: Til slutt");
    expect(block.querySelector(".content-steps-dots span.is-on")).toBe(block.querySelectorAll(".content-steps-dots span")[2]);
    // Forbi siste skjer ingenting — heller ikke en ny tekst i aria-live-feltet, som ville blitt lest opp
    // som et bytte.
    const before = count.firstChild;
    moveStep(block, 1);
    expect(count.textContent).toBe("Steg 3 av 3: Til slutt");
    expect(count.firstChild).toBe(before);
    showStep(block, -5);
    expect(count.textContent).toBe("Steg 1 av 3: Først");
  });

  it("gjøres klar bare én gang, uansett hvor mange ganger den blir sett", () => {
    const host = mount(STEPS);
    enhanceContentBlocks(host);
    enhanceContentBlocks(host);
    expect(host.querySelectorAll(".content-steps-nav")).toHaveLength(1);
  });

  it("klikk på Neste og piltastene blar; i et tekstfelt gjør piltastene ingenting", () => {
    const block = mount(STEPS).querySelector("[data-content-steps]");
    enhanceSteps(block);
    const count = block.querySelector(".content-steps-count");
    block.querySelector("[data-steps-next]").click();
    expect(count.textContent).toMatch(/^Steg 2 av 3/);
    block.querySelector("[data-steps-next]").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(count.textContent).toMatch(/^Steg 1 av 3/);
    block.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(count.textContent).toMatch(/^Steg 2 av 3/);
    // Med Ctrl eller Alt er det nettleserens snarvei, ikke en bla.
    block.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    expect(count.textContent).toMatch(/^Steg 2 av 3/);
    const input = document.createElement("input");
    block.querySelector(".content-step.is-current .content-step-body").appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(count.textContent).toMatch(/^Steg 2 av 3/);
  });

  it("tekst som settes inn etter at skriptet er lastet, gjøres klar av seg selv", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = renderSectionBlocks(STEPS, "nb");
    await Promise.resolve();
    expect(host.querySelector("[data-content-steps]").dataset.ready).toBe("true");
    expect(host.querySelector(".content-steps-nav")).not.toBeNull();
  });
});

describe("#1076 skriv selv", () => {
  it("teksten lagres i nettleseren under blokkens nøkkel, og hentes igjen", () => {
    const block = mount(WRITE).querySelector("[data-content-write]");
    const key = `a2.skriv.${block.dataset.writeKey}`;
    const field = block.querySelector("[data-write-field]");
    field.value = "Mitt svar";
    saveWrite(field);
    expect(window.localStorage.getItem(key)).toBe("Mitt svar");

    document.body.replaceChildren();
    const again = mount(WRITE).querySelector("[data-content-write]");
    enhanceWrite(again);
    expect(again.querySelector("[data-write-field]").value).toBe("Mitt svar");
  });

  it("skriving i feltet lagres via lytteren på dokumentet; et tomt felt glemmes", () => {
    const block = mount(WRITE).querySelector("[data-content-write]");
    const key = `a2.skriv.${block.dataset.writeKey}`;
    const field = block.querySelector("[data-write-field]");
    field.value = "Utkast";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(window.localStorage.getItem(key)).toBe("Utkast");
    field.value = "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("en lagret tekst skriver ikke over det deltakeren alt har skrevet", () => {
    const block = mount(WRITE).querySelector("[data-content-write]");
    window.localStorage.setItem(`a2.skriv.${block.dataset.writeKey}`, "Gammel");
    delete block.dataset.ready;
    block.querySelector("[data-write-field]").value = "Ny";
    enhanceWrite(block);
    expect(block.querySelector("[data-write-field]").value).toBe("Ny");
  });

  it("blokkert lagring gir ingen feil — teksten huskes bare ikke", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    const block = mount(WRITE).querySelector("[data-content-write]");
    delete block.dataset.ready;
    expect(() => enhanceWrite(block)).not.toThrow();
    const field = block.querySelector("[data-write-field]");
    field.value = "Tekst";
    expect(() => saveWrite(field)).not.toThrow();
  });

  it("en nøkkel som ikke ser ut som tjenerens, brukes ikke", () => {
    const block = mount(WRITE).querySelector("[data-content-write]");
    block.dataset.writeKey = "../../annet";
    const field = block.querySelector("[data-write-field]");
    field.value = "Tekst";
    saveWrite(field);
    expect(window.localStorage.length).toBe(0);
  });
});

describe("#1078 repetisjonskort", () => {
  let block;
  beforeEach(() => {
    block = mount(FLASH).querySelector("[data-content-flash]");
    enhanceFlash(block);
  });

  const card = () => block.querySelector("[data-flash-card]");
  const count = () => block.querySelector(".content-flash-count")?.textContent;

  it("viser ett kort med forsiden, og lista står igjen", () => {
    expect(block.dataset.ready).toBe("true");
    expect(card().textContent).toBe("BegrepVedtak");
    expect(card().getAttribute("aria-label")).toBe("Vedtak. Snu kortet");
    expect(count()).toBe("Kort 1 av 3 · klikk for å snu");
    expect(block.querySelectorAll(".content-flash-list dt")).toHaveLength(3);
    expect(block.querySelector("[data-flash-known]")).toBeNull();
  });

  it("snu: baksiden, og «Øv mer» / «Kunne det»", () => {
    flashAction(block, "flip");
    expect(card().textContent.trim()).toBe("ForklaringDet møtet bestemte.");
    expect(card().getAttribute("aria-label")).toBe("Vedtak: Det møtet bestemte.");
    expect(count()).toBe("Kort 1 av 3");
    expect(block.querySelector("[data-flash-again]").textContent).toBe("Øv mer");
    expect(block.querySelector("[data-flash-known]").textContent).toBe("Kunne det");
  });

  it("«øv mer»-kortene kommer igjen etter runden, og poengsummen teller det deltakeren kunne til slutt", () => {
    flashAction(block, "flip");
    flashAction(block, "again");
    flashAction(block, "flip");
    flashAction(block, "again");
    flashAction(block, "flip");
    flashAction(block, "known");
    expect(block.querySelector(".content-flash-score").textContent).toBe("Du kunne 1 av 3.");
    expect(block.querySelector("[data-flash-repeat]").textContent).toBe("Øv på de 2 igjen");
    expect(block.querySelector('[aria-live="polite"]').textContent).toBe("Ferdig! Du kunne 1 av 3.");

    flashAction(block, "repeat");
    expect(card().textContent).toBe("BegrepVedtak");
    expect(count()).toBe("Kort 1 av 2 · klikk for å snu");
    flashAction(block, "known");
    expect(card().textContent).toBe("BegrepReferent");
    flashAction(block, "again");
    expect(block.querySelector(".content-flash-score").textContent).toBe("Du kunne 2 av 3.");
    expect(block.querySelector("[data-flash-repeat]").textContent).toBe("Øv på det igjen");

    flashAction(block, "restart");
    expect(count()).toBe("Kort 1 av 3 · klikk for å snu");
    flashAction(block, "known");
    flashAction(block, "known");
    flashAction(block, "known");
    expect(block.querySelector(".content-flash-score").textContent).toBe("Du kunne 3 av 3.");
    expect(block.querySelector("[data-flash-repeat]")).toBeNull();
  });

  it("klikk på kortet og knappene går gjennom lytteren på dokumentet", () => {
    card().click();
    expect(count()).toBe("Kort 1 av 3");
    block.querySelector("[data-flash-known]").click();
    expect(card().textContent).toBe("BegrepReferent");
  });
});
