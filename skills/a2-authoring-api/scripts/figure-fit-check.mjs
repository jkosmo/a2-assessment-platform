// #1060: deterministic "does the text fit?" check for the SVG figures the skill draws.
//
// The failure it targets: a label longer than its box. The model writes `<rect width="110">` and a
// label of 22 characters at 14px, and nothing complains — the SVG is valid, the sanitiser is happy,
// the text just spills out of the box (or off the viewBox). The eyes catch it; this catches it
// earlier and for every locale variant, where the Nynorsk/English label is longer than the Bokmål
// one the box was sized for.
//
// What it does: for every <text> (and its <tspan> lines) it ESTIMATES the rendered width from a
// per-character width table for a sans-serif face at the element's font-size, works out the text
// box from x/y/text-anchor, and checks it (a) inside the viewBox and (b) inside the nearest
// enclosing <rect>/<circle>/<ellipse>, with a small padding. It is an estimate — real fonts vary —
// so it is deliberately a little strict (it assumes a slightly wide font). A clean report is not
// proof; it removes the obvious cases before the visual look.
//
// Node stdlib only, pure, repo-testable. Usage:
//   node figure-fit-check.mjs figure.svg [more.svg ...]        exit 1 when anything overflows
//   import { checkFigureFit } from "./figure-fit-check.mjs"     → { ok, issues: [...] }

import { readFileSync } from "node:fs";

const PADDING = 4;
const NARROW = new Set("iljtfI!.,:;'|()[] ".split(""));
const WIDE = new Set("mwMW@%".split(""));
const UPPER = /[A-ZÆØÅ0-9]/;

/** Estimated advance width of one character, in em, for a sans-serif face (slightly wide on purpose). */
function charEm(ch) {
  if (NARROW.has(ch)) return 0.32;
  if (WIDE.has(ch)) return 0.9;
  if (UPPER.test(ch)) return 0.68;
  return 0.58;
}

export function estimateTextWidth(text, fontSize) {
  let em = 0;
  for (const ch of String(text)) em += charEm(ch);
  return em * fontSize;
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
const num = (v, fallback = 0) => {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

function parseViewBox(svg) {
  const m = svg.match(/<svg\b[^>]*>/);
  const a = m ? attrs(m[0]) : {};
  const vb = String(a.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite)) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  const w = num(a.width, NaN), h = num(a.height, NaN);
  return Number.isFinite(w) && Number.isFinite(h) ? { x: 0, y: 0, w, h } : null;
}

function rootFontSize(svg) {
  const m = svg.match(/<svg\b[^>]*>/);
  return m ? num(attrs(m[0])["font-size"], 16) : 16;
}

/** Boxes a label can live in: rects, circles and ellipses, as {x,y,w,h}. */
function containers(svg) {
  const boxes = [];
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const a = attrs(m[0]);
    boxes.push({ kind: "rect", x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height) });
  }
  for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
    const a = attrs(m[0]); const r = num(a.r);
    boxes.push({ kind: "circle", x: num(a.cx) - r, y: num(a.cy) - r, w: 2 * r, h: 2 * r });
  }
  for (const m of svg.matchAll(/<ellipse\b[^>]*>/g)) {
    const a = attrs(m[0]); const rx = num(a.rx), ry = num(a.ry);
    boxes.push({ kind: "ellipse", x: num(a.cx) - rx, y: num(a.cy) - ry, w: 2 * rx, h: 2 * ry });
  }
  return boxes.filter((b) => b.w > 0 && b.h > 0);
}

function textLines(inner) {
  const spans = [...inner.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
  if (spans.length === 0) return [{ text: inner.replace(/<[^>]+>/g, "").trim(), dx: null }];
  return spans.map((s) => ({ text: s[2].replace(/<[^>]+>/g, "").trim(), x: attrs(s[1]).x }));
}

/** @returns {{ ok: boolean, issues: Array<{ text: string, kind: string, detail: string }> }} */
export function checkFigureFit(svg) {
  const issues = [];
  const viewBox = parseViewBox(svg);
  const baseSize = rootFontSize(svg);
  const boxes = containers(svg);

  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = attrs(m[1]);
    const lines = textLines(m[2]).filter((l) => l.text);
    if (lines.length === 0) continue;
    const fontSize = num(a["font-size"], baseSize);
    const anchor = a["text-anchor"] ?? "start";
    const x = num(a.x), y = num(a.y);
    const label = lines.map((l) => l.text).join(" / ");
    const width = Math.max(...lines.map((l) => estimateTextWidth(l.text, fontSize)));
    const height = fontSize * 1.15 * lines.length;
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    const box = { x: left, y: y - fontSize * 0.85, w: width, h: height };

    if (viewBox) {
      const over = [];
      if (box.x < viewBox.x) over.push(`${Math.round(viewBox.x - box.x)}px past the left edge`);
      if (box.x + box.w > viewBox.x + viewBox.w) over.push(`${Math.round(box.x + box.w - viewBox.x - viewBox.w)}px past the right edge`);
      if (box.y < viewBox.y) over.push(`${Math.round(viewBox.y - box.y)}px above the top`);
      if (box.y + box.h > viewBox.y + viewBox.h) over.push(`${Math.round(box.y + box.h - viewBox.y - viewBox.h)}px below the bottom`);
      if (over.length) issues.push({ text: label, kind: "outside_viewbox", detail: over.join(", ") });
    }

    // The container is the shape that contains the anchor point; a label that sits on a line or in
    // free space has none, and is only checked against the viewBox.
    const anchorY = y - fontSize * 0.35;
    const holder = boxes.find((b) => x >= b.x && x <= b.x + b.w && anchorY >= b.y && anchorY <= b.y + b.h);
    if (holder) {
      const over = [];
      if (box.x < holder.x + PADDING) over.push(`${Math.round(holder.x + PADDING - box.x)}px too wide on the left`);
      if (box.x + box.w > holder.x + holder.w - PADDING) over.push(`${Math.round(box.x + box.w - (holder.x + holder.w - PADDING))}px too wide on the right`);
      if (box.y < holder.y + PADDING / 2) over.push("too tall above");
      if (box.y + box.h > holder.y + holder.h - PADDING / 2) over.push("too tall below");
      if (over.length) issues.push({ text: label, kind: `overflows_${holder.kind}`, detail: `${over.join(", ")} (box ${holder.w}×${holder.h}, estimated text ${Math.round(width)}×${Math.round(height)} at ${fontSize}px)` });
    }
  }
  return { ok: issues.length === 0, issues };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node figure-fit-check.mjs figure.svg [more.svg ...]");
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    const { ok, issues } = checkFigureFit(readFileSync(file, "utf8"));
    if (ok) { console.log(`OK   ${file}`); continue; }
    failed = true;
    console.log(`FAIL ${file}`);
    for (const issue of issues) console.log(`  - «${issue.text}»: ${issue.kind} — ${issue.detail}`);
  }
  process.exit(failed ? 1 : 0);
}
