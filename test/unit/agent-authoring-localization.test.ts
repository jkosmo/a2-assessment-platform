// AA-6 (#762): unit tests for the localization check (Issue 3) — all three languages present,
// equal structure, answer key unchanged across languages, formulas/URLs/identifiers preserved,
// and no blind copies of the primary language.

import { describe, expect, it } from "vitest";
import {
  checkAnswerPatterns,
  checkLocalization,
  checkFigureLocalization,
  extractSvgTextRuns,
  extractPreservedTokens,
  isBlindCopy,
  partlyTranslatedLabels,
  practiceBlockShapes,
  presentLocales,
  // @ts-expect-error — .mjs skill script consumed as a library
} from "../../skills/a2-authoring-api/scripts/localization-check.mjs";

const b64 = (svg: string) => Buffer.from(svg, "utf8").toString("base64");

// A section object carrying one SVG figure with the given base + per-locale variants.
function figurePackage(
  base: string,
  variants: Array<{ locale: string; svg: string }>,
  sourceLocale = "nb",
): { packageFormat: string; objects: any[] } {
  return {
    packageFormat: "a2-authoring-package/v1",
    objects: [
      {
        clientRef: "sec-figur",
        type: "section",
        payload: {
          title: "Figur",
          bodyMarkdown: "![f](asset:fig-1)",
          assets: [
            {
              sourceId: "fig-1",
              filename: "fig.svg",
              mimeType: "image/svg+xml",
              sizeBytes: base.length,
              contentBase64: b64(base),
              sourceLocale,
              localizedVariants: variants.map((v) => ({ locale: v.locale, contentBase64: b64(v.svg) })),
            },
          ],
        },
      },
    ],
  };
}

const NB_FIG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Behandlingsgrunnlag</text><text>Formål</text></svg>';
const NN_FIG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Handsamingsgrunnlag</text><text>Føremål</text></svg>';
const EN_FIG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Legal basis</text><text>Purpose</text></svg>';

// A three-locale localized value.
const L = (nb: string, nn: string, en: string) => ({ nb, nn, "en-GB": en });

// A fully and REALLY translated package: distinct text per locale, identifiers/URLs preserved,
// MCQ correct answer semantically identical (maps to option 0 in every locale).
function fullyLocalizedPackage(): { packageFormat: string; objects: any[] } {
  return {
    packageFormat: "a2-authoring-package/v1",
    objects: [
      {
        clientRef: "modul-mcq",
        type: "module",
        payload: {
          module: {
            title: L("Personvernprinsippene", "Personvernprinsippa", "Data protection principles"),
            description: L("Flervalg om GDPR art. 5", "Fleirval om GDPR art. 5", "Multiple choice on GDPR art. 5"),
            certificationLevel: "basic",
          },
          activeVersion: {
            assessmentMode: "MCQ_ONLY",
            mcqSet: {
              title: L("Kontrollspørsmål", "Kontrollspørsmål", "Check questions"),
              questions: [
                {
                  stem: L(
                    "Hvilket prinsipp i art. 5 krever minst mulig data? Se https://gdpr.eu/art-5",
                    "Kva prinsipp i art. 5 krev minst mogleg data? Sjå https://gdpr.eu/art-5",
                    "Which principle in art. 5 requires the least data? See https://gdpr.eu/art-5",
                  ),
                  options: [
                    L("Dataminimering", "Dataminimering", "Data minimisation"),
                    L("Formålsbegrensning", "Føremålsavgrensing", "Purpose limitation"),
                  ],
                  correctAnswer: L("Dataminimering", "Dataminimering", "Data minimisation"),
                  rationale: L("Art. 5(1)(c) krever dette.", "Art. 5(1)(c) krev dette.", "Art. 5(1)(c) requires it."),
                },
              ],
            },
          },
        },
      },
      {
        clientRef: "kurs",
        type: "course",
        payload: {
          course: {
            title: L("Personvern for saksbehandlere", "Personvern for saksbehandlarar", "Data protection for case officers"),
            description: L("Grunnkurs i personvern.", "Grunnkurs i personvern.", "Introductory data protection course."),
            certificationLevel: "basic",
          },
          items: [{ type: "MODULE", ref: "modul-mcq" }],
        },
      },
    ],
  };
}

