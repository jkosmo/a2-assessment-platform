// #1073: deterministic "animate where it makes sense — and safely" check for the skill's SVG figures.
//
// Two failures it targets:
//
// 1. A figure that shows something happening over time (a process, steps in order) drawn as a still
//    picture because nobody remembered that it could move. The rule lives in figure-design.md; a rule
//    one has to remember has already failed, so this finds flow-shaped figures and asks for either an
//    animation or an explicit, visible exception: `data-motion="static"` on the root <svg>.
//
// 2. An animation that is unsafe or does not survive the platform. Measured 2026-10-03:
//    - A2's sanitizeSvg keeps CSS (@keyframes + animation in <style>) and <animateMotion>, but strips
//      <animate> and <set>, and strips from/to on <animateTransform> — those silently stop working.
//    - The participant view shows figures as <img>. Chromium does NOT apply the reader's
//      `prefers-reduced-motion` inside an SVG shown as an image (it does when the SVG is a document).
//      So the media rule is kept as a bonus, but the animation must be safe without it: run once,
//      finish within 5 seconds (WCAG 2.2.2 — moving content that lasts longer needs a pause control,
//      and an <img> has none), and come to rest in a complete picture.
//
// Estimate, not proof: the total running time is computed conservatively (largest delay + largest
// duration × largest iteration count across all rules). A clean report removes the mechanical cases;
// whether the motion teaches anything is still the author's call at the per-element gate.
//
// Node stdlib only, pure, repo-testable. Usage:
//   node figure-motion-check.mjs figure.svg [more.svg ...]     exit 1 when anything fails
//   import { checkFigureMotion } from "./figure-motion-check.mjs"   → { ok, animated, sequence, issues }

import { readFileSync } from "node:fs";

export const MAX_TOTAL_SECONDS = 5;
const ALIGN_TOLERANCE = 8;

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
const num = (v, fallback = 0) => {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

function styleText(svg) {
  const blocks = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const inline = [...svg.matchAll(/\bstyle\s*=\s*"([^"]*)"/g)].map((m) => `x{${m[1]}}`);
  return [...blocks, ...inline].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Removes every `@<name> … { … }` block (with nested braces), returning the rest and the blocks. */
function splitAtBlocks(css, name) {
  const blocks = [];
  let rest = "";
  let i = 0;
  const re = new RegExp(`@${name}\\b`, "g");
  let m;
  while ((m = re.exec(css))) {
    const open = css.indexOf("{", m.index);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    rest += css.slice(i, m.index);
    blocks.push(css.slice(m.index, j));
    i = j;
    re.lastIndex = j;
  }
  return { rest: rest + css.slice(i), blocks };
}

function declarations(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    for (const decl of m[2].split(";")) {
      const idx = decl.indexOf(":");
      if (idx < 0) continue;
      out.push({ selector: m[1].trim(), prop: decl.slice(0, idx).trim().toLowerCase(), value: decl.slice(idx + 1).trim().toLowerCase() });
    }
  }
  return out;
}

const seconds = (token) => {
  const m = String(token).match(/^(-?[\d.]+)(ms|s)$/);
  if (!m) return null;
  return m[2] === "ms" ? Number(m[1]) / 1000 : Number(m[1]);
};

/** Flow-shaped: ≥3 labelled boxes in a row (or a column) with ≥2 connectors between them. */
function looksLikeSequence(svg) {
  const boxes = [];
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const b = { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height) };
    if (b.w > 0 && b.h > 0) boxes.push(b);
  }
  const texts = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .filter((m) => m[2].replace(/<[^>]+>/g, "").trim())
    .map((m) => ({ x: num(attrs(m[1]).x), y: num(attrs(m[1]).y) }));
  const labelled = boxes.filter((b) => texts.some((t) => t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h));
  const connectors = (svg.match(/<(line|polyline|polygon)\b/g) ?? []).length
    + (svg.match(/<path\b[^>]*marker-end/g) ?? []).length;
  if (labelled.length < 3 || connectors < 2) return false;
  const centres = labelled.map((b) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 }));
  const aligned = (key) => centres.some((a) => centres.filter((b) => Math.abs(a[key] - b[key]) <= ALIGN_TOLERANCE).length >= 3);
  return aligned("cy") || aligned("cx");
}

