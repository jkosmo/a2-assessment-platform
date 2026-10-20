import { describe, expect, it } from "vitest";
import { renderSectionBlocks } from "../../src/modules/course/contentBlocks.js";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1110: følge per alternativ i «sjekk deg selv» (case uten ny byggekloss).
// #1107: «finn parene» (:::par) — tjenerens tegning. Spillet i nettleseren er målt i
// test/dom/content-check-feedback-pairs.dom.test.js og test/e2e/participant-case-pairs-1110-1107.spec.ts.

const NL = "\n";
const lines = (...l: string[]) => l.join(NL);

const CASE = lines(
  ":::sjekk Søknaden inneholder naboens personnummer. Hva gjør du?",
  "- [ ] Avslår hele innsynet",
  "  For mye. Bare opplysningen som skal unntas,",
  "  kan holdes **tilbake**.",
  "- [x] Sladder personnummeret og gir innsyn i resten",
  "\tRiktig. Du unntar det som må unntas.",
  "- [ ] Sender alt",
  "",
  "Innsyn er hovedregelen.",
  ":::",
);

describe("#1110 følge per alternativ i «sjekk deg selv»", () => {
  it("hver følge står skjult i tilbakemeldingen, merket med alternativets plass, før forklaringen", () => {
    const html = renderSectionBlocks(CASE, "nb");
    expect(html.match(/<button type="button" class="content-check-option" data-check-option data-correct="(true|false)">/g)).toHaveLength(3);
    expect(html).toContain('<p class="content-check-option-feedback" data-check-feedback="0" hidden>For mye. Bare opplysningen som skal unntas, kan holdes <strong>tilbake</strong>.</p>');
    expect(html).toContain('<p class="content-check-option-feedback" data-check-feedback="1" hidden>Riktig. Du unntar det som må unntas.</p>');
    // Alternativet uten følge får ingen.
    expect(html).not.toContain('data-check-feedback="2"');
    expect(html.indexOf('data-check-feedback="1"')).toBeLessThan(html.indexOf("content-check-explanation"));
    expect(html).toMatch(/<div class="content-check-explanation" hidden><p>Innsyn er hovedregelen\.<\/p>/);
    // Følgene er ikke en del av alternativets tekst.
    expect(html).toMatch(/<span class="content-check-option-text">Avslår hele innsynet<\/span>/);
  });

  it("et innrykket alternativ er et alternativ, ikke en følge", () => {
    const html = renderSectionBlocks(lines(":::sjekk Hva stemmer?", "- [ ] En", "  - [x] To", "- [ ] Tre", ":::"), "nb");
    expect(html.match(/data-check-option/g)).toHaveLength(3);
    expect(html).not.toContain("data-check-feedback");
  });

  it("en innrykket linje før første alternativ er ingen følge: rammen er ingen blokk, teksten står", () => {
    const md = lines("Over.", "", ":::sjekk Hva stemmer?", "  innrykket", "- [x] Ja", "- [ ] Nei", ":::");
    const html = renderSectionBlocks(md, "nb");
    expect(html).not.toContain("content-check");
    expect(html).toContain(":::sjekk Hva stemmer?");
  });

  it("fasitregelen gjelder fortsatt med følger: to riktige gir ingen blokk", () => {
    const html = renderSectionBlocks(lines(":::sjekk Hva stemmer?", "- [x] Ja", "  Fordi.", "- [x] Nei", "  Også.", ":::"), "nb");
    expect(html).not.toContain("content-check");
  });

  it("følgene virker også i modulens tekst, som resten av «sjekk deg selv»", () => {
    const html = renderSectionBlocks(CASE, "nb", "moduleText");
    expect(html).toContain('data-check-feedback="0"');
  });

  it("rensingen på tjeneren beholder følgene skjult og merket", () => {
    const html = renderSectionMarkdown(CASE, "nb");
    expect(html).toMatch(/<p (?=[^>]*class="content-check-option-feedback")(?=[^>]*data-check-feedback="0")(?=[^>]*hidden)[^>]*>/);
  });

  it("forfatter-HTML i en følge blir ikke et skript", () => {
    const html = renderSectionMarkdown(lines(":::sjekk Hva?", "- [x] Ja", "  <img src=x onerror=alert(1)>Fordi", "- [ ] Nei", ":::"), "nb");
    expect(html).not.toMatch(/onerror/i);
  });
});

const PAIRS = lines(
  ":::par Koble begrepet med forklaringen",
  "- Hjemmel = Lovbestemmelsen et vedtak bygger på",
  "- *Merinnsyn* = Innsyn selv om dokumentet kunne vært unntatt",
  "* Klagefrist = Tiden parten har til å klage = også på avslag",
  "",
  "- Journalføring = Registrering av et dokument i arkivet",
  ":::",
);

