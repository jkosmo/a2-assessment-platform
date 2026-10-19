import { describe, expect, it } from "vitest";
import { renderSectionBlocks } from "../../src/modules/course/contentBlocks.js";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1074 «Sjekk deg selv»: et flervalgsspørsmål midt i seksjonsteksten.

const BLOCK = [
  "Et godt referat bygger på det som ble bestemt.",
  "",
  ":::sjekk Hvilken kilde er **viktigst**?",
  "- [ ] Innkallingen",
  "- [x] Notatene fra møtet",
  "- [ ] Fjorårets referat",
  "",
  "Notatene viser hva som faktisk ble *bestemt*.",
  ":::",
  "",
  "Mer tekst.",
].join("\n");

describe("renderSectionBlocks: «Sjekk deg selv»", () => {
  it("blir en boks med spørsmål, knapper og en skjult forklaring", () => {
    const html = renderSectionBlocks(BLOCK, "nb");
    expect(html).toContain('<div class="content-check" data-content-check data-right="Riktig!" data-wrong="Ikke helt. Riktig svar er markert." data-sr-right="riktig svar" data-sr-chosen="ditt svar">');
    expect(html).toContain('<span class="content-check-label">Sjekk deg selv</span>');
    expect(html).toContain('<span class="content-check-text">Hvilken kilde er <strong>viktigst</strong>?</span>');
    const options = html.match(/<button type="button" class="content-check-option" data-check-option data-correct="(true|false)">/g) ?? [];
    expect(options).toHaveLength(3);
    expect(options.filter((o) => o.includes('"true"'))).toHaveLength(1);
    expect(html).toMatch(/data-correct="true">.*Notatene fra møtet/);
    expect(html).toContain('<div class="content-check-explanation" hidden><p>Notatene viser hva som faktisk ble <em>bestemt</em>.</p>');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Hvilken kilde er viktigst?"');
    // Teksten rundt står som vanlig tekst.
    expect(html).toContain("<p>Et godt referat bygger på det som ble bestemt.</p>");
    expect(html).toContain("<p>Mer tekst.</p>");
  });

  it("merkelappen og tilbakemeldingen følger språket; «check» er samme blokk", () => {
    expect(renderSectionBlocks(BLOCK.replace(":::sjekk", ":::check"), "en-GB")).toContain('<span class="content-check-label">Check yourself</span>');
    const nn = renderSectionBlocks(BLOCK, "nn");
    expect(nn).toContain("Sjekk deg sjølv");
    expect(nn).toContain('data-right="Rett!"');
  });

  it("uten nøyaktig ett riktig svar, eller med færre enn to alternativer, er det ingen blokk", () => {
    const none = BLOCK.replace("- [x] Notatene", "- [ ] Notatene");
    const two = BLOCK.replace("- [ ] Innkallingen", "- [X] Innkallingen");
    const one = [":::sjekk Spørsmål?", "- [x] Bare ett", ":::"].join("\n");
    for (const text of [none, two, one]) expect(renderSectionBlocks(text, "nb")).not.toContain("content-check");
  });

  it("en forklaring er valgfri", () => {
    const html = renderSectionBlocks([":::sjekk Spørsmål?", "- [x] Ja", "- [ ] Nei", ":::"].join("\n"), "nb");
    expect(html).toContain('<div class="content-check-explanation" hidden></div>');
  });

  it("forfatter-HTML i et alternativ blir ikke et skript", () => {
    const html = renderSectionMarkdown([":::sjekk Spørsmål?", '- [x] <button onclick="alert(1)">Ja</button>', '- [ ] <img src=x onerror="alert(1)">', ":::"].join("\n"), "nb");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    // Rensingen fjerner hendelsesattributtene. Data-attributtene står, så en forfatter kan lage en
    // lignende knapp selv — ufarlig: klikket endrer bare utseende og tekst.
  });

  it("rensingen på tjeneren beholder knappene, data-attributtene og aria-feltene", () => {
    const html = renderSectionMarkdown(BLOCK, "nb");
    expect(html).toContain('data-check-option=""');
    expect(html).toContain('data-correct="true"');
    expect(html).toContain('data-right="Riktig!"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="group"');
    expect(html).toMatch(/<div class="content-check-explanation" hidden="">/);
  });
});