/** @returns {{ ok: boolean, animated: boolean, sequence: boolean, totalSeconds: number | null, issues: Array<{ kind: string, detail: string }> }} */
export function checkFigureMotion(svg) {
  const issues = [];
  const root = attrs((svg.match(/<svg\b[^>]*>/) ?? [""])[0]);
  const declaredStatic = root["data-motion"] === "static";

  const css = styleText(svg);
  const { rest: noKeyframes, blocks: keyframes } = splitAtBlocks(css, "keyframes");
  const { rest: base, blocks: media } = splitAtBlocks(noKeyframes, "media");
  const decls = declarations(base);
  const animDecls = decls.filter((d) => d.prop === "animation" || d.prop.startsWith("animation-"));
  const usesCss = animDecls.some((d) => (d.prop === "animation" || d.prop === "animation-name") && d.value !== "none");
  const usesMotionPath = /<animateMotion\b/.test(svg);
  const animated = usesCss || usesMotionPath;
  const sequence = looksLikeSequence(svg);

  for (const tag of ["animate", "set", "animateTransform"]) {
    if (new RegExp(`<${tag}\\b`).test(svg)) {
      issues.push({ kind: "stripped_by_platform", detail: `<${tag}> is removed (or disabled) by A2's sanitizer — use CSS @keyframes instead` });
    }
  }

  if (sequence && !animated && !declaredStatic) {
    issues.push({ kind: "sequence_not_animated", detail: "flow-shaped figure (≥3 boxes in order) with no animation — animate the order, or mark the root <svg data-motion=\"static\"> if a still picture is the deliberate choice" });
  }

  let totalSeconds = null;
  if (animated) {
    let maxDuration = 0, maxDelay = 0, maxCount = 1;
    for (const d of animDecls) {
      if (d.value.includes("infinite")) {
        issues.push({ kind: "infinite_loop", detail: `"${d.prop}: ${d.value}" never stops — run once (an <img> offers no pause control)` });
        maxCount = Infinity;
      }
      if (d.prop === "animation") {
        const times = d.value.split(/\s+/).map(seconds).filter((s) => s !== null);
        if (times[0] !== undefined) maxDuration = Math.max(maxDuration, times[0]);
        if (times[1] !== undefined) maxDelay = Math.max(maxDelay, times[1]);
        for (const t of d.value.split(/\s+/)) if (/^\d+(\.\d+)?$/.test(t)) maxCount = Math.max(maxCount, Number(t));
      } else if (d.prop === "animation-duration") {
        maxDuration = Math.max(maxDuration, ...d.value.split(",").map((t) => seconds(t.trim()) ?? 0));
      } else if (d.prop === "animation-delay") {
        maxDelay = Math.max(maxDelay, ...d.value.split(",").map((t) => seconds(t.trim()) ?? 0));
      } else if (d.prop === "animation-iteration-count") {
        for (const t of d.value.split(",")) if (/^\d+(\.\d+)?$/.test(t.trim())) maxCount = Math.max(maxCount, Number(t.trim()));
      }
    }
    for (const m of svg.matchAll(/<animateMotion\b[^>]*>/g)) {
      const a = attrs(m[0]);
      if (a.repeatCount === "indefinite" || a.repeatDur === "indefinite") {
        issues.push({ kind: "infinite_loop", detail: "<animateMotion repeatCount=\"indefinite\"> never stops — run once" });
        maxCount = Infinity;
      }
      maxDuration = Math.max(maxDuration, seconds(a.dur ?? "") ?? 0);
      maxDelay = Math.max(maxDelay, seconds(a.begin ?? "") ?? 0);
      if (/^\d+(\.\d+)?$/.test(a.repeatCount ?? "")) maxCount = Math.max(maxCount, Number(a.repeatCount));
    }
    totalSeconds = maxDelay + maxDuration * maxCount;
    if (Number.isFinite(totalSeconds) && totalSeconds > MAX_TOTAL_SECONDS) {
      issues.push({ kind: "too_long", detail: `runs for about ${Math.round(totalSeconds * 10) / 10}s (largest delay + duration × iterations) — keep the whole animation within ${MAX_TOTAL_SECONDS}s (WCAG 2.2.2)` });
    }

    const reduced = media.find((b) => /prefers-reduced-motion\s*:\s*reduce/.test(b));
    if (!reduced || !/animation(-name)?\s*:\s*none/.test(reduced)) {
      issues.push({ kind: "no_reduced_motion_rule", detail: "add @media (prefers-reduced-motion: reduce) { … { animation: none; } } — it is honoured when the figure is opened on its own" });
    }

    // The picture at rest (no animation, or after it ends) must be complete: nothing hidden in base CSS,
    // and nothing left hidden by a `forwards` fill whose final keyframe hides it.
    for (const d of decls) {
      if ((d.prop === "opacity" && num(d.value, 1) === 0) || (d.prop === "visibility" && d.value === "hidden")) {
        issues.push({ kind: "hidden_at_rest", detail: `"${d.selector} { ${d.prop}: ${d.value} }" hides content in the still picture — hide it in the keyframes, not the base style` });
      }
    }
    for (const m of svg.matchAll(/<[a-zA-Z]+\b[^>]*\b(opacity|fill-opacity)\s*=\s*"0(\.0+)?"[^>]*>/g)) {
      issues.push({ kind: "hidden_at_rest", detail: `${m[0].slice(0, 60)}… is invisible in the still picture` });
    }
    const fillsForwards = animDecls.some((d) => /\b(forwards|both)\b/.test(d.value));
    if (fillsForwards) {
      for (const block of keyframes) {
        const last = block.match(/(?:100%|to)\s*\{([^{}]*)\}\s*\}\s*$/);
        if (last && /opacity\s*:\s*0(\.0+)?\s*(;|$)|visibility\s*:\s*hidden/.test(last[1])) {
          issues.push({ kind: "ends_hidden", detail: `${block.slice(0, 40)}… ends hidden and is held there by a forwards fill` });
        }
      }
    }
  }

  return { ok: issues.length === 0, animated, sequence, totalSeconds, issues };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node figure-motion-check.mjs figure.svg [more.svg ...]");
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    const { ok, animated, issues, totalSeconds } = checkFigureMotion(readFileSync(file, "utf8"));
    const label = animated ? `animated, ~${Math.round((totalSeconds ?? 0) * 10) / 10}s` : "still";
    if (ok) { console.log(`OK   ${file} (${label})`); continue; }
    failed = true;
    console.log(`FAIL ${file} (${label})`);
    for (const issue of issues) console.log(`  - ${issue.kind} — ${issue.detail}`);
  }
  process.exit(failed ? 1 : 0);
}
