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
//      cannot reach it. CSS only.
//    - The participant view shows figures as <img>. Chromium does NOT apply the reader's
//      `prefers-reduced-motion` inside an SVG shown as an image (it does when the SVG is a document).
//      So the media rule is kept as a bonus, but the animation must be safe without it: run once,
//      finish within 5 seconds (WCAG 2.2.2 — moving content that lasts longer needs a pause control,
//      and an <img> has none), and come to rest in a complete picture.
//
// ⚠️ HOW the animation is checked: against the template, not by reading CSS.
//
// This check first tried to work out what a browser would do with the figure's style rules. Three
// review rounds (2026-10-04) each found six to eight new ways round it: a duration on another rule,
// a count of 0, a later `animation: none`, `!important`, a selector that matches no box, a keyframe
// name in another case, a negative delay… A regex is not a browser, and the cascade has more
// combinations than a list can hold. Product owner's decision: the style block of an animated
// figure IS the flow template's block. Colours, the duration, the delays and the number of steps
// may differ; nothing else. The check therefore compares, it does not interpret — and a spelling
// nobody thought of is rejected by default instead of accepted by default.
//
// Still an estimate: whether a figure is flow-shaped (looksLikeSequence). See its comment.
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

// A tag ends at the first `>` that is NOT inside a quoted attribute value. `aria-label="A -> B"` is
// ordinary markup; ending the tag at that `>` hid every attribute after it — a data-motion="static"
// that was never read (a false failure), or a style="" attribute that was never seen (a false pass).
const TAG_REST = `((?:"[^"]*"|'[^']*'|[^>"'])*)`;
/** Every opening tag — optionally only the named ones — with its attributes read. */
function openTags(svg, name = "[a-zA-Z][\\w:-]*") {
  return [...svg.matchAll(new RegExp(`<(${name})\\b${TAG_REST}>`, "g"))].map((m) => ({ tag: m[1], raw: m[2], attrs: attrs(m[2]) }));
}

// ── The animation: the flow template's style block, and only that ──────────────────────────────

/** The CSS of each <style> element, without the XML CDATA wrapper. Comments are NOT removed. */
function styleBlocks(svg) {
  return [...svg.matchAll(new RegExp(`<style\\b${TAG_REST}>([\\s\\S]*?)</style>`, "g"))].map((m) => m[2].replace(/<!\[CDATA\[|\]\]>/g, " "));
}

/** Layout is free: line breaks, indentation and spaces round punctuation carry no meaning. */
const squeeze = (css) => css.replace(/\s+/g, " ").replace(/\s*([{}:;,()])\s*/g, "$1").trim();

// The slots that may vary are deliberately narrow — each one was a way through when it was wider:
//  · colours are OPAQUE hex, three or six digits. With an alpha channel (#0000) the base fill can be
//    invisible: the boxes light up once and then vanish from the still picture.
//  · times are plain non-negative seconds.
const HEX = "#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})";
const TIME = "(\\d+(?:\\.\\d+)?|\\.\\d+)s";
/** `#EEF` and `#eeeeff` are one colour. */
const sameColour = (hex) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex).toLowerCase();
// The template, rule by rule, in the template's order. Case-sensitive on purpose: `Lys` and `lys`
// are two different keyframes to a browser, `.Steg` and `.steg` two different classes.
const TEMPLATE = [
  ["the base rule `.steg { fill: <hex>; stroke: <hex>; }`", `\\.steg\\{fill:(${HEX});stroke:${HEX};?\\}`],
  ["`@keyframes lys { 0%, 70% { fill: <hex>; } 100% { fill: <hex>; } }`", `@keyframes lys\\{0%,70%\\{fill:(${HEX});?\\}100%\\{fill:(${HEX});?\\}\\}`],
  ["`.steg { animation: lys <seconds>s ease-in-out 1; }`", `\\.steg\\{animation:lys ${TIME} ease-in-out 1;?\\}`],
  ["the delay rules `.s2 { animation-delay: <seconds>s; }`, `.s3 { … }`, one per later step", `((?:\\.s\\d+\\{animation-delay:${TIME};?\\})*)`],
  ["`@media (prefers-reduced-motion: reduce) { .steg { animation: none; } }` as the last rule", `@media\\(prefers-reduced-motion:reduce\\)\\{\\.steg\\{animation:none;?\\}\\}$`],
];

