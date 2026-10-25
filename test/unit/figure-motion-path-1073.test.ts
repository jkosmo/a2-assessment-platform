import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkFigureMotion } from "../../skills/a2-authoring-api/scripts/figure-motion-check.mjs";
import { checkFigureFit } from "../../skills/a2-authoring-api/scripts/figure-fit-check.mjs";
import { sanitizeSvg, svgMotionProblems } from "../../src/modules/course/svgSanitizer.js";

// #1073, den andre malen: en sti som tegnes fra start til slutt, én gang.
//
// Samme prinsipp som flyten: figuren ER malen, sammenlignet, ikke tolket. Det som måles her, er at
// malen slipper gjennom — før og etter plattformens rensing — og at hver vei rundt den stoppes:
// en annen lengde, en klasse på feil element, en regel til, en forsinkelse, en løkke.

function fromDoc(): string {
  const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
  const match = doc.split("### path drawn (animated)")[1]?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!match) throw new Error("the drawn path template is not in figure-design.md");
  return match[1];
}

const TEMPLATE = fromDoc();
const kinds = (figure: string) => checkFigureMotion(figure).issues.map((issue) => issue.kind);
const details = (figure: string) => checkFigureMotion(figure).issues.map((issue) => issue.detail).join(" | ");
const swap = (from: string, to: string) => {
  expect(TEMPLATE).toContain(from);
  return TEMPLATE.replace(from, to);
};

describe("the drawn path template (#1073)", () => {
  it("passes the motion check and the fit check, and still passes after the platform's sanitizer", () => {
    expect(checkFigureMotion(TEMPLATE)).toMatchObject({ ok: true, animated: true, totalSeconds: 2.5 });
    expect(checkFigureFit(TEMPLATE).issues).toEqual([]);
    const clean = sanitizeSvg(TEMPLATE);
    expect(clean).toContain('pathLength="1"');
    expect(checkFigureMotion(clean).ok).toBe(true);
    expect(svgMotionProblems(clean)).toEqual([]);
  });

  it("control: what may differ — colour, stroke width, duration, more paths, still shapes around them", () => {
    let figure = swap("stroke: #2a6f97; stroke-width: 3;", "stroke: #c33; stroke-width: 1.5;");
    figure = figure.replace("tegn 2.5s", "tegn 4s");
    figure = figure.replace("</svg>", '<path class="sti" pathLength="1" d="M30 30 L 370 30"/><rect x="5" y="5" width="20" height="20" fill="#eee"/><path d="M10 100 L 390 100" fill="none" stroke="#999"/></svg>');
    expect(checkFigureMotion(figure)).toMatchObject({ ok: true, animated: true, totalSeconds: 4 });
  });

  it("a path without pathLength, or with another length, has gaps at rest — refused", () => {
    expect(kinds(swap(' pathLength="1"', ""))).toContain("unsupported_animation_form");
    expect(details(swap('pathLength="1"', 'pathLength="2"'))).toContain('pathLength="1"');
    expect(kinds(swap('pathLength="1"', 'pathLength="0.5"'))).toContain("unsupported_animation_form");
  });

  it("the class belongs on a <path>, alone", () => {
    const onLine = TEMPLATE.replace("</svg>", '<line class="sti" x1="0" y1="0" x2="10" y2="10" stroke="#000"/></svg>');
    expect(details(onLine)).toContain('class "sti" belongs on a <path> only');
    expect(details(swap('class="sti"', 'class="sti s2"'))).toContain('no other class');
    expect(details(swap('class="sti"', 'class="rute"'))).toContain("at least one");
  });

  it("the style block is the template's: a loop, a delay, another rule, a missing reduced-motion rule are refused", () => {
    expect(kinds(swap("tegn 2.5s ease-in-out 1;", "tegn 2.5s ease-in-out infinite;"))).toContain("unsupported_animation_form");
    expect(kinds(swap("@media", ".sti { animation-delay: 1s; } @media"))).toContain("unsupported_animation_form");
    expect(kinds(swap("@media (prefers-reduced-motion: reduce) { .sti { animation: none; } }", ""))).toContain("unsupported_animation_form");
    expect(kinds(swap("stroke-dashoffset: 0; }", "stroke-dashoffset: 0.5; }"))).toContain("unsupported_animation_form");
    expect(kinds(swap("0% { stroke-dashoffset: 1; }", "0% { stroke-dashoffset: -1; }"))).toContain("unsupported_animation_form");
    expect(kinds(swap("</style>", "circle { animation: tegn 1s ease-in-out 1; }</style>"))).toContain("unsupported_animation_form");
    expect(kinds(swap("fill: none;", "fill: #000;"))).toContain("unsupported_animation_form");
  });

  it("longer than 5 seconds, or too short to be seen", () => {
    expect(kinds(swap("tegn 2.5s", "tegn 6s"))).toContain("too_long");
    expect(details(swap("tegn 2.5s", "tegn 0.1s"))).toContain("at least 0.3s");
    expect(details(swap("stroke-width: 3;", "stroke-width: 0;"))).toContain("larger than 0");
  });

  it("the markup rules of an animated figure hold here too: style attribute, transform, <style media>, foreign elements", () => {
    expect(kinds(swap('<path class="sti"', '<path style="animation-duration: 9s" class="sti"'))).toContain("unsupported_animation_form");
    expect(kinds(swap('<path class="sti"', '<path transform="scale(2)" class="sti"'))).toContain("unsupported_animation_form");
    expect(kinds(swap("<style>", '<style media="print">'))).toContain("unsupported_animation_form");
    expect(kinds(TEMPLATE.replace("</svg>", '<g><rect x="1" y="1" width="2" height="2"/></g></svg>'))).toContain("unsupported_animation_form");
    expect(kinds(swap("<style>", "<style>/* note */"))).toContain("unsupported_animation_form");
  });

  it("a drawn path switched off at rest is missing from the still picture", () => {
    expect(kinds(swap('<path class="sti"', '<path stroke-opacity="0" class="sti"'))).toContain("hidden_at_rest");
    expect(kinds(swap('<path class="sti"', '<path visibility="hidden" class="sti"'))).toContain("hidden_at_rest");
  });

  it("control: the flow template is unchanged by the second one", () => {
    const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
    const flow = doc.split("### flow (animated)")[1]!.match(/```svg\r?\n([\s\S]*?)```/)![1];
    expect(checkFigureMotion(flow)).toMatchObject({ ok: true, animated: true });
    // A flow that borrows the path's keyframes is neither template.
    expect(kinds(flow.replace("@keyframes lys", "@keyframes tegn"))).toContain("unsupported_animation_form");
  });
});