describe("#762 localization helpers", () => {
  it("presentLocales reports missing languages", () => {
    expect(presentLocales(L("a", "b", "c")).sort()).toEqual(["en-GB", "nb", "nn"]);
    expect(presentLocales({ nb: "a", "en-GB": "c" }).sort()).toEqual(["en-GB", "nb"]);
    expect(presentLocales("plain")).toEqual(["nb", "nn", "en-GB"]);
  });

  it("isBlindCopy flags identical prose but not identifiers/short tokens", () => {
    expect(isBlindCopy(L("Dette er en lang setning her", "Dette er en lang setning her", "Dette er en lang setning her"))).toBe(true);
    expect(isBlindCopy(L("Dataminimering", "Dataminimering", "Data minimisation"))).toBe(false);
    expect(isBlindCopy(L("GDPR", "GDPR", "GDPR"))).toBe(false); // proper noun, one token
    expect(isBlindCopy(L("72", "72", "72"))).toBe(false); // number
  });

  it("14. extractPreservedTokens finds URLs, article refs, identifiers and formulas", () => {
    const tokens = extractPreservedTokens("Se https://gdpr.eu/art-5 og art. 6(1)(b); formel risiko=3*4; fil rapport.pdf");
    expect([...tokens]).toEqual(expect.arrayContaining(["https://gdpr.eu/art-5", "art.6(1)(b)", "rapport.pdf"]));
  });
});

describe("#762 checkLocalization", () => {
  it("11. all three languages present, real translations → PASSES", () => {
    const result = checkLocalization(fullyLocalizedPackage());
    expect(result.blocks).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.blindCopies).toEqual([]);
    expect(result.answerKeyChanges).toEqual([]);
    expect(result.tokenDrift).toEqual([]);
  });

  it("12a. a section/field missing one language → FAILS", () => {
    const pkg = fullyLocalizedPackage();
    // Drop nn from the course title.
    pkg.objects[1].payload.course.title = { nb: "Personvern", "en-GB": "Data protection" } as never;
    const result = checkLocalization(pkg);
    expect(result.blocks).toBe(true);
    expect(result.missing.some((m: { missingLocales: string[] }) => m.missingLocales.includes("nn"))).toBe(true);
  });

  it("12b. an MCQ option missing one language → FAILS", () => {
    const pkg = fullyLocalizedPackage();
    // Remove en-GB from the second option.
    pkg.objects[0].payload.activeVersion.mcqSet.questions[0].options[1] = { nb: "Formålsbegrensning", nn: "Føremålsavgrensing" } as never;
    const result = checkLocalization(pkg);
    expect(result.blocks).toBe(true);
    expect(result.missing.some((m: { path: string }) => /options\[1\]/.test(m.path))).toBe(true);
  });

  it("13. a translation that changes the correct answer → FAILS", () => {
    const pkg = fullyLocalizedPackage();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    // In English the correct answer now points to option 1 (Purpose limitation) instead of 0.
    q.correctAnswer = L("Dataminimering", "Dataminimering", "Purpose limitation") as never;
    const result = checkLocalization(pkg);
    expect(result.blocks).toBe(true);
    expect(result.answerKeyChanges.length).toBeGreaterThan(0);
  });

  it("14. a formula/URL dropped from one translation → FAILS (token drift)", () => {
    const pkg = fullyLocalizedPackage();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    // Remove the URL from the English stem only.
    q.stem = { ...q.stem, "en-GB": "Which principle in art. 5 requires the least data?" } as never;
    const result = checkLocalization(pkg);
    expect(result.blocks).toBe(true);
    expect(result.tokenDrift.some((d: { token: string }) => d.token.includes("gdpr.eu"))).toBe(true);
  });

  it("a blind copy of the primary language → FAILS by default", () => {
    const pkg = fullyLocalizedPackage();
    // Copy the bokmål description verbatim into every locale.
    pkg.objects[1].payload.course.description = L(
      "Grunnkurs i personvern for saksbehandlere",
      "Grunnkurs i personvern for saksbehandlere",
      "Grunnkurs i personvern for saksbehandlere",
    );
    const result = checkLocalization(pkg);
    expect(result.blocks).toBe(true);
    expect(result.blindCopies.length).toBeGreaterThan(0);
  });
});

