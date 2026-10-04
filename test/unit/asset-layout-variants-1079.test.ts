// #1079: en figur kan ha et smalt oppsett ved siden av det brede. Enhetstester for de delene som
// ikke trenger database: skjemaene for import og forfatterpakker, regelen som avgjør om et oppsett
// godtas, tørrkjøringen av en forfatterpakke, og skillets egne sjekker.
//
// Integrasjonen (lagring, levering, oversettelse, eksport, sletting, reparasjon) ligger i
// test/m2-section-asset-layouts-1079.test.ts, og klientens valg i
// test/e2e/asset-layout-by-column-1079.spec.ts.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/prisma.js", () => ({ prisma: {} }));

import { ASSET_LAYOUTS, findLayoutVariantProblem, type IncomingSectionAsset } from "../../src/modules/course/assetCommands.js";
import { sectionAssetExportSchema } from "../../src/modules/adminContent/adminContentSchemas.js";
import { authoringSectionAssetSchema } from "../../src/modules/adminContent/agentAuthoringSchemas.js";
import { validateAuthoringPackage, type AuthoringValidationLookups } from "../../src/modules/adminContent/agentAuthoringValidationService.js";
// @ts-expect-error — .mjs skill script consumed as a library
import { ASSET_LAYOUTS as SKILL_ASSET_LAYOUTS, validateExportEnvelopeStructure } from "../../skills/a2-authoring-api/scripts/export-validate.mjs";
// @ts-expect-error — .mjs skill script consumed as a library
import { checkFigureLocalization } from "../../skills/a2-authoring-api/scripts/localization-check.mjs";
// @ts-expect-error — .mjs skill script consumed as a library
import { extractPackageElements } from "../../skills/a2-authoring-api/scripts/course-state.mjs";
import { drawFlowFigure } from "../../skills/a2-authoring-api/scripts/draw-flow-figure.mjs";

const figur = (bredde: number, tekster: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bredde} 100">${tekster.map((t, i) => `<text x="10" y="${20 + i * 20}">${t}</text>`).join("")}</svg>`;
const b64 = (svg: string) => Buffer.from(svg, "utf8").toString("base64");
const NB = ["Motta saken", "Vurder vilkårene", "Fatt vedtaket"];
const NN = ["Ta imot saka", "Vurder vilkåra", "Gjer vedtaket"];
const EN = ["Receive the case", "Assess the conditions", "Make the decision"];

type Oppsett = { layout: string; contentBase64: string; localizedVariants?: Array<{ locale: string; contentBase64: string }> };
const asset = (overstyr: Partial<IncomingSectionAsset> & { layoutVariants?: Oppsett[] } = {}): IncomingSectionAsset => ({
  sourceId: "flyt",
  filename: "flyt.svg",
  mimeType: "image/svg+xml",
  sizeBytes: figur(848, NB).length,
  contentBase64: b64(figur(848, NB)),
  sourceLocale: "nb",
  ...overstyr,
});
const smalt = (tekster = NB, ekstra: Partial<Oppsett> = {}): Oppsett => ({ layout: "narrow", contentBase64: b64(figur(480, tekster)), ...ekstra });
const oversatt = (bredde: number) => [
  { locale: "nn", contentBase64: b64(figur(bredde, NN)) },
  { locale: "en-GB", contentBase64: b64(figur(bredde, EN)) },
];
/** En figur med alt: bredt og smalt, begge på tre språk. */
const fullFigur = () => asset({ localizedVariants: oversatt(848), layoutVariants: [smalt(NB, { localizedVariants: oversatt(480) })] });

describe("#1079 — skjemaene bærer det smale oppsettet", () => {
  it("eksportskjemaet beholder layoutVariants med oversettelsene — feltet strippes ikke stille", () => {
    const lest = sectionAssetExportSchema.parse(fullFigur());
    expect(lest.layoutVariants).toHaveLength(1);
    expect(lest.layoutVariants?.[0]?.layout).toBe("narrow");
    expect(lest.layoutVariants?.[0]?.localizedVariants?.map((v) => v.locale)).toEqual(["nn", "en-GB"]);
  });

  it("forfatterskjemaet godtar layoutVariants, og er fortsatt strengt om felt det ikke kjenner", () => {
    expect(authoringSectionAssetSchema.safeParse(fullFigur()).success).toBe(true);
    const medUkjent = asset({ layoutVariants: [{ ...smalt(), bredde: 480 } as unknown as Oppsett] });
    expect(authoringSectionAssetSchema.safeParse(medUkjent).success).toBe(false);
  });

  it("kontroll: en figur uten layoutVariants er gyldig i begge skjemaene, som før", () => {
    expect(sectionAssetExportSchema.safeParse(asset()).success).toBe(true);
    expect(authoringSectionAssetSchema.safeParse(asset()).success).toBe(true);
  });
});

