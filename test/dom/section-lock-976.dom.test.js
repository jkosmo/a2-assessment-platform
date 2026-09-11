import { describe, expect, it } from "vitest";
import { setSectionLocked } from "../../public/static/section-lock.js";

// ─────────────────────────────────────────────────────────────────────────────
// #976: en lås som bare låste tastaturet.
//
// `setSectionLocked` satte `tabindex="-1"` og en klasse — ikke `disabled`. Alt inne i seksjonen som
// ikke var en av de fire navngitte knappene var fullt klikkbart med mus: MCQ-radioer, ankefeltet,
// lenker. Seksjonen SÅ låst ut og oppførte seg ikke slik.
//
// ⚠️ TO TING MÅ MÅLES, IKKE ÉN. At låsen låser, og at OPPLÅSING ikke skrur på noe som var av av en
// annen grunn. Det siste er der en naiv fiks går galt: `disabled = false` på alt ved opplåsing ville
// aktivert en knapp en annen mekanisme hadde deaktivert.
// ─────────────────────────────────────────────────────────────────────────────

function seksjon(html) {
  const el = document.createElement("section");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("#976 — setSectionLocked låser for mus, ikke bare for tastatur", () => {
  it("⚠️ skjemakontroller blir disabled, ikke bare tabindex=-1", () => {
    const s = seksjon(`
      <input type="radio" name="q" id="r1">
      <textarea id="t1"></textarea>
      <select id="s1"><option>a</option></select>
      <button id="b1">Send</button>
    `);
    setSectionLocked(s, true);

    for (const id of ["r1", "t1", "s1", "b1"]) {
      const el = s.querySelector(`#${id}`);
      expect(el.disabled, `${id} skal være disabled`).toBe(true);
      expect(el.getAttribute("tabindex"), `${id} skal også være ute av tab-rekkefølgen`).toBe("-1");
    }
    expect(s.classList.contains("section-locked")).toBe(true);
    expect(s.getAttribute("aria-disabled"), "skjermlesere skal høre at seksjonen er låst").toBe("true");
  });

  it("⚠️ lenker får aria-disabled — de kan ikke deaktiveres, CSS-en tar klikkene", () => {
    const s = seksjon(`<a href="/x" id="a1">Les mer</a>`);
    setSectionLocked(s, true);
    const a = s.querySelector("#a1");
    expect(a.getAttribute("aria-disabled")).toBe("true");
    expect(a.getAttribute("tabindex")).toBe("-1");
    setSectionLocked(s, false);
    expect(a.hasAttribute("aria-disabled")).toBe(false);
  });

  it("⚠️ opplåsing gjenoppretter — og skrur IKKE på det som var av fra før", () => {
    // Testens viktigste påstand. Uten den kunne fiksen vært `el.disabled = locked` rett fram, og
    // en knapp en annen mekanisme hadde deaktivert ville våknet ved første opplåsing.
    const s = seksjon(`
      <input id="var-paa">
      <button id="var-av" disabled>Var av</button>
      <input id="hadde-tabindex" tabindex="3">
    `);
    setSectionLocked(s, true);
    expect(s.querySelector("#var-av").disabled).toBe(true);
    expect(s.querySelector("#var-paa").disabled).toBe(true);

    setSectionLocked(s, false);
    expect(s.querySelector("#var-paa").disabled, "den som var på, skal på igjen").toBe(false);
    expect(s.querySelector("#var-av").disabled, "den som var av, skal FORTSATT være av").toBe(true);
    expect(s.querySelector("#hadde-tabindex").getAttribute("tabindex"), "egen tabindex gjenopprettes").toBe("3");
    expect(s.querySelector("#var-paa").hasAttribute("tabindex"), "ingen tabindex der det ikke var noen").toBe(false);
    expect(s.getAttribute("aria-disabled")).toBe("false");
    // Sporene skal være ryddet, ellers vil neste låsing lese gammel tilstand.
    expect(s.querySelector("#var-av").dataset.preLockDisabled).toBeUndefined();
    expect(s.querySelector("#var-av").dataset.preLockTabindex).toBeUndefined();
  });

  it("⚠️ CSS-en tar klikkene for det disabled ikke dekker — kontroll på at regelen finnes", () => {
    // `pointer-events: none` på `.section-locked` er halve fiksen (lenker og alt annet klikkbart).
    // jsdom regner ikke ut stiler, så dette leser kilden — en regresjon her ville ellers vært
    // usynlig for alle testene over.
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const html = readFileSync(resolve("public/participant.html"), "utf8");
    const regel = html.split("\n").find((l) => l.includes(".section-locked {"));
    expect(regel, "fant ikke CSS-regelen — kontrollcase").toBeTruthy();
    expect(regel, "uten pointer-events: none er lenker fortsatt klikkbare i en låst seksjon").toContain("pointer-events: none");
  });
});
