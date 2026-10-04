import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkFigureMotion } from "../../skills/a2-authoring-api/scripts/figure-motion-check.mjs";
import { checkFigureFit } from "../../skills/a2-authoring-api/scripts/figure-fit-check.mjs";
import { sanitizeSvg } from "../../src/modules/course/svgSanitizer.js";

// #1073: figurer som viser et forløp skal animeres — og animasjonen skal tåle plattformen og være
// trygg uten at leserens «redusert bevegelse» når inn i et <img>.

const svg = (body: string, rootAttrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 80" role="img" font-family="system-ui, sans-serif"${rootAttrs}>${body}</svg>`;

const threeSteps = `
  <rect class="steg s1" x="10" y="20" width="120" height="40" rx="6"/>
  <text x="70" y="45" text-anchor="middle" font-size="14">Motta sak</text>
  <line x1="130" y1="40" x2="180" y2="40" stroke="#333"/>
  <rect class="steg s2" x="180" y="20" width="120" height="40" rx="6"/>
  <text x="240" y="45" text-anchor="middle" font-size="14">Vurder</text>
  <line x1="300" y1="40" x2="350" y2="40" stroke="#333"/>
  <rect class="steg s3" x="350" y="20" width="120" height="40" rx="6"/>
  <text x="410" y="45" text-anchor="middle" font-size="14">Fatt vedtak</text>`;

const goodStyle = `<style>
  .steg { fill: #eef; stroke: #333; }
  @keyframes lys { 0%, 70% { fill: #ffd166; } 100% { fill: #eef; } }
  .steg { animation: lys 1.4s ease-in-out 1; }
  .s2 { animation-delay: 1.2s; }
  .s3 { animation-delay: 2.4s; }
  @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
</style>`;

/** The animated flow template, exactly as figure-design.md publishes it. */
function templateFromDoc(): string {
  const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
  const section = doc.split("### flow (animated)")[1];
  const match = section?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!match) throw new Error("animated flow template not found in figure-design.md");
  return match[1];
}