describe("#763 (Layer B) SVG figure localization", () => {
  it("extractSvgTextRuns reads leaf <text>/<tspan> runs in order, deduplicated", () => {
    expect(extractSvgTextRuns(NB_FIG)).toEqual(["Behandlingsgrunnlag", "Formål"]);
    const tspans = '<svg><text><tspan>A</tspan><tspan>B</tspan></text><text>A</text></svg>';
    expect(extractSvgTextRuns(tspans)).toEqual(["A", "B"]); // dedup, tspans preferred over parent
    expect(extractSvgTextRuns('<svg><rect/></svg>')).toEqual([]);
  });

  it("a fully-translated text-bearing figure → PASSES", () => {
    const result = checkFigureLocalization(
      figurePackage(NB_FIG, [
        { locale: "nn", svg: NN_FIG },
        { locale: "en-GB", svg: EN_FIG },
      ]),
    );
    expect(result.blocks).toBe(false);
    expect(result.missingVariants).toEqual([]);
    expect(result.textCountMismatches).toEqual([]);
    expect(result.blindCopies).toEqual([]);
    // And the full check folds it in without blocking (no other localized fields present).
    expect(checkLocalization(figurePackage(NB_FIG, [
      { locale: "nn", svg: NN_FIG },
      { locale: "en-GB", svg: EN_FIG },
    ])).figures.blocks).toBe(false);
  });

  it("a figure missing a locale variant → FAILS", () => {
    const result = checkFigureLocalization(figurePackage(NB_FIG, [{ locale: "nn", svg: NN_FIG }]));
    expect(result.blocks).toBe(true);
    expect(result.missingVariants.some((m: { locale: string }) => m.locale === "en-GB")).toBe(true);
    // Blocking bubbles up to the top-level check.
    expect(checkLocalization(figurePackage(NB_FIG, [{ locale: "nn", svg: NN_FIG }])).blocks).toBe(true);
  });

  it("a variant with a different label count → FAILS", () => {
    const EN_ONE = '<svg xmlns="http://www.w3.org/2000/svg"><text>Legal basis</text></svg>';
    const result = checkFigureLocalization(
      figurePackage(NB_FIG, [
        { locale: "nn", svg: NN_FIG },
        { locale: "en-GB", svg: EN_ONE },
      ]),
    );
    expect(result.blocks).toBe(true);
    expect(result.textCountMismatches.some((m: { locale: string; expected: number; actual: number }) =>
      m.locale === "en-GB" && m.expected === 2 && m.actual === 1)).toBe(true);
  });

  it("a variant that blindly copies the original labels → FAILS", () => {
    const result = checkFigureLocalization(
      figurePackage(NB_FIG, [
        { locale: "nn", svg: NN_FIG },
        { locale: "en-GB", svg: NB_FIG }, // English variant left as the bokmål labels
      ]),
    );
    expect(result.blocks).toBe(true);
    expect(result.blindCopies.some((b: { locale: string }) => b.locale === "en-GB")).toBe(true);
  });

  // #1079, funnet i prøvekjøringen av det ombygde skillet: «Samle data» og «Bearbeide data» heter det
  // samme på bokmål og nynorsk. Kontrollen kalte det en kopi, og modellen måtte bytte til et
  // dårligere ord for å komme gjennom.
  it("identical labels between bokmål and nynorsk are a translation, not a copy", () => {
    const result = checkFigureLocalization(
      figurePackage(NB_FIG, [
        { locale: "nn", svg: NB_FIG },
        { locale: "en-GB", svg: EN_FIG },
      ]),
    );
    expect(result.blindCopies).toEqual([]);
    expect(result.blocks).toBe(false);
  });

  it("the same holds the other way, and an English figure copied into a Norwegian variant still FAILS", () => {
    const fromNynorsk = checkFigureLocalization(figurePackage(NN_FIG, [{ locale: "nb", svg: NN_FIG }, { locale: "en-GB", svg: EN_FIG }], "nn"));
    expect(fromNynorsk.blindCopies).toEqual([]);
    const fromEnglish = checkFigureLocalization(figurePackage(EN_FIG, [{ locale: "nb", svg: EN_FIG }, { locale: "nn", svg: NN_FIG }], "en-GB"));
    expect(fromEnglish.blindCopies).toEqual([expect.objectContaining({ locale: "nb" })]);
  });

  it("an identifier/URL dropped from a variant label → FAILS (token drift)", () => {
    const NB_URL = '<svg xmlns="http://www.w3.org/2000/svg"><text>Se https://gdpr.eu/art-5</text></svg>';
    const NN_URL = '<svg xmlns="http://www.w3.org/2000/svg"><text>Sjå https://gdpr.eu/art-5</text></svg>';
    const EN_NO_URL = '<svg xmlns="http://www.w3.org/2000/svg"><text>See the article</text></svg>';
    const result = checkFigureLocalization(
      figurePackage(NB_URL, [
        { locale: "nn", svg: NN_URL },
        { locale: "en-GB", svg: EN_NO_URL },
      ]),
    );
    expect(result.blocks).toBe(true);
    expect(result.tokenDrift.some((d: { locale: string; token: string }) => d.locale === "en-GB" && d.token.includes("gdpr.eu"))).toBe(true);
  });

  it("a raster (non-SVG) figure is not treated as a translatable figure", () => {
    const pkg = figurePackage(NB_FIG, []);
    pkg.objects[0].payload.assets[0].mimeType = "image/png";
    const result = checkFigureLocalization(pkg);
    expect(result.blocks).toBe(false);
    expect(result.missingVariants).toEqual([]);
  });
});

