import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreviewHtml, stillFigure } from "../../skills/a2-authoring-api/scripts/figure-preview.mjs";
import { checkFigureFit } from "../../skills/a2-authoring-api/scripts/figure-fit-check.mjs";
import { checkFigureMotion } from "../../skills/a2-authoring-api/scripts/figure-motion-check.mjs";
import { drawFlowFigure } from "../../skills/a2-authoring-api/scripts/draw-flow-figure.mjs";
import { extractSvgTexts } from "../../src/modules/course/svgSanitizer.js";

// Produkteier, fra en ChatGPT-samtale 2026-10-04: «den rendrer ikke svg … vises som tagger».
// Skillet sa «vis SVG-en rendret» uten å si hvordan, og den eneste måten det nevnte for å se på en
// figur, var Playwright «i repoet» — som en samtale i en sandkasse ikke har. Forfatteren ble bedt om
// å godkjenne en figur ingen hadde sett.
//
// `figure-preview.mjs` gjør to ting: en side forfatteren kan åpne, der figurene vises som bilder,
// og en stillestående fil uten stilblokk for tegnere som ikke er nettlesere.

const doc = () => readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
const mal = (overskrift: string) => {
  const treff = doc().split(overskrift)[1]?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!treff) throw new Error(`fant ikke malen ${overskrift}`);
  return treff[1]!;
};
const flyt = () => mal("### flow (animated)");
const fasemal = () => mal("### flow with phases (animated)");
const tegnet = () => drawFlowFigure({
  name: "saksgang",
  title: "Saksgang",
  desc: "Seks steg i tre faser.",
  phases: { a: { label: "Først", grunn: "#d9e8dd", lys: "#6fae87" }, b: { label: "Så", grunn: "#dce7f2", lys: "#7fa3c7" }, c: { label: "Sist", grunn: "#e7e2f0", lys: "#a99bc9" } },
  steps: [
    { label: ["Motta", "saken"], phase: "a" }, { label: ["Sjekk", "vedlegg"], phase: "a" }, { label: ["Vurder", "vilkårene"], phase: "b" },
    { label: ["Drøft"], phase: "b" }, { label: ["Skriv", "vedtaket"], phase: "c" }, { label: ["Arkiver"], phase: "c" },
  ],
});

