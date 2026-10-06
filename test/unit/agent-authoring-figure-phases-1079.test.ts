import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFigureMotion } from "../../skills/a2-authoring-api/scripts/figure-motion-check.mjs";
import { checkFigureFit, estimateTextWidth } from "../../skills/a2-authoring-api/scripts/figure-fit-check.mjs";
import { sanitizeSvg } from "../../src/modules/course/svgSanitizer.js";

// #1079: en figur tegnet på nytt fra et lysbilde. Produkteier så originalen og vår versjon side om
// side (2026-10-04) og bestemte to ting som malen ikke tillot: et steg kan være en SIRKEL, og hvert
// steg har FASENS farge. Sjekken sammenligner fortsatt med malen (#1073) — malen har fått én form
// til, ikke et unntak. Derfor er det meste her tilfeller som IKKE er den nye formen.

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 110">${body}</svg>`;

const stilFase = `<style>
  .steg { fill: var(--grunn); stroke: var(--lys); }
  @keyframes lys { 0%, 70% { fill: var(--lys); } 100% { fill: var(--grunn); } }
  .steg { animation: lys 0.9s ease-in-out 1; }
  .s2 { animation-delay: 0.6s; }
  .s3 { animation-delay: 1.2s; }
  .data { --grunn: #d9e8dd; --lys: #6fae87; }
  .bygg { --grunn: #e7e2f0; --lys: #a99bc9; }
  @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
</style>`;
const stilHex = `<style>
  .steg { fill: #eef; stroke: #333; }
  @keyframes lys { 0%, 70% { fill: #ffd166; } 100% { fill: #eef; } }
  .steg { animation: lys 0.9s ease-in-out 1; }
  .s2 { animation-delay: 0.6s; }
  .s3 { animation-delay: 1.2s; }
  @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
</style>`;
const sirkler = (k1 = "steg s1 data", k2 = "steg s2 data", k3 = "steg s3 bygg") => `
  <circle class="${k1}" cx="60" cy="48" r="22"/><text x="60" y="53" text-anchor="middle">1</text>
  <line x1="82" y1="48" x2="158" y2="48" stroke="#889"/>
  <circle class="${k2}" cx="180" cy="48" r="22"/><text x="180" y="53" text-anchor="middle">2</text>
  <line x1="202" y1="48" x2="278" y2="48" stroke="#889"/>
  <circle class="${k3}" cx="300" cy="48" r="22"/><text x="300" y="53" text-anchor="middle">3</text>`;
const bokser = (fase: boolean) => `
  <rect class="steg s1${fase ? " data" : ""}" x="10" y="20" width="120" height="40"/><text x="70" y="45" text-anchor="middle">A</text>
  <line x1="130" y1="40" x2="180" y2="40" stroke="#333"/>
  <rect class="steg s2${fase ? " data" : ""}" x="180" y="20" width="120" height="40"/><text x="240" y="45" text-anchor="middle">B</text>
  <line x1="300" y1="40" x2="350" y2="40" stroke="#333"/>
  <rect class="steg s3${fase ? " bygg" : ""}" x="350" y="20" width="120" height="40"/><text x="410" y="45" text-anchor="middle">C</text>`;
const bareData = () => sirkler("steg s1 data", "steg s2 data", "steg s3 data");

/** The phase template, exactly as figure-design.md publishes it. */
function phaseTemplateFromDoc(): string {
  const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
  const match = doc.split("### flow with phases (animated)")[1]?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!match) throw new Error("phase template not found in figure-design.md");
  return match[1];
}

