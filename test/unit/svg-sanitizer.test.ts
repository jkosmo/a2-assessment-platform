import { describe, it, expect } from "vitest";
import {
  sanitizeSvg,
  svgHasText,
  extractSvgTexts,
  applySvgTextTranslations,
} from "../../src/modules/course/svgSanitizer.js";

// #657: SVG is accepted for section drawings only because it is sanitised server-side. These
// tests pin the XSS-stripping behaviour and the text extract/translate round-trip.

const benignSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">
  <rect x="0" y="0" width="120" height="60" fill="#eef"/>
  <text x="10" y="30">Start</text>
  <text x="10" y="50"><tspan>Neste steg</tspan></text>
</svg>`;

describe("sanitizeSvg — XSS vectors", () => {
  it("strips <script> elements", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).toMatch(/<rect/i);
  });

  it("strips inline event handlers", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" onclick="steal()"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toMatch(/onclick/i);
  });

  it("removes <foreignObject> (HTML/script embedding vector)", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body><img src=x onerror=alert(1)></body></foreignObject></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/foreignObject/i);
    expect(clean).not.toMatch(/onerror/i);
  });

  it("drops javascript: hrefs and <a> links", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text x="1" y="1">x</text></a></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/<a[\s>]/i);
  });

  it("returns empty string when there is no usable <svg>", () => {
    expect(sanitizeSvg("<html><body>not an svg</body></html>")).toBe("");
    expect(sanitizeSvg("")).toBe("");
  });

  it("keeps a valid drawing with its xmlns so it renders via <img>", () => {
    const clean = sanitizeSvg(benignSvg);
    expect(clean).toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i);
    expect(clean).toMatch(/<rect/i);
    expect(clean).toMatch(/Start/);
  });
});

describe("SVG text extraction + translation round-trip", () => {
  it("detects text presence", () => {
    expect(svgHasText(benignSvg)).toBe(true);
    expect(svgHasText(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`)).toBe(false);
  });

  it("extracts text runs in order without duplicates", () => {
    expect(extractSvgTexts(benignSvg)).toEqual(["Start", "Neste steg"]);
  });

  it("applies translations in place and preserves geometry", () => {
    const out = applySvgTextTranslations(benignSvg, { Start: "Begin", "Neste steg": "Next step" });
    expect(out).toMatch(/Begin/);
    expect(out).toMatch(/Next step/);
    expect(out).not.toMatch(/Start/);
    expect(out).not.toMatch(/Neste steg/);
    // Geometry untouched.
    expect(out).toMatch(/x="10" y="30"/);
    expect(out).toMatch(/<rect/i);
  });

  it("re-sanitises on apply so a translation round-trip cannot reintroduce script", () => {
    const out = applySvgTextTranslations(benignSvg, { Start: "Begin" });
    expect(out).not.toMatch(/<script/i);
  });
});