describe("figure-preview — the figure at rest, for renderers that are not browsers", () => {
  it("a flow with phases: each step gets its phase's resting fill and stroke as attributes, and the style block is gone", () => {
    const still = stillFigure(fasemal());
    expect(still).not.toContain("<style>");
    expect(still).not.toContain("var(");
    expect(still).not.toContain("@keyframes");
    expect(still.match(/<circle [^>]*>/g)).toEqual([
      `<circle class="steg s1 fase1" fill="#d9e8dd" stroke="#6fae87" cx="60" cy="48" r="22"/>`,
      `<circle class="steg s2 fase1" fill="#d9e8dd" stroke="#6fae87" cx="164" cy="48" r="22"/>`,
      `<circle class="steg s3 fase2" fill="#e7e2f0" stroke="#a99bc9" cx="268" cy="48" r="22"/>`,
      `<circle class="steg s4 fase2" fill="#e7e2f0" stroke="#a99bc9" cx="372" cy="48" r="22"/>`,
    ]);
  });

  it("the plain flow: every box gets the one base fill and stroke", () => {
    const still = stillFigure(flyt());
    expect(still).not.toContain("<style>");
    expect(still.match(/<rect [^>]*>/g)?.every((r) => r.includes(`fill="#eef" stroke="#333"`))).toBe(true);
    expect(still.match(/<rect /g)).toHaveLength(3);
  });

  it("nothing else changes: the same labels, the same connectors, the same size", () => {
    for (const figur of [fasemal(), flyt(), tegnet().wide, tegnet().narrow]) {
      const still = stillFigure(figur);
      expect(extractSvgTexts(still)).toEqual(extractSvgTexts(figur));
      expect(still.match(/<(line|polyline)\b[^>]*>/g)).toEqual(figur.match(/<(line|polyline)\b[^>]*>/g));
      expect(/viewBox="[^"]*"/.exec(still)?.[0]).toBe(/viewBox="[^"]*"/.exec(figur)?.[0]);
    }
  });

  it("the still file says what it is — a deliberate still picture — and passes both checks as one", () => {
    const still = stillFigure(tegnet().narrow);
    expect(still).toContain(`data-motion="static"`);
    expect(still).toContain("Preview only");
    const bevegelse = checkFigureMotion(still);
    expect(bevegelse.issues).toEqual([]);
    expect(bevegelse.animated).toBe(false);
    expect(checkFigureFit(still).issues).toEqual([]);
  });

  it("a figure that is not the animated template is returned exactly as it is", () => {
    const stille = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><style>.t { fill: #111; }</style><rect x="1" y="1" width="50" height="20" fill="#eef"/><text class="t" x="5" y="15">Hei</text></svg>`;
    expect(stillFigure(stille)).toBe(stille);
    // En figur som bare LIGNER malen (her: uten regelen for redusert bevegelse) røres heller ikke.
    const nesten = flyt().replace(/\s*@media \(prefers-reduced-motion: reduce\)[^\n]*/, "");
    expect(stillFigure(nesten)).toBe(nesten);
    expect(stillFigure("")).toBe("");
  });
});

describe("figure-preview — the page the author opens", () => {
  const side = () => buildPreviewHtml([{ name: "saksgang.svg", svg: tegnet().wide }, { name: "saksgang.narrow.svg", svg: tegnet().narrow }]);
  const bilder = (html: string) => [...html.matchAll(/<img [^>]*src="data:image\/svg\+xml;base64,([^"]+)"/g)].map((m) => Buffer.from(m[1]!, "base64").toString("utf8"));

  it("shows every figure as an image, in a wide and a phone-width column — the figure itself, unchanged", () => {
    const { wide, narrow } = tegnet();
    expect(bilder(side())).toEqual([wide, wide, narrow, narrow]);
    expect(side().match(/class="wide"/g)).toHaveLength(2);
    expect(side().match(/class="phone"/g)).toHaveLength(2);
  });

  it("is one self-contained file: no script, stylesheet, font or image is fetched from anywhere", () => {
    const html = side();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html.match(/\b(?:src|href)="(?!data:)[^"]*"/g) ?? []).toEqual([]);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("an animated figure gets a replay button and says how long it runs; a still figure gets neither", () => {
    const stille = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect x="1" y="1" width="50" height="20" fill="#eef"/></svg>`;
    const html = buildPreviewHtml([{ name: "flyt.svg", svg: tegnet().wide }, { name: "stille.svg", svg: stille }]);
    expect(html.match(/data-replay="/g)).toHaveLength(1);
    expect(html).toContain(`data-replay="0"`);
    expect(html).toMatch(/animert, ca\. 3\.7 s, går én gang/);
    expect(html).toContain("stillestående");
  });

  it("a file name cannot inject markup into the page", () => {
    const html = buildPreviewHtml([{ name: `"><script>alert(1)</script>.svg`, svg: tegnet().wide }]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  describe("from the command line", () => {
    const kjør = (argumenter: string[]) => spawnSync(process.execPath, ["skills/a2-authoring-api/scripts/figure-preview.mjs", ...argumenter], { encoding: "utf8" });

    it("writes the page where asked, and a still file next to each figure", () => {
      const mappe = mkdtempSync(join(tmpdir(), "figur-"));
      const { wide, narrow } = tegnet();
      writeFileSync(join(mappe, "saksgang.svg"), wide, "utf8");
      writeFileSync(join(mappe, "saksgang.narrow.svg"), narrow, "utf8");
      const kjøring = kjør([join(mappe, "saksgang.svg"), join(mappe, "saksgang.narrow.svg"), "--out", join(mappe, "se.html")]);
      expect(kjøring.status, kjøring.stderr).toBe(0);
      expect(readdirSync(mappe).sort()).toEqual(["saksgang.narrow.still.svg", "saksgang.narrow.svg", "saksgang.still.svg", "saksgang.svg", "se.html"]);
      expect(readFileSync(join(mappe, "saksgang.still.svg"), "utf8")).toBe(stillFigure(wide));
      expect(bilder(readFileSync(join(mappe, "se.html"), "utf8"))).toEqual([wide, wide, narrow, narrow]);
      // Figurene selv er urørt.
      expect(readFileSync(join(mappe, "saksgang.svg"), "utf8")).toBe(wide);
    });

    it("without --out the page lands next to the first figure", () => {
      const mappe = mkdtempSync(join(tmpdir(), "figur-"));
      writeFileSync(join(mappe, "a.svg"), tegnet().wide, "utf8");
      expect(kjør([join(mappe, "a.svg")]).status).toBe(0);
      expect(readdirSync(mappe)).toContain("figure-preview.html");
    });

    it("without a figure it prints how it is used and exits 2", () => {
      const kjøring = kjør([]);
      expect(kjøring.status).toBe(2);
      expect(kjøring.stderr).toContain("usage:");
    });
  });
});

describe("figure-design.md — how a figure is shown and looked at", () => {
  it("names the preview script, forbids pasting SVG source, and says what to do with no renderer", () => {
    const tekst = doc();
    expect(tekst).toContain("figure-preview.mjs");
    expect(tekst).toContain("Never show a figure by pasting its SVG source into the chat");
    expect(tekst).toContain("figure.still.svg");
    expect(tekst).toContain("you cannot do the look step");
    // Playwright nevnes fortsatt, men bare som veien der repoet finnes.
    expect(tekst).not.toContain("Playwright is in the repo:");
  });
});
