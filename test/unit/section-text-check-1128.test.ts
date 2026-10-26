import { describe, expect, it } from "vitest";
import { checkAltTexts, checkFigureNumbers, checkLeftovers } from "../../skills/a2-authoring-api/scripts/section-text-check.mjs";
import { altTextWarnings, packageAltTextWarnings } from "../../src/modules/adminContent/altTextWarnings.js";

// #1128: alt-tekst som bare er en tittel (44 av 121 på stage). #1129: arbeidsnotater, seksjoner med
// nummer og figurer nummerert i feil rekkefølge (alle funnet på stage).

describe("#1128 alt-tekst", () => {
  it("en tittel som alt-tekst → funn; en setning → ikke", () => {
    expect(checkAltTexts("![Enhetstest](asset:a)\n\n![Git i en QA-runde](asset:b)")).toEqual([{ alt: "Enhetstest", words: 1 }, { alt: "Git i en QA-runde", words: 5 }]);
    expect(checkAltTexts("![Agentløkken: et mål går inn, LLM vurderer neste steg](asset:a)")).toEqual([]);
  });

  it("seks ord er nok; fem er ikke", () => {
    expect(checkAltTexts("![en to tre fire fem seks](asset:a)")).toEqual([]);
    expect(checkAltTexts("![en to tre fire fem](asset:a)")).toHaveLength(1);
  });

  it("ikoner og bilder i kodeblokker teller ikke", () => {
    expect(checkAltTexts("### ![](icon:mic) Opptak\n\n```\n![x](asset:a)\n```")).toEqual([]);
  });

  it("plattformen: alle språk, samme alt-tekst én gang; per seksjon i en kurspakke", () => {
    expect(altTextWarnings({ nb: "![Enhetstest](asset:a)", nn: "![Enhetstest](asset:a)", "en-GB": "![Unit test](asset:a)" })).toEqual([
      { code: "alt_is_title", alt: "Enhetstest" },
      { code: "alt_is_title", alt: "Unit test" },
    ]);
    const env = { course: { course: { items: [
      { type: "SECTION", section: { title: { nb: "God" }, bodyMarkdown: { nb: "![Fire steg fra møte til referat, i to faser](asset:a)" } } },
      { type: "SECTION", section: { title: { nb: "Svak" }, bodyMarkdown: { nb: "![Enhetstest](asset:a)" } } },
      { type: "MODULE", module: {} },
    ] } } };
    expect(packageAltTextWarnings(env)).toEqual([{ title: { nb: "Svak" }, warnings: [{ code: "alt_is_title", alt: "Enhetstest" }] }]);
  });
});

describe("#1129 rester fra forfatterarbeidet", () => {
  it.each([
    ["[Avklaring: innholdet bør sjekkes mot Lovdata.]", "note"],
    ["Dette må avklares før kurset publiseres.", "note"],
    ["Kilde: godkjent læringsseksjon 1.", "note"],
    ["Bygger på de godkjente modulene og godkjente moduler.", "note"],
    ["S-kurven behandles i Seksjon 3b.", "section_number"],
    ["See section 2 for the details.", "section_number"],
  ])("«%s» → %s", (text, kind) => {
    expect(checkLeftovers(text).map((f) => f.kind)).toContain(kind);
  });

  it.each([
    "Legg filen i mappen Modul 1/Innlevering.",
    "```text\n[Avklaring: et eksempel i en prompt]\nSeksjon 3\n```",
    "Seksjonen før forklarte dette.",
  ])("«%s» → ingen funn", (text) => {
    expect(checkLeftovers(text)).toEqual([]);
  });

  it("figurer i rekkefølge over hele kurset → ingen funn; 6 → 8 → 7 → funn med rekkefølgen", () => {
    expect(checkFigureNumbers(["*Figur 1. A*", "*Figur 2. B*\n\n*Figur 3. C*"])).toEqual([]);
    const [funn] = checkFigureNumbers(["*Figur 1. A*", "*Figur 3. B*", "*Figur 2. C*"]);
    expect(funn).toEqual({ expected: 2, actual: 3, order: [1, 3, 2] });
  });

  it("uten figurnummer → ingen funn", () => {
    expect(checkFigureNumbers(["Ingen figurer her.", "Figuren over viser flyten."])).toEqual([]);
  });
});
