import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  isSvgReadableAsImage,
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

// #1083: lesbarhetskontrollen bygger ikke lenger et dokument — den lar bare XML-leseren gå gjennom
// teksten. Å bygge treet en gang til doblet minnetoppen, og en tett figur på 1 MB tok ned prosessen.
// Kontrollen skal likevel svare NØYAKTIG som nettleserens måte å lese på, her representert ved
// DOMParser, som er det kontrollen brukte før. Testen sammenligner de to; den gjetter ikke på regler.
describe("isSvgReadableAsImage — samme svar som DOMParser, uten å bygge et tre (#1083)", () => {
  const vindu = new JSDOM("").window;
  const lesesAvDomParser = (xml: string): boolean => {
    const rot = new vindu.DOMParser().parseFromString(xml, "image/svg+xml").documentElement;
    return rot?.localName === "svg" && rot.namespaceURI === "http://www.w3.org/2000/svg";
  };

  const NS = `xmlns="http://www.w3.org/2000/svg"`;
  const utvalgte: Array<[string, string]> = [
    ["vanlig figur", benignSvg],
    ["tom streng", ""],
    ["bare tekst", "ikke xml"],
    ["&nbsp; uten definisjon", `<svg ${NS}><text>§&nbsp;12</text></svg>`],
    ["entitet definert i DOCTYPE", `<!DOCTYPE svg [<!ENTITY nbsp " ">]><svg ${NS}><text>§&nbsp;12</text></svg>`],
    ["entitet som viser til en annen", `<!DOCTYPE svg [<!ENTITY a "aaa"><!ENTITY b "&a;&a;">]><svg ${NS}><text>&b;</text></svg>`],
    ["bar < i attributtverdi", `<svg ${NS} aria-label="a < b"/>`],
    ["styretegn i tekst", `<svg ${NS}><text>a\u0008b</text></svg>`],
    ["styretegn som tegnreferanse", `<svg ${NS}><text>a&#8;b</text></svg>`],
    ["ensomt surrogat", `<svg ${NS}><text>a\ud800b</text></svg>`],
    ["U+FFFE", `<svg ${NS}><text>a￾b</text></svg>`],
    ["BOM foran", `﻿<svg ${NS}/>`],
    ["BOM foran XML-deklarasjon", `﻿<?xml version="1.0"?><svg ${NS}/>`],
    ["mellomrom foran XML-deklarasjon", ` <?xml version="1.0"?><svg ${NS}/>`],
    // Lovlig i XML 1.1, forbudt i 1.0. Nettlesere leser alt som 1.0, uansett hva fila sier om seg selv.
    ["XML 1.1 i deklarasjonen, med et tegn bare 1.1 tillater", `<?xml version="1.1"?><svg ${NS}><text>a&#8;b</text></svg>`],
    ["to røtter", `<svg ${NS}/><svg ${NS}/>`],
    ["tekst etter rota", `<svg ${NS}/>etterpå`],
    ["kommentar og PI rundt rota", `<!-- a --><?pi b?><svg ${NS}/><!-- c -->`],
    ["kommentar med --", `<svg ${NS}><!-- a -- b --></svg>`],
    ["CDATA", `<svg ${NS}><style><![CDATA[.a > .b { fill: #eef; }]]></style></svg>`],
    ["]]> i tekst", `<svg ${NS}><text>a ]]> b</text></svg>`],
    ["ulukket element", `<svg ${NS}><rect></svg>`],
    ["ulukket rot", `<svg ${NS}><rect/>`],
    ["rot uten navnerom", `<svg><rect/></svg>`],
    ["rot i XHTML-navnerommet", `<svg xmlns="http://www.w3.org/1999/xhtml"/>`],
    ["rot med prefiks", `<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:rect/></s:svg>`],
    ["prefiks uten deklarasjon", `<s:svg><s:rect/></s:svg>`],
    ["attributt med ukjent prefiks", `<svg ${NS} xlink:href="#a"/>`],
    ["attributt med kjent prefiks", `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#a"/>`],
    ["samme attributt to ganger", `<svg ${NS} id="a" id="b"/>`],
    ["attributtnavn XML ikke godtar", `<svg ${NS} data-×="1"/>`],
    ["attributt uten anførselstegn", `<svg ${NS} width=10/>`],
    ["rot som ikke er svg", `<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>`],
    ["parsererror som rot", `<parsererror ${NS}/>`],
    ["svg inni en annen rot", `<g ${NS}><svg/></g>`],
    ["navn med stor forbokstav", `<SVG ${NS}/>`],
    ["xmlns bare inne i en attributtverdi", `<svg data-a='xmlns="http://www.w3.org/2000/svg"'/>`],
  ];

  it.each(utvalgte)("%s", (_navn, xml) => {
    expect(isSvgReadableAsImage(xml)).toBe(lesesAvDomParser(xml));
  });

  it("kontroll: utvalget inneholder både figurer som leses og figurer som ikke gjør det", () => {
    const svar = utvalgte.map(([, xml]) => lesesAvDomParser(xml));
    expect(svar.filter(Boolean).length).toBeGreaterThanOrEqual(8);
    expect(svar.filter((lest) => !lest).length).toBeGreaterThanOrEqual(15);
  });

  it("600 sammensatte tilfeller: aldri uenig med DOMParser", () => {
    const biter = [
      `<rect x="1" y="1" width="4" height="4"/>`, `<text x="1" y="9">§ 12</text>`, `<text>a&nbsp;b</text>`,
      `<text>a &amp; b</text>`, `<text>a < b</text>`, `<text>a\u0008b</text>`, `<text>a b</text>`,
      `<g aria-label="a < b"/>`, `<g aria-label="a &lt; b"/>`, `<g data-×="1"/>`, `<g id="a" id="b"/>`,
      `<!-- a -- b -->`, `<!-- a -->`, `<![CDATA[ < & ]]>`, `<style>.a > .b { fill: #eef; }</style>`,
      `<g>`, `</g>`, `<x:g/>`, `<g xmlns:x="urn:x"><x:g/></g>`, `&udefinert;`, `&#x1F600;`, `&#0;`, `]]>`,
      `<?pi a?>`, `<tspan xml:space="preserve"> a </tspan>`, `tekst`,
    ];
    const hoder = ["", `<?xml version="1.0" encoding="UTF-8"?>`, `<!DOCTYPE svg>`, `<!DOCTYPE svg [<!ENTITY nbsp " ">]>`, "﻿", " "];
    const røtter = [`<svg ${NS}>`, `<svg ${NS} viewBox="0 0 10 10">`, `<svg>`, `<svg xmlns="http://www.w3.org/1999/xhtml">`, `<g ${NS}>`];
    const haler = ["", "", "", "etterpå", `<svg ${NS}/>`, "<!-- slutt -->"];
    // Fast frø: samme 600 tilfeller hver gang, så en rød test kan kjøres på nytt og gi samme svar.
    let frø = 1083;
    const neste = (n: number) => { frø = (frø * 1103515245 + 12345) & 0x7fffffff; return frø % n; };
    const uenige: string[] = [];
    let lesbare = 0;
    for (let i = 0; i < 600; i++) {
      const rot = røtter[neste(røtter.length)]!;
      const innhold = Array.from({ length: neste(4) }, () => biter[neste(biter.length)]).join("");
      const xml = `${hoder[neste(hoder.length)]}${rot}${innhold}</${rot.slice(1, rot.indexOf(" ") > 0 ? rot.indexOf(" ") : -1)}>${haler[neste(haler.length)]}`;
      const fasit = lesesAvDomParser(xml);
      if (fasit) lesbare++;
      if (isSvgReadableAsImage(xml) !== fasit) uenige.push(xml);
    }
    expect(uenige).toEqual([]);
    // Uten dette kunne alle 600 vært uleselige, og testen hadde sammenlignet «nei» med «nei».
    expect(lesbare).toBeGreaterThan(50);
    expect(lesbare).toBeLessThan(550);
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
