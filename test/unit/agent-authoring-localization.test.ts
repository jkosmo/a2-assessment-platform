// AA-6 (#762): unit tests for the localization check (Issue 3) — all three languages present,
// equal structure, answer key unchanged across languages, formulas/URLs/identifiers preserved,
// and no blind copies of the primary language.

import { describe, expect, it } from "vitest";
import {
  checkLocalization,
  checkFigureLocalization,
  extractSvgTextRuns,
  extractPreservedTokens,
  isBlindCopy,
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
