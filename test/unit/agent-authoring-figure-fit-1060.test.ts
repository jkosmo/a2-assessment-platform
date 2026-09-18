import { describe, expect, it } from "vitest";
import { checkFigureFit, estimateTextWidth } from "../../skills/a2-authoring-api/scripts/figure-fit-check.mjs";

// #1060: tekst som ikke får plass i boksen sin — fanget deterministisk før øynene ser på bildet.

const svg = (body: string, viewBox = "0 0 420 120") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" font-family="system-ui, sans-serif">${body}</svg>`;

describe("figure-fit-check (#1060)", () => {
  it("a short label centred in a wide box passes", () => {
    const r = checkFigureFit(svg(`<rect x="10" y="40" width="110" height="40"/><text x="65" y="65" text-anchor="middle" font-size="14">Start</text>`));
    expect(r.ok).toBe(true);
  });

  it("a long label in the same box overflows on both sides, and the report says by how much", () => {
    const r = checkFigureFit(svg(`<rect x="10" y="40" width="110" height="40"/><text x="65" y="65" text-anchor="middle" font-size="14">Behandlingsgrunnlag vurderes</text>`));
    expect(r.ok).toBe(false);
    const boxIssue = r.issues.find((i) => i.kind === "overflows_rect");
    expect(boxIssue).toBeTruthy();
    expect(boxIssue!.detail).toMatch(/too wide on the (left|right)/);
    expect(boxIssue!.text).toBe("Behandlingsgrunnlag vurderes");
  });

  it("the Nynorsk variant can overflow where the Bokmål one fit — that is the case the step exists for", () => {
    const box = `<rect x="10" y="40" width="96" height="40"/>`;
    const nb = checkFigureFit(svg(`${box}<text x="58" y="65" text-anchor="middle" font-size="13">Sjekk kilde</text>`));
    const nn = checkFigureFit(svg(`${box}<text x="58" y="65" text-anchor="middle" font-size="13">Kontroller kjeldegrunnlaget</text>`));
    expect(nb.ok).toBe(true);
    expect(nn.ok).toBe(false);
  });

  it("a label outside the viewBox is reported even with no box around it", () => {
    const r = checkFigureFit(svg(`<text x="400" y="60" font-size="14">Lang etikett som går ut</text>`));
    expect(r.ok).toBe(false);
    expect(r.issues[0].kind).toBe("outside_viewbox");
    expect(r.issues[0].detail).toContain("right edge");
  });

  it("a label on a line (no container) that stays inside the viewBox passes", () => {
    const r = checkFigureFit(svg(`<line x1="120" y1="60" x2="170" y2="60"/><text x="145" y="52" text-anchor="middle" font-size="12">ja</text>`));
    expect(r.ok).toBe(true);
  });

  it("tspan lines are measured line by line; circles and ellipses count as containers", () => {
    const ok = checkFigureFit(svg(`<circle cx="160" cy="100" r="70"/><text x="160" y="95" text-anchor="middle" font-size="13"><tspan x="160">Del</tspan><tspan x="160" dy="16">én</tspan></text>`, "0 0 320 200"));
    expect(ok.ok).toBe(true);
    const bad = checkFigureFit(svg(`<circle cx="160" cy="100" r="30"/><text x="160" y="100" text-anchor="middle" font-size="13">Alt for lang tekst her</text>`, "0 0 320 200"));
    expect(bad.ok).toBe(false);
    expect(bad.issues[0].kind).toBe("overflows_circle");
  });

  it("the width estimate grows with the text and with the font size", () => {
    expect(estimateTextWidth("Start", 14)).toBeLessThan(estimateTextWidth("Start på nytt", 14));
    expect(estimateTextWidth("Start", 14)).toBeLessThan(estimateTextWidth("Start", 20));
  });
});