// The WHOLE figure is the template, not only its style block (product owner, 2026-10-04, after the
// fifth review round). The template is step boxes, connectors, labels and one style block. Checking
// "every <rect> is a step" let a fourth step drawn as a <polygon> through; checking the CSS let
// <style media="print"> through, where the block never applies. Each was one more shape nobody had
// listed. So the shapes are listed the other way round: these elements, and no others.
const TEMPLATE_ELEMENTS = new Set(["svg", "style", "rect", "text", "tspan", "line", "polyline", "path", "title", "desc"]);
// SMIL elements have their own, more useful message (stripped_by_platform / not_css_only). Matched
// without regard to case: the platform's sanitizer restores `<animatemotion>` to `<animateMotion>`,
// so the lower-case spelling runs on the platform just the same.
const SMIL = ["animate", "set", "animateTransform", "animateMotion"];
const REPORTED_ELSEWHERE = new Set(SMIL.map((tag) => tag.toLowerCase()));
/** Shorter than this and the highlight is over before anyone sees it. */
const MIN_DURATION_SECONDS = 0.3;

/** A stroke that ends where it began encloses an area — with or without a closing `Z`. */
const returnsToStart = (points) => points.length >= 3
  && Math.abs(points[0].x - points.at(-1).x) < 0.5 && Math.abs(points[0].y - points.at(-1).y) < 0.5;

/** What in the markup is not the template's markup. */
function markupProblems(svg) {
  const problems = [];
  const tags = openTags(svg);

  const foreign = [...new Set(tags.map((t) => t.tag).filter((tag) => !TEMPLATE_ELEMENTS.has(tag) && !REPORTED_ELSEWHERE.has(tag.toLowerCase())))];
  if (foreign.length > 0) problems.push(`an animated figure is made of <rect> step boxes, <line>/<polyline>/<path> connectors, <text> labels and one <style> block — found ${foreign.map((t) => `<${t}>`).join(", ")}`);
  if (tags.filter((t) => t.tag === "svg").length !== 1) problems.push("an animated figure is one <svg>, with none nested inside it");

  // media="print", type="text/plain", disabled: each switches the whole block off while its text
  // still reads as the template.
  const styled = tags.filter((t) => t.tag === "style" && t.raw.replace(/\/\s*$/, "").trim() !== "");
  if (styled.length > 0) problems.push("the <style> element has no attributes — media=\"…\" or type=\"…\" can switch the whole block off");

  // A transform moves or shrinks an element without changing the numbers this check reads.
  if (tags.some((t) => t.attrs.transform !== undefined)) problems.push("an animated figure has no transform attributes — place elements with x/y instead");

  // A connector is an open stroke. Filled or closed, a <path> or <polyline> is a box drawn another
  // way — a step that carries no step class and never lights up.
  // (A closing `Z` needs no rule of its own: it takes the path back to its start point.)
  const encloses = (t) => (t.tag === "path"
    ? pathSubpaths(t.attrs.d ?? "").some(returnsToStart)
    : returnsToStart(pointList(t.attrs.points)));
  const shapes = tags.filter((t) => (t.tag === "path" || t.tag === "polyline")
    && ((t.attrs.fill ?? "").trim().toLowerCase() !== "none" || encloses(t)));
  if (shapes.length > 0) problems.push(`a connector (<path>, <polyline>) is an open stroke with fill="none" — found ${shapes.length} that is filled or closed; a box is a <rect class="steg sN">`);
  return problems;
}

/**
 * Compares the figure with the template.
 * @returns {{ totalSeconds: number } | { problems: string[] }}
 */
