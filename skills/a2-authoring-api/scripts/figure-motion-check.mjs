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
// `.a > .b` and `.a>.b` are the same selector; compare them as the browser does, not as text.
const selectorParts = (selector) => selector.split(",")
  .map((s) => s.trim().replace(/\s+/g, " ").replace(/\s*([>+~])\s*/g, "$1"))
  .filter(Boolean);

/**
 * Lifts every `@<name> … { … }` block (with nested braces) out of the CSS. The block is replaced by
 * blanks of the same length, so a position in `rest` is still a position in the original text —
 * that is what lets the reduced-motion check ask which rule comes last.
 */
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
    rest += css.slice(i, m.index) + " ".repeat(j - m.index);
    blocks.push({ text: css.slice(m.index, j), index: m.index });
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
      const raw = decl.slice(idx + 1).trim().toLowerCase();
      // `!important` changes who wins, never what the value is. Keep the two apart so no comparison
      // below has to remember to strip it.
      const important = /!\s*important$/.test(raw);
      out.push({ selector: m[1].trim(), prop: decl.slice(0, idx).trim().toLowerCase(), value: raw.replace(/\s*!\s*important$/, ""), important, index: m.index });
    }
  }
  return out;
}

const EASING = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
const FILL = new Set(["forwards", "backwards", "both"]);

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
  // A label sits where its <text> says — or where its <tspan>s say: long labels are broken into
  // lines with <tspan x y>, and then the <text> itself often carries no position at all.
  const texts = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .filter((m) => m[2].replace(/<[^>]+>/g, "").trim())
    .flatMap((m) => {
      const own = attrs(m[1]);
      const spans = [...m[2].matchAll(/<tspan\b([^>]*)>/g)].map((s) => attrs(s[1])).filter((s) => s.x !== undefined || s.y !== undefined);
      return [own, ...spans.map((s) => ({ x: s.x ?? own.x, y: s.y ?? own.y }))]
        .filter((p) => p.x !== undefined && p.y !== undefined)
        .map((p) => ({ x: num(p.x), y: num(p.y) }));
    });
  const labelled = boxes.filter((b) => texts.some((t) => t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h));
  if (labelled.length < 3) return false;

  const connectors = connectorPoints(svg);
  const touches = (p, b) => p.x >= b.x - TOUCH_TOLERANCE && p.x <= b.x + b.w + TOUCH_TOLERANCE
    && p.y >= b.y - TOUCH_TOLERANCE && p.y <= b.y + b.h + TOUCH_TOLERANCE;
  // Joined DIRECTLY: the connector runs from one box to the other without visiting a third on the
  // way. One path drawn child → parent → child touches both children, and joins neither to the other.
  const joined = (a, b) => connectors.some((points) => points.some((start, i) => {
    const from = touches(start, a) ? a : touches(start, b) ? b : null;
    if (!from) return false;
    const to = from === a ? b : a;
    if (touches(start, to)) return true;
    for (const p of points.slice(i + 1)) {
      if (touches(p, to)) return true;
      if (labelled.some((other) => other !== from && other !== to && touches(p, other))) return false;
    }
    return false;
  }));

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

  // ⚠️ A WHITELIST, on purpose. This check first listed the unsafe ways to write an animation, and
  // three review rounds each found one more (a longhand duration on another rule, an iteration count
  // of 0, commas inside cubic-bezier(), `svg *`, …). CSS has more spellings than a regex can list.
  // So the question is turned round: the figure may use the ONE form the templates use —
  //
  //   <selector> { animation: <keyframes-name> <duration> [<delay>] [<easing keyword>] [1] [<fill>]; }
  //   <selector> { animation-delay: <time>; }          (the stagger between steps)
  //
  // in a <style> block — and everything else is `unsupported_animation_form`, with the reason. A new
  // spelling is then rejected by default instead of passing by default.
  const keyframeNames = new Set(keyframes.map((b) => (b.text.match(/@keyframes\s+([\w-]+)/) ?? [])[1]?.toLowerCase()).filter(Boolean));
  const unsupported = (d, why) => issues.push({ kind: "unsupported_animation_form", detail: `"${d.selector} { ${d.prop}: ${d.value} }" — ${why}` });
  const animatedRules = []; // { selector, index } of every rule whose animation actually runs
  let maxDuration = 0, maxDelay = 0, maxCount = 1;
  for (const d of animDecls) {
    if (d.selector === INLINE) { unsupported(d, "put the animation in the <style> block, not in a style attribute"); continue; }
    if (d.prop === "animation-delay") {
      const delay = seconds(d.value);
      if (delay === null) unsupported(d, "one time value, e.g. 1.2s");
      else maxDelay = Math.max(maxDelay, delay);
      continue;
    }
    if (d.prop !== "animation") { unsupported(d, "write it in the `animation` shorthand; only `animation-delay` may stand alone"); continue; }
    if (d.value === "none") continue;
    if (d.value.includes("(")) { unsupported(d, "functions such as cubic-bezier() and steps() are not supported — use an easing keyword"); continue; }
    if (d.value.includes(",")) { unsupported(d, "one animation per rule"); continue; }

    const tokens = d.value.split(/\s+/);
    const names = tokens.filter((t) => keyframeNames.has(t));
    const times = tokens.map(seconds).filter((s) => s !== null);
    const counts = tokens.filter((t) => /^\d+(\.\d+)?$/.test(t)).map(Number);
    const infinite = tokens.includes("infinite");
    const unknown = tokens.filter((t) => !keyframeNames.has(t) && seconds(t) === null && !/^\d+(\.\d+)?$/.test(t)
      && t !== "infinite" && !EASING.has(t) && !FILL.has(t));

    if (names.length === 0) {
      // A name that matches no @keyframes is the likeliest cause, so say that rather than "unknown word".
      issues.push({ kind: "animation_never_runs", detail: `"${d.selector} { animation: ${d.value} }" names no @keyframes that exists in the figure — it stays still` });
      continue;
    }
    if (unknown.length > 0 || names.length > 1 || times.length > 2 || counts.length > 1) {
      unsupported(d, unknown.length > 0 ? `"${unknown.join('", "')}" is not part of the supported form` : "one name, one duration, at most one delay and one count");
      continue;
    }
    const duration = times[0] ?? 0;
    const count = infinite ? Infinity : (counts[0] ?? 1);
    if (duration <= 0 || count === 0) {
      issues.push({ kind: "animation_never_runs", detail: `"${d.selector} { animation: ${d.value} }" has ${duration <= 0 ? "no duration above 0s" : "an iteration count of 0"} — it stays still` });
      continue;
    }
    if (infinite) issues.push({ kind: "infinite_loop", detail: `"animation: ${d.value}" never stops — run once (an <img> offers no pause control)` });
    animatedRules.push({ selector: d.selector, index: d.index });
    maxDuration = Math.max(maxDuration, duration);
    maxDelay = Math.max(maxDelay, times[1] ?? 0);
    maxCount = Math.max(maxCount, count);
  }
  const animated = animatedRules.length > 0;
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
    // "Once" is the rule, not "short": three quick repeats fit inside 5 seconds and still loop.
    if (Number.isFinite(maxCount) && maxCount > 1) {
      issues.push({ kind: "repeats", detail: `the animation runs ${maxCount} times — run it once` });
    }
    totalSeconds = maxDelay + maxDuration * maxCount;
    if (Number.isFinite(totalSeconds) && totalSeconds > MAX_TOTAL_SECONDS) {
      issues.push({ kind: "too_long", detail: `runs for about ${Math.round(totalSeconds * 10) / 10}s (largest delay + duration × iterations) — keep the whole animation within ${MAX_TOTAL_SECONDS}s (WCAG 2.2.2)` });
    }

    // The rule has to switch off the animation that is actually there — and WIN. Two ways only:
    //   · the same selector, `animation: none`, written AFTER the animated rule (or !important);
    //   · `* { animation: none !important; }` — without !important a bare `*` loses to any class.
    // `.unrelated { animation: none }` is a rule, but the figure still moves; so is `svg *` when the
    // animation sits on the root.
    const off = media
      .filter((b) => /prefers-reduced-motion\s*:\s*reduce/.test(b.text))
      .flatMap((b) => declarations(b.text.slice(b.text.indexOf("{") + 1, b.text.lastIndexOf("}"))).map((d) => ({ ...d, index: b.index })))
      .filter((d) => d.prop === "animation" && d.value === "none");
    const switchedOff = (rule) => off.some((d) => d.important && selectorParts(d.selector).includes("*"))
      || selectorParts(rule.selector).every((part) => off.some((d) => selectorParts(d.selector).includes(part) && (d.important || d.index > rule.index)));
    const uncovered = [...new Set(animatedRules.filter((rule) => !switchedOff(rule)).map((rule) => rule.selector))];
    if (off.length === 0) {
      issues.push({ kind: "no_reduced_motion_rule", detail: "add @media (prefers-reduced-motion: reduce) { … { animation: none; } } — it is honoured when the figure is opened on its own" });
    } else if (uncovered.length > 0) {
      issues.push({ kind: "no_reduced_motion_rule", detail: `the reduced-motion rule does not switch off "${uncovered.join('", "')}" — name the same selector after the animated rule, or use * { animation: none !important; }` });
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
      for (const { text: block } of keyframes) {
        const last = block.match(/(?:100%|to)\s*\{([^{}]*)\}\s*\}\s*$/);
        if (last && /opacity\s*:\s*0(\.0+)?\s*(;|$)|visibility\s*:\s*hidden|display\s*:\s*none/.test(last[1])) {
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
