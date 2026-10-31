import { describe, expect, it } from "vitest";
import { renderModuleTextMarkdown, renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";
import { splitErrorSentences } from "../../src/modules/course/contentBlocks.js";

// #1123: «Finn feilene» i seksjoner. Tegnet gjennom den EKTE rensingen (renderSectionMarkdown), så det som
// prøves er det deltakeren får: knappene med fasiten i data-error, forklaringene skjult, og tekstene på
// deltakerens språk. Bare i seksjoner, og bare når rammen er en blokk.

const FRAME = [
  ":::feil Finn de tre feilene i referatet",
  "- [ ] Styremøte 24. oktober. Til stede: Kari, Ola og Siri.",
  "- [x] Ola sender budsjettet til revisor innen **15. november**.",
  "  Fristen i notatene er 1. november.",
  "  Kontroll: sammenlign hver frist med notatene.",
  "- [ ] Siri ble valgt som ny nestleder.",
  "- [x] Kari bestiller lokale til julebordet.",
  ":::",
].join("\n");

describe("splitErrorSentences", () => {
  it("setninger, hvilke som er feil, og forklaringen under", () => {
    expect(splitErrorSentences(FRAME.split("\n").slice(1, -1).join("\n"))).toEqual([
      { error: false, text: "Styremøte 24. oktober. Til stede: Kari, Ola og Siri.", feedback: [] },
      { error: true, text: "Ola sender budsjettet til revisor innen **15. november**.", feedback: ["Fristen i notatene er 1. november.", "Kontroll: sammenlign hver frist med notatene."] },
      { error: false, text: "Siri ble valgt som ny nestleder.", feedback: [] },
      { error: true, text: "Kari bestiller lokale til julebordet.", feedback: [] },
    ]);
  });

  it.each([
    ["to setninger", "- [ ] A.\n- [x] B."],
    ["ingen feil", "- [ ] A.\n- [ ] B.\n- [ ] C."],
    ["bare feil", "- [x] A.\n- [x] B.\n- [x] C."],
    ["en løs linje", "- [ ] A.\nLøs tekst.\n- [x] B.\n- [ ] C."],
  ])("ingen blokk: %s", (_navn, inner) => {
    expect(splitErrorSentences(inner)).toBeNull();
  });
});

describe("renderSectionMarkdown — :::feil", () => {
  it("én knapp per setning med fasiten, forklaringene skjult, tekstene på bokmål", () => {
    const html = renderSectionMarkdown(FRAME, "nb");
    expect(html).toContain('class="content-errors"');
    expect(html).toContain('aria-label="Finn feilene: Finn de tre feilene i referatet"');
    const items = [...html.matchAll(/<button type="button" class="content-errors-item" data-errors-item="" data-error="(true|false)" aria-pressed="false">/g)].map((m) => m[1]);
    expect(items).toEqual(["false", "true", "false", "true"]);
    expect(html).toContain("<strong>15. november</strong>");
    expect(html).toMatch(/data-errors-feedback="" hidden=""><p class="content-errors-verdict"><\/p><p class="content-errors-explain">Fristen i notatene er 1\. november\. Kontroll: sammenlign hver frist med notatene\.<\/p>/);
    expect(html).toContain('data-status="Du fant {found} av {total} feil."');
    expect(html).toContain('data-missed="Denne gikk deg hus forbi."');
    expect(html).toContain(">Sjekk</button>");
    expect(html).toMatch(/data-errors-reset="" hidden="">Prøv igjen<\/button>/);
    expect(html).toContain('role="status"');
  });

  it("på nynorsk og engelsk, og «errors» er samme ramme", () => {
    expect(renderSectionMarkdown(FRAME, "nn")).toContain('data-status="Du fann {found} av {total} feil."');
    const en = renderSectionMarkdown(FRAME.replace(":::feil", ":::errors"), "en-GB");
    expect(en).toContain(">Find the errors</span>");
    expect(en).toContain(">Check</button>");
  });

  it("en ramme som ikke er en blokk, står som tekst — og i en moduls tekst tegnes ingen blokk", () => {
    expect(renderSectionMarkdown(":::feil Oppgave\n- [ ] A.\n- [x] B.\n:::", "nb")).not.toContain("content-errors");
    expect(renderModuleTextMarkdown(FRAME, "nb")).not.toContain("content-errors-item");
  });
});