function matchTemplate(svg) {
  const markup = markupProblems(svg);
  if (markup.length > 0) return { problems: markup };

  const blocks = styleBlocks(svg);
  if (blocks.length !== 1) return { problems: [`an animated figure has exactly one <style> block (found ${blocks.length})`] };
  // An inline style wins over the stylesheet, and an !important there wins over the animation too.
  // An animated figure sets colours and sizes with attributes (fill="…"), which the animation overrides.
  if (openTags(svg).some((t) => t.attrs.style !== undefined)) {
    return { problems: ["an animated figure has no style=\"\" attributes — use presentation attributes (fill, stroke, …) instead"] };
  }

  // A comment may sit anywhere a browser allows one, including inside a value: `1/**/.4s` reads as
  // "1.4s" once the comment is deleted, and as two tokens — an invalid declaration, a still figure —
  // to the browser. The template has no comments, so neither has the figure.
  if (blocks[0].includes("/*")) return { problems: ["the style block of an animated figure has no comments — put them in the markup (<!-- … -->)"] };

  let rest = squeeze(blocks[0]);
  const found = [];
  for (const [what, source] of TEMPLATE) {
    const m = rest.match(new RegExp(`^${source}`));
    if (!m) return { problems: [`expected ${what}, found "${rest.slice(0, 60) || "(end of the style block)"}"`] };
    found.push(m);
    rest = rest.slice(m[0].length);
  }
  const [base, keyframes, animation, delays] = found;
  const problems = [];

  const [baseFill, highlight, endFill] = [base[1], keyframes[1], keyframes[2]].map(sameColour);
  if (endFill !== baseFill) problems.push(`the last keyframe (${endFill}) must return to the base fill (${baseFill}), so the figure rests as the plain flow`);
  if (highlight === baseFill) problems.push(`the highlight colour equals the base fill (${baseFill}) — nothing would be seen to move`);

  const duration = Number(animation[1]);
  if (!(duration >= MIN_DURATION_SECONDS)) problems.push(`the duration must be at least ${MIN_DURATION_SECONDS}s — shorter, and the step lights up without anyone seeing it`);

  // The steps: boxes carry `steg s1`, `steg s2`, … and every step after the first has its delay rule.
  // Checked both ways, so a rule cannot point at a class no box has, and no box is left without one.
  const delayRules = [...delays[0].matchAll(new RegExp(`\\.s(\\d+)\\{animation-delay:${TIME}`, "g"))].map((m) => ({ step: Number(m[1]), delay: Number(m[2]) }));
  const ruleSteps = delayRules.map((r) => r.step);
  const expected = delayRules.map((_, i) => i + 2);
  if (ruleSteps.join() !== expected.join()) problems.push(`the delay rules must be .s2, .s3, … in order, without gaps (found ${ruleSteps.map((s) => `.s${s}`).join(", ") || "none"})`);
  // "One after another" is the point of the figure. Equal delays light two steps at once, and a
  // smaller delay on a later step plays the order backwards. The first step starts at 0.
  const delaysInOrder = [0, ...delayRules.map((r) => r.delay)];
  if (delaysInOrder.some((delay, i) => i > 0 && !(delay > delaysInOrder[i - 1]))) {
    problems.push(`each step's delay must be larger than the one before it, so the steps light up in order (found ${delaysInOrder.slice(1).map((d) => `${d}s`).join(", ")})`);
  }
  // The step classes belong on the BOXES. On a <text> the same rule would animate the label's
  // colour and leave the boxes still — and a check that counted any element would call that fine.
  const carriers = openTags(svg)
    .map((t) => ({ tag: t.tag, classes: (t.attrs.class ?? "").split(/\s+/) }))
    .filter((el) => el.classes.includes("steg"));
  const notBoxes = [...new Set(carriers.filter((el) => el.tag !== "rect").map((el) => `<${el.tag}>`))];
  if (notBoxes.length > 0) problems.push(`class "steg" belongs on the boxes (<rect>) only — found it on ${notBoxes.join(", ")}`);
  // …and EVERY box is a step. A fourth box without the class is a step that never lights up: the
  // figure shows four steps and animates three. Deciding which rects "belong to the flow" would be a
  // guess, so there is none to make: the template has step boxes, lines and labels, nothing else.
  const plainBoxes = openTags(svg, "rect").filter((t) => !(t.attrs.class ?? "").split(/\s+/).includes("steg")).length;
  if (plainBoxes > 0) problems.push(`every <rect> in an animated figure is a step box — found ${plainBoxes} without class "steg" (a box that is not a step never lights up)`);
  const boxSteps = carriers.map((el) => el.classes.filter((c) => /^s\d+$/.test(c)).map((c) => Number(c.slice(1))));
  const stepsOnBoxes = boxSteps.flat().sort((a, b) => a - b);
  if (boxSteps.some((steps) => steps.length !== 1) || stepsOnBoxes.join() !== [1, ...expected].join()) {
    problems.push(`each animated box carries class "steg" and one step class, s1…s${expected.length + 1} — one box per step (found ${boxSteps.length} box(es) with steps ${stepsOnBoxes.join(", ") || "none"})`);
  }

  if (problems.length > 0) return { problems };
  return { totalSeconds: Math.max(0, ...delayRules.map((r) => r.delay)) + duration };
}