// #1074: fasiten i «sjekk deg selv» står i teksten (`- [x]`), så den kan flytte seg i en oversettelse.
describe("«sjekk deg selv» på tre språk (#1074)", () => {
  const block = (q: string, a: string, b: string, right: 0 | 1) =>
    [`:::sjekk ${q}`, `- [${right === 0 ? "x" : " "}] ${a}`, `- [${right === 1 ? "x" : " "}] ${b}`, ":::"].join("\n");
  const sectionPackage = (en: string) => ({
    packageFormat: "a2-authoring-package/v1",
    objects: [{
      clientRef: "sec-sjekk",
      type: "section",
      payload: {
        title: L("Kilder", "Kjelder", "Sources"),
        bodyMarkdown: L(
          "Innledning.\n\n" + block("Hvilken kilde er viktigst?", "Innkallingen", "Notatene", 1),
          "Innleiing.\n\n" + block("Kva kjelde er viktigast?", "Innkallinga", "Notata", 1),
          en,
        ),
      },
    }],
  });

  it("samme plass på alle språk: ingen merknad", () => {
    const result = checkLocalization(sectionPackage("Introduction.\n\n" + block("Which source matters most?", "The invitation", "The notes", 1)));
    expect(result.answerKeyChanges).toEqual([]);
  });

  it("fasiten flyttet i engelsk: stopper", () => {
    const result = checkLocalization(sectionPackage("Introduction.\n\n" + block("Which source matters most?", "The invitation", "The notes", 0)));
    expect(result.answerKeyChanges.map((c: { detail: string }) => c.detail).join(" ")).toContain("right option (- [x]) in another place");
    expect(result.answerKeyChanges[0].detail).toContain("en-GB");
    expect(result.blocks).toBe(true);
  });

  it("spørsmålet mangler i engelsk: stopper", () => {
    const result = checkLocalization(sectionPackage("Introduction only."));
    expect(result.answerKeyChanges.some((c: { detail: string }) => c.detail.includes("en-GB"))).toBe(true);
  });
});

