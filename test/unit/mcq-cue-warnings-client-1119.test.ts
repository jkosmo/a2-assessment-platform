import { describe, expect, it } from "vitest";
import { PLATFORM_CUE_KINDS, mcqCueWarnings } from "../../src/modules/adminContent/mcqCueWarnings.js";
// @ts-expect-error — klientmodul uten typer
import { describeAltWarnings, describeCueWarnings, describePackageCueWarnings, describeRubricWarnings } from "../../public/static/mcq-cue-warnings.js";
// @ts-expect-error — klientmodul uten typer
import { translations } from "../../public/i18n/admin-content-translations.js";
// @ts-expect-error — klientmodul uten typer
import { createTranslator } from "../../public/static/i18n-locale.js";

// #1119: hver regel plattformen viser, har en tekst på alle tre språk — ellers ville varselet
// forsvinne stille (klienten viser ikke rå nøkler).

describe("#1119 varseltekstene", () => {
  it.each(["nb", "nn", "en-GB"])("%s har tekst for hver regel plattformen viser", (locale) => {
    for (const kind of PLATFORM_CUE_KINDS) expect(translations[locale][`mcqCue.${kind}`], kind).toBeTruthy();
  });

  it.each(["nb", "nn", "en-GB"])("%s har tekstene for kriteriekontrollen (#1122)", (locale) => {
    for (const key of ["rubricCheck.scale_not_described", "rubricCheck.heading", "rubricCheck.importedCourse", "altCheck.alt_is_title", "altCheck.heading", "altCheck.importedCourse"]) expect(translations[locale][key], key).toBeTruthy();
    expect(translations.nn["altCheck.alt_is_title"]).not.toBe(translations.nb["altCheck.alt_is_title"]);
    expect(translations.nn["rubricCheck.scale_not_described"]).not.toBe(translations.nb["rubricCheck.scale_not_described"]);
  });

  it("nb og nn er oversatt, ikke den engelske teksten", () => {
    for (const kind of PLATFORM_CUE_KINDS) {
      expect(translations.nb[`mcqCue.${kind}`]).not.toBe(translations["en-GB"][`mcqCue.${kind}`]);
      expect(translations.nn[`mcqCue.${kind}`]).not.toBe(translations.nb[`mcqCue.${kind}`]);
    }
  });

  it("plattformen viser bare reglene om at svaret røper seg — ikke formreglene den har egne kontroller for", () => {
    const L = (s: string) => ({ nb: s });
    // To alternativer (too_few_options) og «alle de ovenfor» (catch_all_option, vises).
    const warnings = mcqCueWarnings([{ stem: L("Hva gjør du først?"), options: [L("Leser"), L("Alle de ovenfor")], correctAnswer: L("Leser") }]);
    expect(warnings.map((w) => w.code)).toEqual(["catch_all_option"]);
  });

  const { t, tf } = createTranslator(translations, () => "nb");

  it("setter inn spørsmålsnummer og antall, og hopper over ukjente koder", () => {
    const lines = describeCueWarnings([{ code: "stem_about_course", question: 2 }, { code: "absolute_words", question: null, count: 5 }, { code: "ukjent", question: 1 }], t, tf);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Spørsmål 2 spør hva kurset sier/);
    expect(lines[1]).toMatch(/^5 gale alternativer/);
  });

  it("#1122: kriterievarselet nevner kriteriet; i kursimporten med modulens tittel", () => {
    expect(describeRubricWarnings([{ code: "scale_not_described", criterion: "Funn" }], t, tf)).toEqual(["Kriteriet «Funn» har én linje for hele skalaen. Beskriv hva som gir laveste poeng, høyeste, og et trinn imellom."]);
    const lines = describePackageCueWarnings([{ title: { nb: "Innlevering" }, warnings: [{ code: "scale_not_described", criterion: "Funn" }] }], t, tf, (title: { nb: string }) => title.nb, describeRubricWarnings);
    expect(lines[0]).toMatch(/^Innlevering: Kriteriet «Funn»/);
    expect(describeRubricWarnings([{ code: "ukjent", criterion: "Funn" }], t, tf)).toEqual([]);
    // #1128
    expect(describeAltWarnings([{ code: "alt_is_title", alt: "Enhetstest" }, { code: "ukjent", alt: "x" }], t, tf)).toEqual(["Bildet «Enhetstest» har en tittel som beskrivelse. Si hva det viser, i en setning — en skjermleser leser ikke noe annet."]);
  });

  it("kursimport: én linje per test, med tittelen", () => {
    const lines = describePackageCueWarnings([{ title: { nb: "Kunnskapstest" }, warnings: [{ code: "count_in_stem", question: 3 }] }], t, tf, (title: { nb: string }) => title.nb);
    expect(lines).toEqual(["Kunnskapstest: Spørsmål 3 sier hvor mange alternativer som er riktige."]);
  });
});
