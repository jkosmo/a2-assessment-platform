import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderModuleTextMarkdown, renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// 2.96.1 — produkteier 2026-10-20: steg for steg (#1075), skriv selv (#1076) og repetisjonskort (#1078)
// tegnes IKKE i modulens tekst (oppgavetekst, veiledning, forventet innhold). Der står de som vanlig
// tekst, slik en ugyldig ramme gjør. «Tenk først», «sjekk deg selv», kort, prompt-boks og uthevet boks
// tegnes som før. Avgjørelsen tas på tjeneren (ContentBlockVariant i contentBlocks.ts).

const NL = String.fromCharCode(10);
const F = "```";
const lines = (...rows: string[]) => rows.join(NL);

const STEPS = lines("Gjør slik:", "", ":::steg Slik gjør du", "### Les", "Les saken.", "### Skriv", "Skriv svaret.", ":::");
const WRITE = lines("Prøv først:", "", ":::skriv Skriv et vedtak.", "Eksempelsvaret.", "", "- [ ] hva?", "- [ ] når?", ":::");
const FLASH = lines("Fagord:", "", ":::repetisjon", "### Vedtak", "Det møtet bestemte.", "### Referent", "Den som skriver.", ":::");

/** Samme tekst med et markørord plattformen ikke kjenner — vanlig markdown — med ordet satt tilbake. */
const plain = (markdown: string, marker: string) => renderSectionMarkdown(markdown.replace(marker, ":::ingenramme"), "nb").replace(":::ingenramme", marker);

describe("modulens tekst: øvelsene fra seksjoner står som vanlig tekst", () => {
  it.each<[string, string, string, string]>([
    ["steg for steg", STEPS, ":::steg", "content-steps"],
    ["skriv selv", WRITE, ":::skriv", "content-write"],
    ["repetisjonskort", FLASH, ":::repetisjon", "content-flash"],
  ])("%s: ingen blokk, og teksten står som den er", (_name, markdown, marker, cls) => {
    const html = renderModuleTextMarkdown(markdown, "nb");
    expect(html).not.toContain(cls);
    expect(html).not.toContain("<textarea");
    expect(html).toBe(plain(markdown, marker));
    // Kontroll: i en seksjon er det samme en blokk.
    expect(renderSectionMarkdown(markdown, "nb")).toContain(`<div class="${cls}"`);
  });

  it("de andre blokkene tegnes som før i modulens tekst", () => {
    const html = renderModuleTextMarkdown(
      lines(
        ":::tenk Hva tror du?", "Svaret.", ":::", "",
        ":::sjekk Hva stemmer?", "- [x] Ja", "- [ ] Nei", ":::", "",
        ":::kort", "### A", "en", "### B", "to", ":::", "",
        `${F}prompt`, "Skriv et referat.", F, "",
        "> **Husk:** Frist fredag.",
      ),
      "nb",
    );
    expect(html).toContain('<details class="content-think">');
    expect(html).toContain('class="content-check"');
    expect(html).toContain('<div class="content-cards">');
    expect(html).toContain('<div class="content-prompt">');
    expect(html).toContain('<blockquote class="content-callout">');
  });

  it("seksjonen er uendret: standarden er seksjon", () => {
    for (const markdown of [STEPS, WRITE, FLASH]) {
      expect(renderSectionMarkdown(markdown, "nb")).toBe(renderSectionMarkdown(markdown, "nb", "section"));
    }
  });
});

// Dekningsvakt: alle som tegner modulens tekst på tjeneren, går gjennom renderModuleTextMarkdown.
describe("modulens tekst tegnes med modulvarianten", () => {
  it("moduleService bruker renderModuleTextMarkdown, ikke seksjonsvarianten", () => {
    const source = readFileSync("src/modules/module/moduleService.ts", "utf8");
    expect(source).toMatch(/taskTextHtml: typeof taskText === "string" \? renderModuleTextMarkdown\(/);
    expect(source).toMatch(/renderModuleTextMarkdown\(candidateTaskConstraints, locale\)/);
    expect(source).not.toMatch(/renderSectionMarkdown\(/);
  });

  it("forhåndsvisningen i modularbeidsflaten ber tjeneren om modulvarianten", () => {
    const source = readFileSync("public/static/admin-content-preview.js", "utf8");
    expect(source).toContain('variant: "moduleText"');
  });
});