// #1075, #1076, #1078: et steg, et kort eller et sjekkpunkt som forsvinner i en oversettelse, ser
// deltakeren aldri. Formen skal være lik på alle språk.
describe("steg, skriv selv og repetisjonskort på tre språk (#1075, #1076, #1078)", () => {
  const NL = String.fromCharCode(10);
  const steps = (...titles: string[]) => [":::steg Tittel", ...titles.flatMap((t) => [`### ${t}`, "Tekst."]), ":::"].join(NL);
  const write = (...items: string[]) => [":::skriv Oppgave", "Eksempelsvaret.", "", "- [ ] et punkt i svaret, med tekst etter", "", "Mer svar.", "", ...items.map((i) => `- [ ] ${i}`), ":::"].join(NL);
  const flash = (...terms: string[]) => [":::flashcards", ...terms.flatMap((t) => [`### ${t}`, "Forklaring."]), ":::"].join(NL);

  it("formen leses som plattformen leser den: overskrifter per steg og kort, sjekkpunkter til slutt", () => {
    expect(practiceBlockShapes(`Innledning.${NL}${NL}${steps("A", "B", "C")}${NL}${NL}${write("x", "y")}${NL}${NL}${flash("V", "R")}`)).toEqual(["steg:3", "skriv:2", "repetisjon:2"]);
    // Engelsk markørord er samme ramme; Windows-linjeskift gir samme form.
    expect(practiceBlockShapes(steps("A", "B").replace(":::steg", ":::steps").split(NL).join(String.fromCharCode(13, 10)))).toEqual(["steg:2"]);
    expect(practiceBlockShapes("Ingen rammer her.")).toEqual([]);
  });

  it("#1107: «finn parene» telles i par, også med engelsk markørord", () => {
    const par = [":::par Koble", "- A = a", "- B = b = mer", "* C = c", ":::"].join(NL);
    expect(practiceBlockShapes(`${par}${NL}${NL}${par.replace(":::par Koble", ":::pairs")}`)).toEqual(["par:3", "par:3"]);
  });

  const sectionPackage = (nb: string, nn: string, en: string) => ({
    packageFormat: "a2-authoring-package/v1",
    objects: [{ clientRef: "sec-ovelser", type: "section", payload: { title: L("Øvelser", "Øvingar", "Exercises"), bodyMarkdown: L(`Innledning med flere ord.${NL}${NL}${nb}`, `Innleiing med fleire ord.${NL}${NL}${nn}`, `Introduction with more words.${NL}${NL}${en}`) } }],
  });

  it("lik form på alle språk: ingen merknad", () => {
    const result = checkLocalization(sectionPackage(
      `${steps("Les", "Skriv")}${NL}${NL}${write("hva", "når")}${NL}${NL}${flash("Vedtak", "Referent")}`,
      `${steps("Les", "Skriv")}${NL}${NL}${write("kva", "når")}${NL}${NL}${flash("Vedtak", "Referent")}`,
      `${steps("Read", "Write")}${NL}${NL}${write("what", "when")}${NL}${NL}${flash("Decision", "Minute-taker")}`,
    ));
    expect(result.blockShapeChanges).toEqual([]);
  });

  it.each<[string, string, string]>([
    ["et steg mangler", steps("Les", "Skriv"), steps("Read")],
    ["et sjekkpunkt mangler", write("hva", "når"), write("what")],
    ["et kort mangler", flash("Vedtak", "Referent"), flash("Decision")],
    ["rammen mangler", steps("Les", "Skriv"), "Only text."],
  ])("%s i engelsk: stopper, og sier hvilket språk", (_name, nb, en) => {
    const result = checkLocalization(sectionPackage(nb, nb.replace("Eksempelsvaret", "Dømesvaret"), en));
    expect(result.blockShapeChanges).toHaveLength(1);
    expect(result.blockShapeChanges[0].detail).toContain("in: en-GB");
    expect(result.blocks).toBe(true);
    expect(result.reasons.join(" ")).toContain("step, checklist or flashcard frame(s) with another shape in a translation");
  });
});