describe("#1079 — regelen for hva et oppsett må være (findLayoutVariantProblem)", () => {
  it("kontroll: en figur uten oppsett, og en med et gyldig, har ingen problemer", () => {
    expect(findLayoutVariantProblem(asset())).toBeNull();
    expect(findLayoutVariantProblem(asset({ layoutVariants: [] }))).toBeNull();
    expect(findLayoutVariantProblem(asset({ layoutVariants: [smalt()] }))).toBeNull();
    expect(findLayoutVariantProblem(fullFigur())).toBeNull();
  });

  it.each<[string, IncomingSectionAsset, string]>([
    ["et ukjent oppsett", asset({ layoutVariants: [{ ...smalt(), layout: "diagonal" }] }), "asset_layout_unknown"],
    ["samme oppsett to ganger", asset({ layoutVariants: [smalt(), smalt()] }), "asset_layout_unknown"],
    ["en etikett bare i det smale", asset({ layoutVariants: [smalt([...NB, "Arkiver"])] }), "asset_layout_text_mismatch"],
    ["en etikett bare i det brede", asset({ layoutVariants: [smalt(NB.slice(0, 2))] }), "asset_layout_text_mismatch"],
    ["samme antall etiketter, én er en annen", asset({ layoutVariants: [smalt(["Motta saken", "Vurder vilkårene", "Arkiver"])] }), "asset_layout_text_mismatch"],
    [
      "oversettelsen av det smale sier noe annet enn oversettelsen av det brede",
      asset({ localizedVariants: oversatt(848), layoutVariants: [smalt(NB, { localizedVariants: [{ locale: "nn", contentBase64: b64(figur(480, ["Ta imot saka", "Vurder vilkåra", "Arkiver"])) }] })] }),
      "asset_layout_text_mismatch",
    ],
    ["et smalt oppsett som ikke er en SVG", asset({ layoutVariants: [{ layout: "narrow", contentBase64: b64("ikke en figur") }] }), "asset_svg_invalid"],
    ["et rasterbilde med oppsett", asset({ mimeType: "image/png", filename: "b.png", contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"), layoutVariants: [smalt()] }), "asset_layout_not_svg"],
  ])("%s → %s", (_navn, figuren, kode) => {
    expect(findLayoutVariantProblem(figuren)?.code).toBe(kode);
  });

  it("rekkefølgen på etikettene spiller ingen rolle, og en etikett som står to ganger i det smale, teller én gang", () => {
    // Det smale oppsettet brekker en fase over to rader, og fasens navn står da to ganger.
    expect(findLayoutVariantProblem(asset({ layoutVariants: [smalt([NB[2]!, NB[0]!, NB[1]!, NB[0]!])] }))).toBeNull();
  });

  it("en oversettelse av det smale til et språk det brede ikke har, har ingenting å bli sammenlignet med — og godtas", () => {
    expect(findLayoutVariantProblem(asset({ layoutVariants: [smalt(NB, { localizedVariants: [{ locale: "en-GB", contentBase64: b64(figur(480, EN)) }] })] }))).toBeNull();
  });

  it("det skriptet tegner, godtas: bredt og smalt fra samme beskrivelse har de samme etikettene", () => {
    const { wide, narrow } = drawFlowFigure({
      name: "saksgang",
      title: "Saksgang",
      desc: "Seks steg i tre faser.",
      phases: { a: { label: "Først", grunn: "#d9e8dd", lys: "#6fae87" }, b: { label: "Så", grunn: "#dce7f2", lys: "#7fa3c7" }, c: { label: "Sist", grunn: "#e7e2f0", lys: "#a99bc9" } },
      steps: [
        { label: ["Motta", "saken"], phase: "a" }, { label: ["Sjekk", "vedlegg"], phase: "a" }, { label: ["Vurder", "vilkårene"], phase: "b" },
        { label: ["Drøft"], phase: "b" }, { label: ["Skriv", "vedtaket"], phase: "c" }, { label: ["Arkiver"], phase: "c" },
      ],
    });
    expect(findLayoutVariantProblem(asset({ contentBase64: b64(wide), layoutVariants: [{ layout: "narrow", contentBase64: b64(narrow) }] }))).toBeNull();
  });

  it("skillet og plattformen kjenner de samme oppsettene", () => {
    expect([...SKILL_ASSET_LAYOUTS]).toEqual([...ASSET_LAYOUTS]);
  });
});

describe("#1079 — tørrkjøringen av en forfatterpakke sier det samme som importen ville sagt", () => {
  const oppslag: AuthoringValidationLookups = {
    listActiveModuleTitles: async () => [],
    listActiveCourseTitles: async () => [],
    listActiveSectionTitles: async () => [],
    findExistingModuleIds: async () => new Set(),
    findExistingSectionIds: async () => new Set(),
  };
  const pakke = (figuren: IncomingSectionAsset) => ({
    packageFormat: "a2-authoring-package/v1",
    objects: [{ clientRef: "sek", type: "section", payload: { title: "S", bodyMarkdown: "![Flyt](asset:flyt)", assets: [figuren] } }],
  });

  it("en pakke med et gyldig smalt oppsett er gyldig", async () => {
    const rapport = await validateAuthoringPackage(pakke(fullFigur()), oppslag);
    expect(rapport.issues).toEqual([]);
    expect(rapport.valid).toBe(true);
  });

  it.each<[string, IncomingSectionAsset, string]>([
    ["et ukjent oppsett", asset({ layoutVariants: [{ ...smalt(), layout: "diagonal" }] }), "asset_layout_unknown"],
    ["etiketter som ikke stemmer", asset({ layoutVariants: [smalt([...NB, "Arkiver"])] }), "asset_layout_text_mismatch"],
    ["et smalt oppsett som ikke er en figur", asset({ layoutVariants: [{ layout: "narrow", contentBase64: b64("<p>nei</p>") }] }), "asset_svg_invalid"],
  ])("%s meldes som feil, med stien til layoutVariants", async (_navn, figuren, kode) => {
    const rapport = await validateAuthoringPackage(pakke(figuren), oppslag);
    expect(rapport.valid).toBe(false);
    expect(rapport.issues).toContainEqual(expect.objectContaining({ severity: "error", code: kode, path: "objects[0].payload.assets[0].layoutVariants" }));
  });

  it("en figur som selv er avvist, får ikke en feil til for oppsettene sine", async () => {
    const rapport = await validateAuthoringPackage(pakke(asset({ contentBase64: b64("<p>ikke en figur</p>"), layoutVariants: [smalt()] })), oppslag);
    expect(rapport.issues.filter((i) => i.severity === "error").map((i) => i.code)).toEqual(["asset_svg_unsanitizable"]);
  });
});

describe("#1079 — skillets egne sjekker kjenner det smale oppsettet", () => {
  const pakke = (figuren: IncomingSectionAsset) => ({
    packageFormat: "a2-authoring-package/v1",
    objects: [{ clientRef: "sek", type: "section", payload: { title: "S", bodyMarkdown: "![Flyt](asset:flyt)", assets: [figuren] } }],
  });
  const konvolutt = (figuren: unknown) => ({
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-10-04T12:00:00.000Z",
    scope: "section",
    section: { title: { nb: "S" }, bodyMarkdown: { nb: "![Flyt](asset:flyt)" }, audit: {}, assets: [figuren] },
  });

  describe("oversettelsessjekken", () => {
    it("kontroll: en figur med bredt og smalt, begge på tre språk, består", () => {
      const r = checkFigureLocalization(pakke(fullFigur()));
      expect(r.reasons).toEqual([]);
      expect(r.blocks).toBe(false);
    });

    it("et smalt oppsett som mangler en språkvariant, stopper — og stien peker på oppsettet", () => {
      const r = checkFigureLocalization(pakke(asset({ localizedVariants: oversatt(848), layoutVariants: [smalt(NB, { localizedVariants: oversatt(480).slice(0, 1) })] })));
      expect(r.blocks).toBe(true);
      expect(r.missingVariants).toEqual([{ path: "sek.assets[0].layoutVariants[0]", sourceId: "flyt", locale: "en-GB" }]);
    });

    it("et smalt oppsett uten noen oversettelse stopper for begge språkene", () => {
      const r = checkFigureLocalization(pakke(asset({ localizedVariants: oversatt(848), layoutVariants: [smalt()] })));
      expect(r.missingVariants.map((m: { path: string; locale: string }) => `${m.path}:${m.locale}`).sort()).toEqual(["sek.assets[0].layoutVariants[0]:en-GB", "sek.assets[0].layoutVariants[0]:nn"]);
    });

    it("et smalt oppsett med andre etiketter enn det brede stopper, med egen grunn", () => {
      const r = checkFigureLocalization(pakke(asset({ localizedVariants: oversatt(848), layoutVariants: [smalt(["Motta saken", "Vurder vilkårene", "Arkiver"], { localizedVariants: oversatt(480) })] })));
      expect(r.blocks).toBe(true);
      expect(r.layoutTextMismatches).toEqual([{ path: "sek.assets[0].layoutVariants[0]", sourceId: "flyt", layout: "narrow", locale: null }]);
      expect(r.reasons.join(" ")).toContain("do not carry the same labels as the wide figure");
    });

    it("en oversettelse av det smale som sier noe annet enn oversettelsen av det brede, stopper", () => {
      const feil = [{ locale: "nn", contentBase64: b64(figur(480, ["Ta imot saka", "Vurder vilkåra", "Arkiver"])) }, { locale: "en-GB", contentBase64: b64(figur(480, EN)) }];
      const r = checkFigureLocalization(pakke(asset({ localizedVariants: oversatt(848), layoutVariants: [smalt(NB, { localizedVariants: feil })] })));
      expect(r.layoutTextMismatches).toEqual([{ path: "sek.assets[0].layoutVariants[0]", sourceId: "flyt", layout: "narrow", locale: "nn" }]);
    });

    it("et smalt oppsett som er en blind kopi av norsk i den engelske varianten, stopper som for det brede", () => {
      const kopi = [{ locale: "nn", contentBase64: b64(figur(480, NN)) }, { locale: "en-GB", contentBase64: b64(figur(480, NB)) }];
      const r = checkFigureLocalization(pakke(asset({ localizedVariants: oversatt(848), layoutVariants: [smalt(NB, { localizedVariants: kopi })] })));
      expect(r.blindCopies).toContainEqual({ path: "sek.assets[0].layoutVariants[0]", sourceId: "flyt", locale: "en-GB" });
    });
  });

  describe("den lokale valideringen av en pakkefil", () => {
    const feil = (figuren: unknown) => validateExportEnvelopeStructure(konvolutt(figuren)).issues.map((e: { path: string; message: string }) => `${e.path}: ${e.message}`);

    it("kontroll: en figur med et gyldig smalt oppsett er gyldig", () => {
      expect(feil(fullFigur())).toEqual([]);
    });

    it.each<[string, unknown, string]>([
      ["layoutVariants som ikke er en liste", { ...asset(), layoutVariants: "narrow" }, "layoutVariants: must be an array"],
      ["et ukjent oppsett", asset({ layoutVariants: [{ ...smalt(), layout: "diagonal" }] }), "layoutVariants[0].layout: must be one of: narrow"],
      ["samme oppsett to ganger", asset({ layoutVariants: [smalt(), smalt()] }), `layoutVariants[1].layout: layout "narrow" is given twice`],
      ["et oppsett uten innhold", asset({ layoutVariants: [{ layout: "narrow", contentBase64: "" }] }), "layoutVariants[0].contentBase64: required non-empty string"],
      ["en språkvariant uten språk", asset({ layoutVariants: [smalt(NB, { localizedVariants: [{ locale: "", contentBase64: b64(figur(480, NN)) }] })] }), "layoutVariants[0].localizedVariants[0].locale: required non-empty string"],
      ["et rasterbilde med oppsett", asset({ mimeType: "image/png", layoutVariants: [smalt()] }), "layoutVariants: only an image/svg+xml figure can have layout variants"],
    ])("%s avvises", (_navn, figuren, melding) => {
      expect(feil(figuren).join(" | ")).toContain(melding);
    });
  });

  it("bevaringssjekken ser etikettene i det smale oppsettet og i oversettelsene av det", () => {
    // En etikett som BARE står i det smale oppsettets engelske variant, skal være søkbar.
    const figuren = asset({ layoutVariants: [smalt(NB, { localizedVariants: [{ locale: "en-GB", contentBase64: b64(figur(480, ["Bare her", ...EN.slice(1)])) }] })] });
    const elementer = extractPackageElements(pakke(figuren));
    const tekst = JSON.stringify(elementer);
    expect(tekst).toContain("Bare her");
    expect(tekst).toContain("asset:flyt");
  });
});