describe("figure-motion-check (#1073)", () => {
  it("a short, once-only animated flow with a reduced-motion rule passes", () => {
    const r = checkFigureMotion(svg(goodStyle + threeSteps));
    expect(r.animated).toBe(true);
    expect(r.sequence).toBe(true);
    expect(r.totalSeconds).toBeCloseTo(3.8, 5);
    expect(r.issues).toEqual([]);
  });

  it("the same flow drawn still is flagged — the rule that would otherwise have to be remembered", () => {
    const r = checkFigureMotion(svg(threeSteps));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
  });

  it("an explicit data-motion=\"static\" is the visible exception for a still flow", () => {
    expect(checkFigureMotion(svg(threeSteps, ' data-motion="static"')).ok).toBe(true);
  });

  it("control: a figure that is not a sequence is fine without animation", () => {
    const tree = `<rect x="150" y="10" width="100" height="40"/><text x="200" y="35">Spørsmål</text>
      <line x1="180" y1="50" x2="90" y2="140"/><line x1="220" y1="50" x2="310" y2="140"/>
      <rect x="30" y="140" width="120" height="40"/><text x="90" y="165">Ja</text>
      <rect x="250" y="140" width="120" height="40"/><text x="310" y="165">Nei</text>`;
    const r = checkFigureMotion(svg(tree));
    expect(r.sequence).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("an endless loop fails", () => {
    const r = checkFigureMotion(svg(goodStyle.replace("ease-in-out 1;", "ease-in-out infinite;") + threeSteps));
    expect(r.issues.map((i) => i.kind)).toContain("infinite_loop");
  });

  it("an animation longer than 5 seconds fails, and the report says how long", () => {
    const r = checkFigureMotion(svg(goodStyle.replace("lys 1.4s ease-in-out 1", "lys 6s ease-in-out 3") + threeSteps));
    const issue = r.issues.find((i) => i.kind === "too_long");
    expect(issue?.detail).toContain("20.4s");
  });

  it("a missing reduced-motion rule fails", () => {
    const r = checkFigureMotion(svg(goodStyle.replace(/@media[^\n]*\n/, "") + threeSteps));
    expect(r.issues.map((i) => i.kind)).toEqual(["no_reduced_motion_rule"]);
  });

  it("content hidden in the base style fails — the still picture must be complete", () => {
    const r = checkFigureMotion(svg(goodStyle.replace(".steg { fill: #eef;", ".steg { opacity: 0; fill: #eef;") + threeSteps));
    expect(r.issues.map((i) => i.kind)).toContain("hidden_at_rest");
  });

  it("a forwards fill that ends hidden fails", () => {
    const style = goodStyle
      .replace("@keyframes lys { 0%, 70% { fill: #ffd166; } 100% { fill: #eef; } }", "@keyframes lys { 0% { opacity: 1; } 100% { opacity: 0; } }")
      .replace("ease-in-out 1;", "ease-in-out 1 forwards;");
    expect(checkFigureMotion(svg(style + threeSteps)).issues.map((i) => i.kind)).toContain("ends_hidden");
  });

  it("SMIL the platform strips is reported, even when CSS also animates", () => {
    const r = checkFigureMotion(svg(goodStyle + threeSteps.replace('rx="6"/>', 'rx="6"><animate attributeName="opacity" values="0;1" dur="1s"/></rect>')));
    expect(r.issues.map((i) => i.kind)).toContain("stripped_by_platform");
  });

  // Funnet av QA-porten 2026-10-04: sjekken godkjente figurer som brøt reglene den skal håndheve.
  // Hver test under har en figur som SER animert ut for en regex, men ikke er trygg eller ikke rører seg.

  it("an animation that cannot run is not an animation: no duration, or a name without keyframes", () => {
    const utenVarighet = goodStyle.replace(".steg { animation: lys 1.4s ease-in-out 1; }", ".steg { animation-name: lys; }");
    const r1 = checkFigureMotion(svg(utenVarighet + threeSteps));
    expect(r1.animated).toBe(false);
    expect(r1.issues.map((i) => i.kind)).toEqual(["animation_never_runs", "sequence_not_animated"]);

    const feilNavn = goodStyle.replace("animation: lys 1.4s", "animation: lyss 1.4s");
    const r2 = checkFigureMotion(svg(feilNavn + threeSteps));
    expect(r2.animated).toBe(false);
    expect(r2.issues.map((i) => i.kind)).toEqual(["animation_never_runs", "sequence_not_animated"]);
  });

  it("control: animation-name with its own animation-duration runs", () => {
    const langform = goodStyle.replace(".steg { animation: lys 1.4s ease-in-out 1; }", ".steg { animation-name: lys; animation-duration: 1.4s; }");
    const r = checkFigureMotion(svg(langform + threeSteps));
    expect(r.animated).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("a short animation that repeats fails — «once» is the rule, not «within 5 seconds»", () => {
    const tre = goodStyle.replace("lys 1.4s ease-in-out 1;", "lys 0.5s ease-in-out 3;").replace("1.2s", "0.2s").replace("2.4s", "0.4s");
    const r = checkFigureMotion(svg(tre + threeSteps));
    expect(r.totalSeconds).toBeLessThan(5);
    expect(r.issues.map((i) => i.kind)).toEqual(["repeats"]);

    const langform = goodStyle.replace("ease-in-out 1; }", "ease-in-out; animation-iteration-count: 2; }").replace("1.2s", "0.2s").replace("2.4s", "0.4s");
    expect(checkFigureMotion(svg(langform + threeSteps)).issues.map((i) => i.kind)).toEqual(["repeats"]);
  });

  it("a reduced-motion rule that names something else does not count", () => {
    const urelatert = goodStyle.replace("{ .steg { animation: none; } }", "{ .annet { animation: none; } }");
    const r = checkFigureMotion(svg(urelatert + threeSteps));
    expect(r.issues.map((i) => i.kind)).toEqual(["no_reduced_motion_rule"]);
    expect(r.issues[0].detail).toContain(".steg");
  });

  it("control: a universal reduced-motion rule covers every animated selector", () => {
    const universell = goodStyle.replace("{ .steg { animation: none; } }", "{ * { animation: none !important; } }");
    expect(checkFigureMotion(svg(universell + threeSteps)).issues).toEqual([]);
  });

  it("an inline style animation is only covered by a universal !important rule", () => {
    const inline = threeSteps.replace('class="steg s1"', 'class="s1" style="animation: lys 1s 1"');
    // .steg-regelen i goodStyle dekker ikke en style=""-attributt: den vinner over stilarket.
    expect(checkFigureMotion(svg(goodStyle + inline)).issues.map((i) => i.kind)).toEqual(["no_reduced_motion_rule"]);
    // En universell regel uten !important taper også mot attributten.
    const utenImportant = goodStyle.replace("{ .steg { animation: none; } }", "{ * { animation: none; } }");
    expect(checkFigureMotion(svg(utenImportant + inline)).issues.map((i) => i.kind)).toEqual(["no_reduced_motion_rule"]);
    const universell = goodStyle.replace("{ .steg { animation: none; } }", "{ * { animation: none !important; } }");
    expect(checkFigureMotion(svg(universell + inline)).issues).toEqual([]);
  });

  it("display: none hides content at rest too — in CSS and as an attribute", () => {
    const css = goodStyle.replace(".s3 { animation-delay: 2.4s; }", ".s3 { animation-delay: 2.4s; display: none; }");
    expect(checkFigureMotion(svg(css + threeSteps)).issues.map((i) => i.kind)).toEqual(["hidden_at_rest"]);
    const attributt = threeSteps.replace('<rect class="steg s3"', '<rect display="none" class="steg s3"');
    expect(checkFigureMotion(svg(goodStyle + attributt)).issues.map((i) => i.kind)).toEqual(["hidden_at_rest"]);
  });

  it("single-quoted attributes are read: a still flow written with ' is still a flow", () => {
    const enkle = threeSteps.replace(/"/g, "'");
    const r = checkFigureMotion(svg(enkle));
    expect(r.sequence).toBe(true);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
    // …og unntaket leses også med enkle anførselstegn.
    expect(checkFigureMotion(svg(enkle, " data-motion='static'")).ok).toBe(true);
  });
});

// Funnet av QA-porten 2026-10-04, andre pass: flytgjenkjenningen telte bokser og streker hver for seg.
// Det som gjør en figur til en flyt er at strekene FORBINDER boksene, i rekkefølge.
describe("what counts as a flow (#1073)", () => {
  const boks = (x: number, y: number, etikett: string) =>
    `<rect x="${x}" y="${y}" width="120" height="40"/><text x="${x + 60}" y="${y + 25}">${etikett}</text>`;
  const treIRad = boks(10, 20, "Motta sak") + boks(180, 20, "Vurder") + boks(350, 20, "Fatt vedtak");

  it("a flow joined by plain <path>s is a flow — no marker-end needed", () => {
    const r = checkFigureMotion(svg(`${treIRad}<path d="M130 40 H180"/><path d="M300 40 H350"/>`));
    expect(r.sequence).toBe(true);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
  });

  it("relative path commands and polylines join boxes too", () => {
    expect(checkFigureMotion(svg(`${treIRad}<path d="m130 40 l50 0"/><polyline points="300,40 325,40 350,40"/>`)).sequence).toBe(true);
  });

  it("a column of joined boxes is a flow as well", () => {
    const kolonne = boks(10, 10, "Først") + boks(10, 100, "Så") + boks(10, 190, "Til slutt");
    const r = checkFigureMotion(svg(`${kolonne}<line x1="70" y1="50" x2="70" y2="100"/><line x1="70" y1="140" x2="70" y2="190"/>`));
    expect(r.sequence).toBe(true);
  });

  it("control: a hierarchy — one parent, three aligned children — is not a flow", () => {
    const tre = boks(180, 10, "Ledelse") + boks(10, 140, "Salg") + boks(180, 140, "Drift") + boks(350, 140, "HR")
      + `<line x1="240" y1="50" x2="70" y2="140"/><line x1="240" y1="50" x2="240" y2="140"/><line x1="240" y1="50" x2="410" y2="140"/>`;
    const r = checkFigureMotion(svg(tre));
    expect(r.sequence).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("control: the same hierarchy drawn as ONE path with three subpaths is still not a flow", () => {
    const tre = boks(180, 10, "Ledelse") + boks(10, 140, "Salg") + boks(180, 140, "Drift") + boks(350, 140, "HR")
      + `<path d="M240 50 L70 140 M240 50 L240 140 M240 50 L410 140"/>`;
    expect(checkFigureMotion(svg(tre)).sequence).toBe(false);
  });

  it("control: three boxes in a row with lines that join nothing are not a flow", () => {
    const r = checkFigureMotion(svg(`${treIRad}<line x1="10" y1="75" x2="470" y2="75"/><line x1="10" y1="78" x2="470" y2="78"/>`));
    expect(r.sequence).toBe(false);
  });

  it("control: only the first two boxes joined — a pair, not a sequence", () => {
    expect(checkFigureMotion(svg(`${treIRad}<line x1="130" y1="40" x2="180" y2="40"/><line x1="10" y1="75" x2="100" y2="75"/>`)).sequence).toBe(false);
  });

  it("<animateMotion> is rejected: it survives the sanitizer, but CSS cannot switch it off", () => {
    const medSmil = goodStyle + threeSteps + `<circle r="4"><animateMotion dur="1s" repeatCount="1" path="M0,0 L100,0"/></circle>`;
    expect(checkFigureMotion(svg(medSmil)).issues.map((i) => i.kind)).toEqual(["not_css_only"]);
    // …og den teller ikke som animasjon: en flyt som BARE har den, er fortsatt stillestående.
    const bare = threeSteps + `<circle r="4"><animateMotion dur="1s" path="M0,0 L100,0"/></circle>`;
    const r = checkFigureMotion(svg(bare));
    expect(r.animated).toBe(false);
    expect(r.issues.map((i) => i.kind)).toEqual(["not_css_only", "sequence_not_animated"]);
  });
});

describe("the measured platform facts the rule rests on (#1073)", () => {
  it("sanitizeSvg keeps CSS keyframes, animation and the reduced-motion rule", () => {
    const clean = sanitizeSvg(svg(goodStyle + threeSteps));
    expect(clean).toContain("@keyframes lys");
    expect(clean).toContain("animation: lys 1.4s");
    expect(clean).toContain("prefers-reduced-motion");
    expect(checkFigureMotion(clean).ok).toBe(true);
  });

  it("sanitizeSvg strips <animate> and <set> — which is why the check rejects them", () => {
    const clean = sanitizeSvg(svg(`<circle r="5"><animate attributeName="r" values="5;10" dur="1s"/></circle><g><set attributeName="opacity" to="0"/></g>`));
    expect(clean).not.toContain("<animate ");
    expect(clean).not.toContain("<set");
  });
});

describe("the animated flow template in figure-design.md (#1073)", () => {
  it("passes the motion check, the fit check, and survives the sanitizer unchanged in substance", () => {
    const template = templateFromDoc();
    expect(checkFigureMotion(template)).toMatchObject({ ok: true, animated: true, sequence: true });
    expect(checkFigureFit(template).issues).toEqual([]);
    const clean = sanitizeSvg(template);
    expect(checkFigureMotion(clean).ok).toBe(true);
  });

  it("every skeleton in figure-design.md passes the motion check — the doc cannot teach a still flow", () => {
    const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
    const skeletons = [...doc.matchAll(/```svg\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
    for (const s of skeletons) expect(checkFigureMotion(s).issues).toEqual([]);
  });
});