// ── Is the figure flow-shaped? ─────────────────────────────────────────────────────────────────

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

/** The points of a `points="…"` attribute. */
function pointList(value) {
  const n = (String(value ?? "").match(NUMBER) ?? []).map(Number);
  const points = [];
  for (let i = 0; i + 1 < n.length; i += 2) points.push({ x: n[i], y: n[i + 1] });
  return points;
}

/** Every drawn connector as the list of points it passes through. */
function connectorPoints(svg) {
  const out = [];
  for (const { tag, attrs: a } of openTags(svg, "line|polyline|polygon|path")) {
    if (tag === "line") out.push([{ x: num(a.x1), y: num(a.y1) }, { x: num(a.x2), y: num(a.y2) }]);
    else if (tag === "path") out.push(...pathSubpaths(a.d ?? ""));
    else out.push(pointList(a.points));
  }
  return out.filter((points) => points.length >= 2);
}

/**
 * Flow-shaped: three labelled boxes in a row (or a column) where a connector joins the first to the
 * second and another joins the second to the third.
 *
 * It is the JOINING that makes a flow. Counting boxes and lines separately read a hierarchy — one
 * parent with lines down to three aligned children — as a sequence, and missed a real flow whose
 * arrows were plain <path>s.
 *
 * ⚠️ An estimate, and documented as one. It sees <rect>s with x/y attributes, labels in <text> and
 * <tspan>, and connectors that end within TOUCH_TOLERANCE of the boxes. It does not see boxes moved
 * by a transform, circles, or <use>. The cure is not a better guess: it is that every figure states
 * `data-motion="animated"` or `"static"` itself. That changes the skill's contract and is the
 * product owner's decision (doc/VERSIONS.md, 2.78.1).
 */
