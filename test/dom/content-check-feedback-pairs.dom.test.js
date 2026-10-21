import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSectionBlocks } from "../../src/modules/course/contentBlocks.ts";
import { answerCheck, enhanceContentBlocks, enhancePairs, pickPair } from "../../public/static/content-blocks.js";

// ⚠️ Ligger i test/dom/ fordi skriptet rører `document`.
//
// #1110 (følge per alternativ) og #1107 (finn parene): det content-blocks.js gjør med tjenerens egen
// tegning. Synlighet, fokus og tastatur i en ekte nettleser: test/e2e/participant-case-pairs-1110-1107.spec.ts.

const NL = String.fromCharCode(10);
const CASE = [":::sjekk Hva gjør du?", "- [ ] Avslår alt", "  For mye.", "- [x] Sladder og gir innsyn", "  Riktig.", "- [ ] Sender alt", "", "Innsyn er hovedregelen.", ":::"].join(NL);
const PAIRS = [":::par Koble", "- Hjemmel = Lovbestemmelsen", "- Merinnsyn = Innsyn likevel", "- Klagefrist = Tiden til å klage", "- Journalføring = Registrering", ":::"].join(NL);

function mount(markdown) {
  const host = document.createElement("div");
  host.innerHTML = renderSectionBlocks(markdown, "nb");
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("#1110 følge per alternativ", () => {
  it("feil valg: følgen til det valgte vises, de andre står skjult, og forklaringen kommer etter", () => {
    const host = mount(CASE);
    const options = host.querySelectorAll("[data-check-option]");
    answerCheck(options[0]);
    expect(host.querySelector('[data-check-feedback="0"]').hidden).toBe(false);
    expect(host.querySelector('[data-check-feedback="1"]').hidden).toBe(true);
    expect(host.querySelector(".content-check-explanation").hidden).toBe(false);
  });

  it("riktig valg: følgen til det riktige vises", () => {
    const host = mount(CASE);
    answerCheck(host.querySelectorAll("[data-check-option]")[1]);
    expect(host.querySelector('[data-check-feedback="1"]').hidden).toBe(false);
    expect(host.querySelector('[data-check-feedback="0"]').hidden).toBe(true);
  });

  it("et alternativ uten følge viser ingen følge, og det går ikke an å svare to ganger", () => {
    const host = mount(CASE);
    const options = host.querySelectorAll("[data-check-option]");
    answerCheck(options[2]);
    answerCheck(options[0]);
    expect([...host.querySelectorAll("[data-check-feedback]")].every((p) => p.hidden)).toBe(true);
  });

  it("to bokser på samme side: følgen hentes fra boksen deltakeren svarte i", () => {
    const host = mount(`${CASE}${NL}${NL}${CASE}`);
    const second = host.querySelectorAll(".content-check")[1];
    answerCheck(second.querySelectorAll("[data-check-option]")[0]);
    expect(second.querySelector('[data-check-feedback="0"]').hidden).toBe(false);
    expect(host.querySelectorAll(".content-check")[0].querySelector('[data-check-feedback="0"]').hidden).toBe(true);
  });
});

/** Fast rekkefølge i stedet for Math.random: første kall gir identiteten, som skal avvises. */
function sequence(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function game(host) {
  const block = host.querySelector("[data-content-pairs]");
  const left = [...block.querySelectorAll(".content-pairs-item--term")];
  const right = [...block.querySelectorAll(".content-pairs-item--def")];
  const def = (key) => right.find((b) => b.dataset.pairKey === String(key));
  const status = () => block.querySelector(".content-pairs-status").textContent;
  return { block, left, right, def, status };
}

describe("#1107 finn parene", () => {
  it("lista blir to kolonner: begrepene i rekkefølge, forklaringene stokket — aldri alle i sin egen rekkefølge", () => {
    const host = mount(PAIRS);
    // 0.999… gir ingen bytter i Fisher–Yates (identiteten); funksjonen må stokke på nytt.
    enhancePairs(host.querySelector("[data-content-pairs]"), sequence([0.9999, 0.9999, 0.9999, 0, 0, 0]));
    const { block, left, right, status } = game(host);
    expect(block.dataset.ready).toBe("true");
    expect(left.map((b) => b.textContent)).toEqual(["Hjemmel", "Merinnsyn", "Klagefrist", "Journalføring"]);
    expect(right.map((b) => b.dataset.pairKey)).not.toEqual(["0", "1", "2", "3"]);
    expect(right.map((b) => b.dataset.pairKey).sort()).toEqual(["0", "1", "2", "3"]);
    expect(status()).toBe("0 av 4 par");
    expect(block.querySelectorAll('[role="group"]')).toHaveLength(2);
  });

  it("riktig par: begge blir grønne og låst, med skjult «koblet» for skjermlesere, og tallet går opp", () => {
    const host = mount(PAIRS);
    enhanceContentBlocks(host);
    const { left, def, status } = game(host);
    pickPair(left[1]);
    expect(left[1].getAttribute("aria-pressed")).toBe("true");
    pickPair(def(1));
    for (const b of [left[1], def(1)]) {
      expect(b.classList.contains("is-done")).toBe(true);
      expect(b.getAttribute("aria-disabled")).toBe("true");
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.querySelector(".sr-only").textContent).toBe(" (koblet)");
    }
    expect(status()).toBe("1 av 4 par");
  });

  it("feil par: begge blinker rødt, ingenting låses, og statusen sier fra", () => {
    vi.useFakeTimers();
    const host = mount(PAIRS);
    enhanceContentBlocks(host);
    const { left, def, status } = game(host);
    pickPair(def(2));
    pickPair(left[0]);
    expect(left[0].classList.contains("is-miss")).toBe(true);
    expect(def(2).classList.contains("is-miss")).toBe(true);
    expect(left[0].getAttribute("aria-disabled")).not.toBe("true");
    expect(status()).toBe("Ikke et par. Prøv igjen.");
    vi.advanceTimersByTime(800);
    expect(left[0].classList.contains("is-miss")).toBe(false);
  });

  it("nytt valg på samme side bytter valget; samme knapp igjen opphever det", () => {
    const host = mount(PAIRS);
    enhanceContentBlocks(host);
    const { left, def } = game(host);
    pickPair(left[0]);
    pickPair(left[2]);
    expect(left[0].getAttribute("aria-pressed")).toBe("false");
    expect(left[2].getAttribute("aria-pressed")).toBe("true");
    pickPair(left[2]);
    expect(left[2].getAttribute("aria-pressed")).toBe("false");
    // Ingenting valgt: neste trykk på en forklaring er et nytt første valg, ikke et forsøk.
    pickPair(def(3));
    expect(def(3).getAttribute("aria-pressed")).toBe("true");
    expect(def(3).classList.contains("is-miss")).toBe(false);
  });

  it("et koblet par kan ikke velges igjen", () => {
    const host = mount(PAIRS);
    enhanceContentBlocks(host);
    const { left, def } = game(host);
    pickPair(left[0]);
    pickPair(def(0));
    pickPair(left[0]);
    expect(left[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("alle par: statusen sier at alle er riktige", () => {
    const host = mount(PAIRS);
    enhanceContentBlocks(host);
    const { left, def, status, block } = game(host);
    left.forEach((b, i) => { pickPair(b); pickPair(def(i)); });
    expect(status()).toBe("Alle 4 parene er riktige.");
    expect(block.querySelector(".content-pairs-status").classList.contains("is-done")).toBe(true);
  });

  it("en lenke i et par blir vanlig tekst i knappen, men står i lista for skjermlesere", () => {
    const host = mount([":::par", "- [Hjemmel](https://lovdata.no) = Lovbestemmelsen", "- B = b", "- C = c", ":::"].join(NL));
    enhanceContentBlocks(host);
    const { left, block } = game(host);
    expect(left[0].querySelector("a")).toBeNull();
    expect(left[0].textContent).toBe("Hjemmel");
    expect(block.querySelector(".content-pairs-list a")).not.toBeNull();
  });

  it("gjøres klar én gang, også når den kalles igjen", () => {
    const host = mount(PAIRS);
    enhanceContentBlocks(host);
    enhanceContentBlocks(host);
    expect(host.querySelectorAll(".content-pairs-game")).toHaveLength(1);
  });
});