// #1110: en følge (innrykket linje under et alternativ) skal stå under samme alternativ på alle språk.
describe("følge per alternativ i fasitmønsteret (#1110)", () => {
  const NL = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);
  it("en følge gir «f» etter alternativet; mønsteret leser videre forbi den", () => {
    const md = [":::sjekk Hva?", "- [ ] En", "  Fordi en.", "  Og mer.", "- [x] To", "- [ ] Tre", `${TAB}Fordi tre.`, ":::"].join(NL);
    expect(checkAnswerPatterns(md)).toEqual(["0f10f"]);
  });
  it("uten følger er mønsteret som før", () => {
    expect(checkAnswerPatterns([":::sjekk Hva?", "- [ ] En", "- [x] To", "", "Forklaring.", ":::"].join(NL))).toEqual(["01"]);
  });
  it("en følge flyttet til et annet alternativ gir et annet mønster", () => {
    const a = [":::sjekk Hva?", "- [ ] En", "  Følge.", "- [x] To", ":::"].join(NL);
    const b = [":::sjekk Hva?", "- [ ] En", "- [x] To", "  Følge.", ":::"].join(NL);
    expect(checkAnswerPatterns(a)).not.toEqual(checkAnswerPatterns(b));
  });
});

// Repetisjon Modul 3 (2.98.0): den engelske tabellen sa [SOURCE-BASED], «finn parene» rett under sa
// [KILDEBASERT]. En merkelapp skal være den samme overalt på ett språk.
describe("merkelapper oversatt bare noen steder", () => {
  const NL = String.fromCharCode(10);
  const nb = ["| Merke | Betyr |", "|---|---|", "| [KILDEBASERT] | står i kilden |", "", ":::par", "[KILDEBASERT] = står i kilden", "[AVLEDET] = utledet", "[UKJENT] = mangler", ":::"].join(NL);
  const nn = nb.replace("står i kilden |", "står i kjelda |").replace("står i kilden", "står i kjelda");
  const pkg = (en: string) => ({
    packageFormat: "a2-authoring-package/v1",
    objects: [{ clientRef: "sec-merker", type: "section", payload: { title: L("Merker", "Merke", "Labels"), bodyMarkdown: L(nb, nn, en) } }],
  });

  it("oversatt i tabellen, latt stå i øvelsen: stopper", () => {
    const en = nb.replace("| [KILDEBASERT] | står i kilden |", "| [SOURCE-BASED] | in the source |").replace("Merke | Betyr", "Label | Means");
    const result = checkLocalization(pkg(en));
    expect(result.labelDrift.map((d: { detail: string }) => d.detail).join(" ")).toContain("en-GB: [KILDEBASERT] is left 1 time(s) where nb has it 2");
    expect(result.blocks).toBe(true);
  });

  it("nynorsk sjekkes også", () => {
    const nnHalf = nn.replace("| [KILDEBASERT] | står i kjelda |", "| [KJELDEBASERT] | står i kjelda |");
    const en = nb.replaceAll("[KILDEBASERT]", "[SOURCE-BASED]").replace("[AVLEDET]", "[DERIVED]").replace("[UKJENT]", "[UNKNOWN]");
    const result = checkLocalization({ packageFormat: "a2-authoring-package/v1", objects: [{ clientRef: "sec-merker", type: "section", payload: { title: L("Merker", "Merke", "Labels"), bodyMarkdown: L(nb, nnHalf, en) } }] });
    expect(result.labelDrift.map((d: { detail: string }) => d.detail).join(" ")).toContain("nn: [KILDEBASERT] is left 1 time(s)");
  });

  it("oversatt overalt: ingen merknad", () => {
    const en = nb.replaceAll("[KILDEBASERT]", "[SOURCE-BASED]").replace("[AVLEDET]", "[DERIVED]").replace("[UKJENT]", "[UNKNOWN]");
    expect(checkLocalization(pkg(en)).labelDrift).toEqual([]);
  });

  it("nynorsk oversetter én merkelapp og lar en annen stå overalt: ingen merknad", () => {
    expect(partlyTranslatedLabels(nb, nn.replaceAll("[KILDEBASERT]", "[KJELDEBASERT]"))).toEqual([]);
  });

  it("nynorsk med samme merkelapper, én setning skrevet om: ingen merknad", () => {
    const nnShorter = nn.replace("| [KILDEBASERT] | står i kjelda |", "| (kjelda) | står i kjelda |");
    expect(partlyTranslatedLabels(nb, nnShorter)).toEqual([]);
  });

  it("lenketekst i store bokstaver er ikke en merkelapp", () => {
    expect(partlyTranslatedLabels("[GDPR](https://a) og [GDPR](https://b)", "[GDPR](https://a) og [EØS](https://b)")).toEqual([]);
  });
});