describe("figure-motion-check — circles as steps, a colour per phase (#1079)", () => {
  it.each([
    ["circles with a colour per phase", stilFase + sirkler()],
    ["boxes with a colour per phase", stilFase + bokser(true)],
    ["circles with one colour for every step", stilHex + sirkler("steg s1", "steg s2", "steg s3")],
    ["boxes with one colour — the template as it was", stilHex + bokser(false)],
  ])("the template: %s", (_navn, figur) => {
    const r = checkFigureMotion(svg(figur));
    expect(r.issues).toEqual([]);
    expect(r.animated).toBe(true);
  });

  it.each<[string, string, string]>([
    ["a step without a phase class", stilFase + sirkler("steg s1", "steg s2 data", "steg s3 bygg"), "exactly one phase class"],
    ["a step with two phase classes", stilFase + sirkler("steg s1 data bygg"), "exactly one phase class"],
    ["a phase rule no step uses", stilFase + bareData(), "match no step"],
    ["a phase class on a label", stilFase + sirkler().replace('<text x="60"', '<text class="data" x="60"'), "belongs on a step only"],
    ["a mix: base rule with variables, keyframes with hex", stilFase.replace("0%, 70% { fill: var(--lys); }", "0%, 70% { fill: #ffd166; }") + sirkler(), "not a mix"],
    ["a mix: hex fill, variable stroke", stilHex.replace("stroke: #333", "stroke: var(--lys)") + sirkler("steg s1", "steg s2", "steg s3"), "not a mix"],
    ["hex colours with phase rules", stilHex.replace("  @media", "  .data { --grunn: #d9e8dd; --lys: #6fae87; }\n  @media") + bareData(), "belong with"],
    ["variables without a phase rule", stilFase.replace(/  \.(data|bygg) \{[^}]*\}\n/g, "") + sirkler("steg s1", "steg s2", "steg s3"), "need at least one phase rule"],
    ["a phase named steg", stilFase.replace(".bygg {", ".steg {") + bareData(), "step classes"],
    ["a phase named s2", stilFase.replace(".bygg {", ".s2 {") + bareData(), "step classes"],
    ["the same phase twice", stilFase.replace(".bygg {", ".data {") + bareData(), "same phase name twice"],
    ["--lys equal to --grunn", stilFase.replace("--lys: #a99bc9", "--lys: #e7e2f0") + sirkler(), "nothing would be seen"],
    ["--lys equal to --grunn, written short and long", stilFase.replace("--grunn: #e7e2f0; --lys: #a99bc9", "--grunn: #EEF; --lys: #eeeeff") + sirkler(), "nothing would be seen"],
    ["a transparent base colour in a phase", stilFase.replace("--grunn: #e7e2f0", "--grunn: #e7e2f000") + sirkler(), "expected"],
    ["a variable as the value in a phase rule", stilFase.replace("--grunn: #e7e2f0", "--grunn: var(--lys)") + sirkler(), "expected"],
    ["one more property in a phase rule", stilFase.replace("--lys: #a99bc9;", "--lys: #a99bc9; opacity: 0;") + sirkler(), "expected"],
    ["a phase rule that sets only one of the two", stilFase.replace("--grunn: #e7e2f0; ", "") + sirkler(), "expected"],
    ["the phase rules before the delay rules", stilFase.replace("  .data { --grunn: #d9e8dd; --lys: #6fae87; }\n", "").replace("  .s2 {", "  .data { --grunn: #d9e8dd; --lys: #6fae87; }\n  .s2 {") + sirkler(), "expected"],
    ["the stroke in the other variable", stilFase.replace("stroke: var(--lys)", "stroke: var(--grunn)") + sirkler(), "expected"],
    ["a fallback value in var()", stilFase.replace("fill: var(--grunn);", "fill: var(--grunn, #000);") + sirkler(), "expected"],
    ["a phase name in capitals", stilFase.replace(".bygg {", ".Bygg {") + sirkler("steg s1 data", "steg s2 data", "steg s3 Bygg"), "expected"],
    ["a circle that is not a step", stilFase + sirkler() + `<circle cx="420" cy="48" r="22" fill="#eee"/>`, "every <rect> and <circle>"],
    ["an ellipse", stilFase + sirkler() + `<ellipse cx="420" cy="48" rx="22" ry="10"/>`, "<ellipse>"],
    ["the step class on a label instead of the circle", stilFase + sirkler().replace('<text x="60"', '<text class="steg s1 data" x="60"').replace('<circle class="steg s1 data"', "<circle"), "steps (<rect> or <circle>) only"],
  ])("not the template: %s", (_navn, figur, melding) => {
    const r = checkFigureMotion(svg(figur));
    expect(r.animated).toBe(false);
    expect(r.issues.map((i) => i.kind)).toContain("unsupported_animation_form");
    expect(r.issues.map((i) => i.detail).join(" | ")).toContain(melding);
  });

  it("a still flow drawn with circles is recognised as a flow, and asked to move or to say it stands still", () => {
    const r = checkFigureMotion(svg(sirkler("a", "b", "c")));
    expect(r.sequence).toBe(true);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
    expect(checkFigureMotion(svg(sirkler("a", "b", "c")).replace("<svg ", '<svg data-motion="static" ')).issues).toEqual([]);
  });

  describe("the phase template in figure-design.md", () => {
    it("passes both checks as published", () => {
      const mal = phaseTemplateFromDoc();
      const r = checkFigureMotion(mal);
      expect(r.issues).toEqual([]);
      expect(r.animated).toBe(true);
      expect(r.totalSeconds).toBeLessThanOrEqual(5);
      expect(checkFigureFit(mal).issues).toEqual([]);
    });

    it("comes back from the platform with its variables, its phase rules and its step classes — and still passes", () => {
      const lagret = sanitizeSvg(phaseTemplateFromDoc());
      expect(lagret).toContain("fill: var(--grunn)");
      expect(lagret).toContain(".fase1 { --grunn: #d9e8dd; --lys: #6fae87; }");
      expect(lagret.match(/<circle class="steg s\d fase\d"/g)).toHaveLength(4);
      expect(checkFigureMotion(lagret).issues).toEqual([]);
      expect(checkFigureFit(lagret).issues).toEqual([]);
    });
  });
});

