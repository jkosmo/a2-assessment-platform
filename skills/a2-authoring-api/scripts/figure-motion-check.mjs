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
//      <animateMotion> survives but is rejected here too: it is SMIL, so the reduced-motion rule
//      below cannot reach it. CSS only.
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
const TOUCH_TOLERANCE = 12;

// SVG allows both quote forms. Reading only one of them let a valid single-quoted flow through as
// "no boxes found", i.e. not a sequence, i.e. nothing to check.
const QUOTED = `(?:"([^"]*)"|'([^']*)')`;

function attrs(tag) {
  const out = {};
  // Digits belong in the name: without them `x1`/`y2` on a <line> are never read.
  for (const m of tag.matchAll(new RegExp(`([a-zA-Z_:][-a-zA-Z0-9_:.]*)\\s*=\\s*${QUOTED}`, "g"))) out[m[1]] = m[2] ?? m[3];
  return out;
}
const num = (v, fallback = 0) => {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

function styleText(svg) {
  const blocks = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const inline = [...svg.matchAll(new RegExp(`\\bstyle\\s*=\\s*${QUOTED}`, "g"))].map((m) => `${INLINE}{${m[1] ?? m[2]}}`);
  return [...blocks, ...inline].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The "selector" of a style="" attribute. No stylesheet selector can name it. */
const INLINE = "(inline style)";
const selectorParts = (selector) => selector.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
const isUniversal = (part) => part === "*" || part === "svg *";

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

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const PATH_STEP = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 };

/** The points a path's segments end on, one list per subpath. Enough to tell what a connector touches. */
function pathSubpaths(d) {
  const subpaths = [];
  let current = null, x = 0, y = 0, startX = 0, startY = 0;
  for (const m of String(d).matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const upper = m[1].toUpperCase();
    const relative = m[1] !== upper;
    if (upper === "Z") { x = startX; y = startY; current?.push({ x, y }); continue; }
    const n = (m[2].match(NUMBER) ?? []).map(Number);
    const step = PATH_STEP[upper];
    for (let i = 0; i + step <= n.length; i += step) {
      if (upper === "H") x = relative ? x + n[i] : n[i];
      else if (upper === "V") y = relative ? y + n[i] : n[i];
      else {
        x = relative ? x + n[i + step - 2] : n[i + step - 2];
        y = relative ? y + n[i + step - 1] : n[i + step - 1];
      }
      if (upper === "M" && i === 0) { startX = x; startY = y; current = []; subpaths.push(current); }
      current?.push({ x, y });
    }
  }
  return subpaths;
}

/** Every drawn connector as the list of points it passes through. */
function connectorPoints(svg) {
  const out = [];
  for (const m of svg.matchAll(/<(line|polyline|polygon|path)\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (m[1] === "line") out.push([{ x: num(a.x1), y: num(a.y1) }, { x: num(a.x2), y: num(a.y2) }]);
    else if (m[1] === "path") out.push(...pathSubpaths(a.d ?? ""));
    else {
      const n = ((a.points ?? "").match(NUMBER) ?? []).map(Number);
      const points = [];
      for (let i = 0; i + 1 < n.length; i += 2) points.push({ x: n[i], y: n[i + 1] });
      out.push(points);
    }
  }
  return out.filter((points) => points.length >= 2);
}

/**
 * Flow-shaped: three labelled boxes in a row (or a column) where a connector joins the first to the
 * second and another joins the second to the third.
 *
 * It is the JOINING that makes a flow. Counting boxes and lines separately read a hierarchy — one
 * parent with lines down to three aligned children — as a sequence, and missed a real flow whose
 * arrows were plain <path>s. Known limits: boxes must be <rect>s with x/y attributes (not moved by a
 * transform), and a connector must end within TOUCH_TOLERANCE of the boxes it joins.
 */
function looksLikeSequence(svg) {
  const boxes = [];
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const b = { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height) };
    if (b.w > 0 && b.h > 0) boxes.push({ ...b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
  }
  const texts = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .filter((m) => m[2].replace(/<[^>]+>/g, "").trim())
    .map((m) => ({ x: num(attrs(m[1]).x), y: num(attrs(m[1]).y) }));
  const labelled = boxes.filter((b) => texts.some((t) => t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h));
  if (labelled.length < 3) return false;

  const connectors = connectorPoints(svg);
  const touches = (p, b) => p.x >= b.x - TOUCH_TOLERANCE && p.x <= b.x + b.w + TOUCH_TOLERANCE
    && p.y >= b.y - TOUCH_TOLERANCE && p.y <= b.y + b.h + TOUCH_TOLERANCE;
  const joined = (a, b) => connectors.some((points) => points.some((p) => touches(p, a)) && points.some((p) => touches(p, b)));

  for (const [across, along] of [["cy", "cx"], ["cx", "cy"]]) {
    for (const anchor of labelled) {
      const line = labelled.filter((b) => Math.abs(b[across] - anchor[across]) <= ALIGN_TOLERANCE).sort((p, q) => p[along] - q[along]);
      for (let i = 0; i + 2 < line.length; i++) {
        if (joined(line[i], line[i + 1]) && joined(line[i + 1], line[i + 2])) return true;
      }
    }
  }
  return false;
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

  // An animation only counts when it can actually run: it names a @keyframes that exists and has a
  // duration above zero. `animation-name: pulse` alone is still (the default duration is 0s), and so
  // is a misspelt name — both used to pass as "animated" and silence `sequence_not_animated`.
  const keyframeNames = new Set(keyframes.map((b) => (b.match(/@keyframes\s+([\w-]+)/) ?? [])[1]?.toLowerCase()).filter(Boolean));
  const durationsOf = (selector) => animDecls
    .filter((d) => d.prop === "animation-duration" && (selector === null || d.selector === selector))
    .flatMap((d) => d.value.split(",").map((t) => seconds(t.trim()) ?? 0));
  const animatedSelectors = new Set();
  for (const d of animDecls) {
    if ((d.prop !== "animation" && d.prop !== "animation-name") || d.value === "none") continue;
    for (const one of d.value.split(",")) {
      const tokens = one.trim().split(/\s+/);
      const name = tokens.find((t) => keyframeNames.has(t));
      // Shorthand carries its own duration. For `animation-name`, look in the same rule first; a
      // duration set by another rule cannot be resolved without the cascade, so it is accepted.
      const own = durationsOf(d.selector);
      const duration = d.prop === "animation"
        ? (tokens.map(seconds).filter((s) => s !== null)[0] ?? 0)
        : Math.max(0, ...(own.length ? own : durationsOf(null)));
      if (name && duration > 0) { animatedSelectors.add(d.selector); continue; }
      issues.push({
        kind: "animation_never_runs",
        detail: !name
          ? `"${d.selector} { ${d.prop}: ${d.value} }" names no @keyframes that exists in the figure — it stays still`
          : `"${d.selector} { ${d.prop}: ${d.value} }" has no duration above 0s — it stays still`,
      });
    }
  }
  const animated = animatedSelectors.size > 0;
  const sequence = looksLikeSequence(svg);

  for (const tag of ["animate", "set", "animateTransform"]) {
    if (new RegExp(`<${tag}\\b`).test(svg)) {
      issues.push({ kind: "stripped_by_platform", detail: `<${tag}> is removed (or disabled) by A2's sanitizer — use CSS @keyframes instead` });
    }
  }
  // The sanitizer KEEPS <animateMotion>, so it would run — which is the problem: it is SMIL, and no
  // CSS reduced-motion rule can switch it off. The rule is CSS only, and it does not count as animated.
  if (/<animateMotion\b/.test(svg)) {
    issues.push({ kind: "not_css_only", detail: "<animateMotion> is SMIL: the platform keeps it, but no reduced-motion rule can switch it off — animate with CSS @keyframes instead" });
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
    // "Once" is the rule, not "short": three quick repeats fit inside 5 seconds and still loop.
    if (Number.isFinite(maxCount) && maxCount > 1) {
      issues.push({ kind: "repeats", detail: `the animation runs ${maxCount} times — run it once` });
    }
    totalSeconds = maxDelay + maxDuration * maxCount;
    if (Number.isFinite(totalSeconds) && totalSeconds > MAX_TOTAL_SECONDS) {
      issues.push({ kind: "too_long", detail: `runs for about ${Math.round(totalSeconds * 10) / 10}s (largest delay + duration × iterations) — keep the whole animation within ${MAX_TOTAL_SECONDS}s (WCAG 2.2.2)` });
    }

    // The rule has to switch off the animation that is actually there. `.unrelated { animation: none }`
    // inside the media block is a rule, but the figure still moves.
    const off = media
      .filter((b) => /prefers-reduced-motion\s*:\s*reduce/.test(b))
      .flatMap((b) => declarations(b.slice(b.indexOf("{") + 1, b.lastIndexOf("}"))))
      .filter((d) => (d.prop === "animation" || d.prop === "animation-name") && d.value.replace(/\s*!important$/, "") === "none");
    const offParts = new Set(off.flatMap((d) => selectorParts(d.selector)));
    const universal = [...offParts].some(isUniversal);
    // An inline style="" beats every stylesheet rule that is not !important.
    const universalImportant = off.some((d) => d.value.endsWith("!important") && selectorParts(d.selector).some(isUniversal));
    const uncovered = [...animatedSelectors].filter((selector) => selector === INLINE
      ? !universalImportant
      : !universal && !selectorParts(selector).every((part) => offParts.has(part)));
    if (off.length === 0) {
      issues.push({ kind: "no_reduced_motion_rule", detail: "add @media (prefers-reduced-motion: reduce) { … { animation: none; } } — it is honoured when the figure is opened on its own" });
    } else if (uncovered.length > 0) {
      issues.push({ kind: "no_reduced_motion_rule", detail: `the reduced-motion rule does not switch off "${uncovered.join('", "')}" — name the same selector, or use * { animation: none !important; }` });
    }

    // The picture at rest (no animation, or after it ends) must be complete: nothing hidden in base CSS,
    // and nothing left hidden by a `forwards` fill whose final keyframe hides it.
    for (const d of decls) {
      if ((d.prop === "opacity" && num(d.value, 1) === 0) || (d.prop === "visibility" && d.value === "hidden") || (d.prop === "display" && d.value === "none")) {
        issues.push({ kind: "hidden_at_rest", detail: `"${d.selector} { ${d.prop}: ${d.value} }" hides content in the still picture — hide it in the keyframes, not the base style` });
      }
    }
    for (const m of svg.matchAll(/<[a-zA-Z]+\b[^>]*\b(?:(?:opacity|fill-opacity)\s*=\s*["']0(?:\.0+)?["']|display\s*=\s*["']none["']|visibility\s*=\s*["']hidden["'])[^>]*>/g)) {
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