// #1077: «velg alle som stemmer» — fasiten er flere plasser, og de må være de samme på alle språk.
describe("#1077 checkLocalization — flere riktige svar", () => {
  const multiplePackage = () => {
    const pkg = fullyLocalizedPackage();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    q.options.push(L("Lagringsbegrensning", "Lagringsavgrensing", "Storage limitation"));
    q.questionType = "multiple";
    q.correctAnswers = [q.options[0], q.options[2]];
    delete q.correctAnswer;
    return pkg;
  };

  it("de riktige på samme plasser på alle språk → består", () => {
    const result = checkLocalization(multiplePackage());
    expect(result.answerKeyChanges).toEqual([]);
  });

  it("en oversettelse som peker på et annet alternativ → stopper", () => {
    const pkg = multiplePackage();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    // På engelsk peker det andre riktige nå på alternativ 2 (Purpose limitation), ikke 3.
    q.correctAnswers[1] = L("Lagringsbegrensning", "Lagringsavgrensing", "Purpose limitation");
    const result = checkLocalization(pkg);
    expect(result.blocks).toBe(true);
    expect(result.answerKeyChanges.some((c: { detail: string }) => /correct options differ across locales: en-GB/.test(c.detail))).toBe(true);
  });

  it("et riktig som ikke er et alternativ på ett språk → stopper", () => {
    const pkg = multiplePackage();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    q.correctAnswers[1] = L("Lagringsbegrensning", "Noko anna", "Storage limitation");
    const result = checkLocalization(pkg);
    expect(result.answerKeyChanges.some((c: { detail: string }) => /correctAnswers does not match any option/.test(c.detail))).toBe(true);
  });

  it("et riktig som mangler et språk → meldt som manglende felt", () => {
    const pkg = multiplePackage();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    q.correctAnswers[0] = { nb: "Dataminimering", nn: "Dataminimering" };
    const result = checkLocalization(pkg);
    expect(result.missing.some((m: { path: string }) => /correctAnswers\[0\]/.test(m.path))).toBe(true);
  });
});

// #1077 leveranse 2: i «sett i riktig rekkefølge» ER alternativene fasiten, i samme rekkefølge på alle
// språk. Det finnes ikke noe eget svar å sammenligne — et spørsmål uten correctAnswer er gyldig.
describe("#1077 leveranse 2 — «order» i språkkontrollen", () => {
  const withOrder = (extra: Record<string, unknown> = {}) => {
    const pkg = fullyLocalizedPackage();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    delete q.correctAnswer;
    Object.assign(q, {
      questionType: "order",
      options: [L("Motta klagen", "Ta imot klaga", "Receive the complaint"), L("Vurdere fristen", "Vurdere fristen", "Check the deadline"), L("Avgjøre", "Avgjere", "Decide")],
      ...extra,
    });
    return pkg;
  };

  it("et oversatt spørsmål uten correctAnswer går gjennom — ingen falsk fasitendring", () => {
    const result = checkLocalization(withOrder());
    expect(result.answerKeyChanges).toEqual([]);
    expect(result.missing.filter((m: { path: string }) => /questions\[0\]/.test(m.path))).toEqual([]);
  });

  it("kontroll: et element som mangler et språk, meldes fortsatt", () => {
    const pkg = withOrder();
    const q = pkg.objects[0].payload.activeVersion.mcqSet.questions[0];
    q.options[1] = { nb: "Vurdere fristen", nn: "Vurdere fristen" };
    const result = checkLocalization(pkg);
    expect(result.missing.some((m: { path: string }) => /questions\[0\]\.options\[1\]/.test(m.path))).toBe(true);
  });
});