describe("#1107 «finn parene»", () => {
  it("blir en liste med parene, etiketter på språket og instruksjonen", () => {
    const html = renderSectionBlocks(PAIRS, "nb");
    expect(html).toContain('<div class="content-pairs" data-content-pairs role="group" aria-label="Finn parene: Koble begrepet med forklaringen" data-terms="Begreper" data-defs="Forklaringer" data-status="{n} av {total} par" data-miss="Ikke et par. Prøv igjen." data-done="Alle {total} parene er riktige." data-matched="koblet">');
    expect(html).toContain('<span class="content-pairs-label">Finn parene</span><span class="content-pairs-title">Koble begrepet med forklaringen</span>');
    expect(html.match(/<li class="content-pairs-pair">/g)).toHaveLength(4);
    expect(html).toContain('<span class="content-pairs-term"><em>Merinnsyn</em></span>');
    // Delt ved første « = »: resten hører til forklaringen.
    expect(html).toContain('<span class="content-pairs-term">Klagefrist</span><span class="content-pairs-sep"> – </span><span class="content-pairs-def">Tiden parten har til å klage = også på avslag</span>');
  });

  it("etikettene følger språket; «pairs» er samme blokk, og instruksjonen er valgfri", () => {
    const en = renderSectionBlocks(PAIRS.replace(":::par Koble begrepet med forklaringen", ":::pairs"), "en-GB");
    expect(en).toContain('aria-label="Match the pairs"');
    expect(en).toContain('data-status="{n} of {total} pairs"');
    expect(en).not.toContain("content-pairs-title");
    const nn = renderSectionBlocks(PAIRS, "nn");
    expect(nn).toContain('<span class="content-pairs-label">Finn para</span>');
    expect(nn).toContain('data-done="Alle dei {total} para er rette."');
  });

  it.each([
    ["to par", lines(":::par", "- A = a", "- B = b", ":::")],
    ["en linje som ikke er et par", lines(":::par", "- A = a", "- B = b", "- C = c", "En setning.", ":::")],
    ["samme begrep to ganger", lines(":::par", "- A = a", "- a = b", "- C = c", ":::")],
    ["samme forklaring to ganger", lines(":::par", "- A = samme", "- B = Samme ", "- C = c", ":::")],
    ["et par uten mellomrom rundt =", lines(":::par", "- A=a", "- B = b", "- C = c", ":::")],
  ])("%s: ingen blokk, teksten står", (_navn, md) => {
    const html = renderSectionBlocks(md, "nb");
    expect(html).not.toContain("content-pairs");
    expect(html).toContain(":::par");
  });

  it("en ugyldig ramme rett under et avsnitt sletter ikke teksten (QA-lærdommen fra 2.96.0)", () => {
    const md = lines("Her er fagordene.", ":::par", "- A = a", "- B = b", ":::", "", "Neste avsnitt.");
    const html = renderSectionBlocks(md, "nb");
    // Samme tekst som vanlig markdown ville gitt — ingenting forsvinner.
    // Uten blokk er parene en vanlig liste (som ellers i markdown); begge står.
    expect(html).toContain("A = a");
    expect(html).toContain("B = b");
    expect(html).toContain("Neste avsnitt.");
    expect(html).toContain("Her er fagordene.");
  });

  it("CRLF tegnes som LF", () => {
    expect(renderSectionBlocks(PAIRS.split(NL).join("\r\n"), "nb")).toBe(renderSectionBlocks(PAIRS, "nb"));
  });

  it("i modulens tekst står rammen som vanlig tekst (øvelsene hører til seksjoner, produkteier 2026-10-20)", () => {
    const html = renderSectionBlocks(PAIRS, "nb", "moduleText");
    expect(html).not.toContain("content-pairs");
    expect(html).toContain(":::par Koble begrepet med forklaringen");
  });

  it("rensingen på tjeneren beholder lista, klassene og data-attributtene", () => {
    const html = renderSectionMarkdown(PAIRS, "nb");
    expect(html).toContain("data-content-pairs");
    expect(html).toContain('data-status="{n} av {total} par"');
    expect(html).toContain('class="content-pairs-list"');
    expect(html.match(/class="content-pairs-def"/g)).toHaveLength(4);
  });

  it("forfatter-HTML i et par blir ikke et skript", () => {
    const html = renderSectionMarkdown(lines(":::par", "- A = <img src=x onerror=alert(1)>", "- B = b", "- C = c", ":::"), "nb");
    expect(html).not.toMatch(/onerror/i);
  });
});