function looksLikeSequence(svg) {
  const boxes = [];
  for (const { attrs: a } of openTags(svg, "rect")) {
    const b = { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height) };
    if (b.w > 0 && b.h > 0) boxes.push({ ...b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
  }
  // A label sits where its <text> says — or where its <tspan>s say: long labels are broken into
  // lines with <tspan x y>, and then the <text> itself often carries no position at all.
  const texts = [...svg.matchAll(new RegExp(`<text\\b${TAG_REST}>([\\s\\S]*?)</text>`, "g"))]
    .filter((m) => m[2].replace(/<[^>]+>/g, "").trim())
    .flatMap((m) => {
      const own = attrs(m[1]);
      const spans = openTags(m[2], "tspan").map((s) => s.attrs).filter((s) => s.x !== undefined || s.y !== undefined);
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

// ── The check ──────────────────────────────────────────────────────────────────────────────────

/** @returns {{ ok: boolean, animated: boolean, sequence: boolean, totalSeconds: number | null, issues: Array<{ kind: string, detail: string }> }} */
export function checkFigureMotion(svg) {
  const issues = [];
  const root = openTags(svg, "svg")[0]?.attrs ?? {};
  const declaredStatic = root["data-motion"] === "static";
  const sequence = looksLikeSequence(svg);

  for (const tag of ["animate", "set", "animateTransform"]) {
    if (new RegExp(`<${tag}\\b`, "i").test(svg)) {
      issues.push({ kind: "stripped_by_platform", detail: `<${tag}> is removed (or disabled) by A2's sanitizer — use CSS @keyframes instead` });
    }
  }
  // The sanitizer KEEPS <animateMotion>, so it would run — which is the problem: it is SMIL, and no
  // CSS reduced-motion rule can switch it off. The rule is CSS only, and it does not count as animated.
  if (/<animateMotion\b/i.test(svg)) {
    issues.push({ kind: "not_css_only", detail: "<animateMotion> is SMIL: the platform keeps it, but no reduced-motion rule can switch it off — animate with CSS @keyframes instead" });
  }

  // Does the figure try to move at all? Any mention counts — in a <style> block or in a style
  // attribute — because a figure that mentions animation and is NOT the template must not pass as
  // a still figure either. A backslash counts too: CSS reads `anim\61tion` as `animation`, and no
  // figure has a reason to escape a character in its style.
  const inlineStyles = openTags(svg).map((t) => t.attrs.style).filter((css) => css !== undefined);
  const triesToAnimate = [...styleBlocks(svg), ...inlineStyles].some((css) => /animation|@keyframes|\\/i.test(css));

  let animated = false;
  let totalSeconds = null;
  if (triesToAnimate) {
    const result = matchTemplate(svg);
    if ("problems" in result) {
      for (const problem of result.problems) {
        issues.push({ kind: "unsupported_animation_form", detail: `${problem} — an animated figure uses the flow template's <style> block unchanged, apart from colours, duration, delays and the number of steps (figure-design.md)` });
      }
    } else {
      animated = true;
      totalSeconds = result.totalSeconds;
      if (totalSeconds > MAX_TOTAL_SECONDS) {
        issues.push({ kind: "too_long", detail: `runs for about ${Math.round(totalSeconds * 10) / 10}s (largest delay + duration) — keep the whole animation within ${MAX_TOTAL_SECONDS}s (WCAG 2.2.2)` });
      }
      // The picture at rest must be complete. The template's CSS hides nothing, so what is left to
      // check is the markup: an element switched off by an attribute stays off when the animation
      // ends. Values are READ, not pattern-matched: `opacity=" 0 "`, `0%` and `visibility="collapse"`
      // hide just as well as the spellings one thinks of first.
      //
      // ⚠️ This catches the attributes that switch an element off. It cannot see everything that
      // makes a figure incomplete (a box drawn outside the viewBox, white on white). The guard for
      // that is the mandatory look at the rendered figure (figure-design.md, #1060) — not this check.
      for (const { tag, raw, attrs: a } of openTags(svg)) {
        const value = (name) => (a[name] ?? "").trim().toLowerCase();
        const zero = (name) => {
          const v = value(name);
          return v !== "" && Number.isFinite(Number.parseFloat(v)) && Number.parseFloat(v) <= 0;
        };
        if (value("display") === "none" || ["hidden", "collapse"].includes(value("visibility")) || zero("opacity") || zero("fill-opacity")) {
          issues.push({ kind: "hidden_at_rest", detail: `${`<${tag}${raw}>`.slice(0, 60)}… is invisible in the still picture` });
        }
      }
    }
  } else if (sequence && !declaredStatic) {
    issues.push({ kind: "sequence_not_animated", detail: "flow-shaped figure (≥3 boxes in order) with no animation — animate the order with the flow template, or mark the root <svg data-motion=\"static\"> if a still picture is the deliberate choice" });
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
