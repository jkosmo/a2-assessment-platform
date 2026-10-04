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
