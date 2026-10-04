import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  sanitizeSvg,
  svgHasText,
  extractSvgTexts,
  applySvgTextTranslations,
} from "../../src/modules/course/svgSanitizer.js";

// #657: SVG is accepted for section drawings only because it is sanitised server-side. These
// tests pin the XSS-stripping behaviour and the text extract/translate round-trip.

const benignSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">
  <rect x="0" y="0" width="120" height="60" fill="#eef"/>
  <text x="10" y="30">Start</text>
  <text x="10" y="50"><tspan>Neste steg</tspan></text>
</svg>`;

describe("sanitizeSvg — XSS vectors", () => {
  it("strips <script> elements", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).toMatch(/<rect/i);
  });

  it("strips inline event handlers", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" onclick="steal()"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toMatch(/onclick/i);
  });

  it("removes <foreignObject> (HTML/script embedding vector)", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body><img src=x onerror=alert(1)></body></foreignObject></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/foreignObject/i);
    expect(clean).not.toMatch(/onerror/i);
  });

  it("drops javascript: hrefs and <a> links", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text x="1" y="1">x</text></a></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/<a[\s>]/i);
  });

  it("returns empty string when there is no usable <svg>", () => {
    expect(sanitizeSvg("<html><body>not an svg</body></html>")).toBe("");
    expect(sanitizeSvg("")).toBe("");
  });

  it("keeps a valid drawing with its xmlns so it renders via <img>", () => {
    const clean = sanitizeSvg(benignSvg);
    expect(clean).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i);
    expect(clean).toMatch(/<rect/i);
    expect(clean).toMatch(/Start/);
  });
});

// #1083: fila leveres som image/svg+xml, så nettleseren leser den som XML. Rensingen skrev den ut
// som HTML, og de to er uenige om hardt mellomrom (`&nbsp;` finnes ikke i XML) og om `<` i en
// attributtverdi. Resultatet var en figur nettleseren ikke kunne lese — altså ingen figur, og ingen
// feilmelding noe sted. Påstanden under er derfor ikke «inneholder ikke &nbsp;», men «lar seg lese
// som en SVG»: det er den som er sann eller usann for deltakeren.
function lesesSomSvg(svg: string): boolean {
  try {
    const rot = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document.documentElement;
    return rot.localName === "svg" && rot.namespaceURI === "http://www.w3.org/2000/svg";
  } catch {
    return false;
  }
}

describe("sanitizeSvg — det som lagres kan leses som et bilde (#1083)", () => {
  const figur = (innhold: string, rotAttributter = "") =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"${rotAttributter}>${innhold}</svg>`;

  it("kontroll: testens egen måler skiller en lesbar SVG fra en som ikke er det", () => {
    expect(lesesSomSvg(figur(`<text x="1" y="1">§ 12</text>`))).toBe(true);
    // Nøyaktig det rensingen skrev ut før rettingen.
    expect(lesesSomSvg(figur(`<text x="1" y="1">§&nbsp;12</text>`))).toBe(false);
    expect(lesesSomSvg(figur(`<rect/>`, ` aria-label="a < b"`))).toBe(false);
  });

  it.each([
    ["hardt mellomrom i en etikett («§ 12», «10 %»)", figur(`<text x="10" y="30">§ 12 og 10 %</text>`), "§ 12 og 10 %"],
    ["&nbsp; skrevet som entitet i kilden", figur(`<text x="10" y="30">kr&nbsp;500</text>`), "kr 500"],
    ["hardt mellomrom i en attributtverdi", figur(`<rect width="5" height="5"/>`, ` aria-label="§ 12"`), "§ 12"],
    ["< i en attributtverdi", figur(`<rect width="5" height="5"/>`, ` aria-label="a &lt; b"`), "a &lt; b"],
    ["& i en etikett", figur(`<text x="10" y="30">Mål &amp; middel</text>`), "Mål &amp; middel"],
  ])("%s: figuren lar seg lese, og teksten er med", (_navn, inn, forventetTekst) => {
    const ren = sanitizeSvg(inn);
    expect(lesesSomSvg(ren)).toBe(true);
    expect(ren).toContain(forventetTekst);
    expect(ren).not.toContain("&nbsp;");
  });

  it("en oversatt variant med hardt mellomrom lar seg også lese — oversettelsen kommer fra en språkmodell", () => {
    const norsk = sanitizeSvg(figur(`<text x="10" y="30">Paragraf 12</text>`));
    const engelsk = applySvgTextTranslations(norsk, { "Paragraf 12": "Section 12" });
    expect(lesesSomSvg(engelsk)).toBe(true);
    expect(extractSvgTexts(engelsk)).toEqual(["Section 12"]);
  });

  it("rensing er stabil: det som alt er renset, endres ikke av å renses igjen (eksport → import)", () => {
    for (const inn of [benignSvg, figur(`<style>.a &gt; .b { fill: #eef; }</style><text x="1" y="9">§ 12</text>`)]) {
      const én = sanitizeSvg(inn);
      expect(sanitizeSvg(én)).toBe(én);
    }
  });

  it("bare selve figuren lagres: det som står foran og bak rota, er ikke med", () => {
    const ren = sanitizeSvg(`<?xml version="1.0"?><!DOCTYPE svg>${figur(`<rect width="5" height="5"/>`)}etterpå`);
    expect(ren.startsWith("<svg ")).toBe(true);
    expect(ren.endsWith("</svg>")).toBe(true);
    expect(lesesSomSvg(ren)).toBe(true);
  });

  it("en figur som ikke kan skrives som lesbar XML, avvises — forfatteren får feilen, ikke deltakeren", () => {
    // Et styretegn er lovlig i HTML og forbudt i XML. Rensingen kan ikke redde det; den kan nekte.
    expect(sanitizeSvg(figur(`<text x="10" y="30">a\u0008b</text>`))).toBe("");
  });

  it("stilblokka overlever: en animert figur er fortsatt animert etter rensing", () => {
    const ren = sanitizeSvg(figur(`<style>@keyframes lys { to { fill: #fff; } } .a { animation: lys 1s 1; }</style><rect class="a" width="5" height="5"/>`));
    expect(lesesSomSvg(ren)).toBe(true);
    expect(ren).toContain("@keyframes lys");
    expect(ren).toContain("animation: lys 1s 1");
  });
});

describe("SVG text extraction + translation round-trip", () => {
  it("detects text presence", () => {
    expect(svgHasText(benignSvg)).toBe(true);
    expect(svgHasText(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`)).toBe(false);
  });

  it("extracts text runs in order without duplicates", () => {
    expect(extractSvgTexts(benignSvg)).toEqual(["Start", "Neste steg"]);
  });

  it("applies translations in place and preserves geometry", () => {
    const out = applySvgTextTranslations(benignSvg, { Start: "Begin", "Neste steg": "Next step" });
    expect(out).toMatch(/Begin/);
    expect(out).toMatch(/Next step/);
    expect(out).not.toMatch(/Start/);
    expect(out).not.toMatch(/Neste steg/);
    // Geometry untouched.
    expect(out).toMatch(/x="10" y="30"/);
    expect(out).toMatch(/<rect/i);
  });

  it("re-sanitises on apply so a translation round-trip cannot reintroduce script", () => {
    const out = applySvgTextTranslations(benignSvg, { Start: "Begin" });
    expect(out).not.toMatch(/<script/i);
  });
});