// Den første figuren som ble tegnet på nytt fra et ekte lysbilde, besto begge sjekkene og hadde
// likevel en forbindelsesstrek rett gjennom en etikett. Det ble bare fanget ved å se på bildet.
// En etikett som står fritt — under en sirkel, ved en strek — har ingen boks å få plass i. Det den
// kan gjøre galt, er å gå inn i naboen eller bli strøket over.
describe("figure-fit-check — labels that stand free (#1079)", () => {
  const figur = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120">${body}</svg>`;
  const typer = (body: string) => [...new Set(checkFigureFit(figur(body)).issues.map((i) => i.kind))];

  it.each<[string, string, string[]]>([
    ["a connector through a label", `<text x="150" y="44" text-anchor="middle" font-size="14">Vurder saken</text><line x1="10" y1="40" x2="290" y2="40" stroke="#333"/>`, ["stroke_through_label"]],
    ["one leg of a polyline through a label", `<text x="150" y="64" text-anchor="middle" font-size="12">og forbedre</text><polyline points="280,20 290,20 290,60 10,60 10,100" fill="none" stroke="#333"/>`, ["stroke_through_label"]],
    ["a slanted line through a label", `<text x="150" y="60" text-anchor="middle" font-size="14">Vurder saken</text><line x1="100" y1="20" x2="200" y2="100" stroke="#333"/>`, ["stroke_through_label"]],
    ["control: a line that only lies under the label", `<text x="150" y="30" text-anchor="middle" font-size="14">Data</text><line x1="100" y1="36" x2="200" y2="36" stroke="#333"/>`, []],
    // Tekstboksen er et anslag. En strek som ligger under én piksel innenfor kanten av anslaget, er
    // en understrek som står tett — ikke en strek gjennom teksten.
    ["control: a line just inside the estimated edge of the label", `<text x="150" y="30" text-anchor="middle" font-size="14">Data</text><line x1="100" y1="33.5" x2="200" y2="33.5" stroke="#333"/>`, []],
    ["control: a line that ends at the edge of the label", `<text x="150" y="44" font-size="14">Vurder</text><line x1="10" y1="40" x2="150" y2="40" stroke="#333"/>`, []],
    ["control: a line that passes beside the label", `<text x="150" y="44" text-anchor="middle" font-size="14">Vurder</text><line x1="20" y1="10" x2="20" y2="110" stroke="#333"/>`, []],
    ["two labels that run into each other", `<text x="100" y="40" text-anchor="middle" font-size="12">Kvalitetssikre</text><text x="150" y="40" text-anchor="middle" font-size="12">og forbedre</text>`, ["labels_overlap"]],
    ["control: two labels side by side", `<text x="70" y="40" text-anchor="middle" font-size="12">Kvalitetssikre</text><text x="220" y="40" text-anchor="middle" font-size="12">og forbedre</text>`, []],
    ["control: two lines of one label, 15 apart at 12px", `<text x="150" y="30" text-anchor="middle" font-size="12">Kvalitetssikre</text><text x="150" y="45" text-anchor="middle" font-size="12">og forbedre</text>`, []],
    ["control: the number in a circle and the label under it", `<circle cx="150" cy="48" r="22"/><text x="150" y="53" text-anchor="middle" font-size="15">1</text><text x="150" y="88" text-anchor="middle" font-size="12">Forstå</text>`, []],
  ])("%s", (_navn, body, forventet) => {
    expect(typer(body)).toEqual(forventet);
  });

  it("two labels that only brush each other are not a collision — the widths are estimates, and a little wide on purpose", () => {
    const bredde = estimateTextWidth("Kvalitetssikre", 12);
    const par = (overlapp: number) => `<text x="10" y="40" font-size="12">Kvalitetssikre</text><text x="${10 + bredde - overlapp}" y="40" font-size="12">og</text>`;
    expect(typer(par(1))).toEqual([]);
    expect(typer(par(6))).toEqual(["labels_overlap"]);
  });

  it("the report names both labels, and the stroke", () => {
    const overlapp = checkFigureFit(figur(`<text x="100" y="40" text-anchor="middle" font-size="12">Kvalitetssikre</text><text x="150" y="40" text-anchor="middle" font-size="12">og forbedre</text>`)).issues[0];
    expect(overlapp?.text).toBe("Kvalitetssikre");
    expect(overlapp?.detail).toContain("«og forbedre»");
    const strek = checkFigureFit(figur(`<text x="150" y="44" text-anchor="middle" font-size="14">Vurder saken</text><line x1="10" y1="40" x2="290" y2="40" stroke="#333"/>`)).issues[0];
    expect(strek?.text).toBe("Vurder saken");
    expect(strek?.detail).toContain("<line> from 10,40 to 290,40");
  });

  // Malen «labelled diagram» sto med en etikett 3 px over toppen av figuren — dokumentet lærte bort en
  // figur skillets egen plassjekk avviser. Ingen test kjørte plassjekken på malene.
  it("every skeleton in figure-design.md passes the fit check — the doc cannot teach a figure the check rejects", () => {
    const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
    const skeletons = [...doc.matchAll(/```svg\r?\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(skeletons.length).toBeGreaterThanOrEqual(5);
    for (const s of skeletons) expect(checkFigureFit(s).issues, s.slice(0, 120)).toEqual([]);
  });
});
