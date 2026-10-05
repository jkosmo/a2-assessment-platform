// #1079: draws a flow figure from a DESCRIPTION — in two layouts.
//
// A figure shown as an image has a fixed shape: it cannot re-break itself when the column gets
// narrow. So a flow is drawn twice, wide (every step on one row) and narrow (two per row), and the
// platform picks by column width. Two hand-drawn SVGs would drift apart — a label corrected in one,
// a step added in the other. Here the content is stated once (steps, order, phases, colours) and
// both drawings are made from it, so they cannot disagree.
//
// The output is the flow template of figure-design.md (#1073): the same style block, the same
// elements. Every drawing is run through figure-motion-check and figure-fit-check before it is
// returned; a description that does not fit (a label too long for its neighbour, too many steps for
// five seconds) is an error here, not a figure that looks wrong later.
//
// Node stdlib only, pure, repo-testable. Usage:
//   node draw-flow-figure.mjs description.json out-dir     writes <name>.svg and <name>.narrow.svg
//   import { drawFlowFigure } from "./draw-flow-figure.mjs"   → { wide, narrow }
//
// description.json:
//   { "name": "arbeidsflyt",                       file name, [a-z0-9-]
//     "title": "…", "desc": "…",                    accessible name and description (required)
//     "phases": { "data": { "label": "Data", "grunn": "#d9e8dd", "lys": "#6fae87", "tekst": "#3f7a57" }, … },
//     "steps": [ { "label": ["Klargjør", "kilder"], "phase": "data" }, … ] }
// A phase without "label" gets no line above its steps. "tekst" is the colour of the phase label.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkFigureFit } from "./figure-fit-check.mjs";
import { checkFigureMotion } from "./figure-motion-check.mjs";

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const PHASE_NAME = /^[a-z][a-z0-9-]*$/;
const DURATION = 0.9;
const INK = "#2d3b55";
const CONNECTOR = "#8090a9";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Wide: every step on one row. Narrow: two per row, for the column a phone gives.
//
// Why two. A label needs the room between two steps, so a row of n steps is about 104·n wide, and
// its 12 px labels are 9 px on screen — the smallest that reads — when the column is 78·n px. The
// column a participant reads in on a 390 px phone is about 200 px (measured in the real reader,
// 2026-10-05): room for two steps, not three. The first narrow layout had four per row, drawn for a
// 480 px column nobody had measured, and its labels were 5 px on that phone.
//
// `shownAt` is the largest the layout is shown: the drawing states its own size (`width`, `height`),
// and an image is scaled down to its column but not up past that. Without it the narrow layout would
// fill a 600 px column — a tablet — with labels 30 px high. The wide layout states none and fills
// its column, as it always has.
const LAYOUTS = {
  wide: { perRow: Infinity, margin: 60, spacing: 104, r: 22, rowHeight: 0, phaseHalf: 48, shownAt: null },
  narrow: { perRow: 2, margin: 66, spacing: 108, r: 24, rowHeight: 118, phaseHalf: 40, shownAt: 1.25 },
};
const TOP = 48;
/** Seconds between one step lighting up and the next. */
const GAP = 0.55;
// How many steps one figure holds. Two things set it, and they land on the same number:
//  · the wide layout is shown down to a column of 640 px (the platform's threshold, #1079). Eight
//    steps make it 848 wide, and its 12 px labels are then 9 px on screen — the smallest that reads.
//  · eight steps at GAP apart and DURATION long end after 4.75 s, inside the five the animation has.
// A flow with more steps is two figures. That is a judgement about legibility, not a limit of the
// platform; change it here together with the layout, not by squeezing the labels.
const MAX_STEPS = 8;

const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What is wrong with the description, in the author's terms. Empty when it can be drawn. */
export function describeProblems(description) {
  const problems = [];
  const d = description ?? {};
  if (!/^[a-z0-9][a-z0-9-]*$/.test(d.name ?? "")) problems.push("`name` is the file name: lower-case letters, digits and hyphens");
  if (!String(d.title ?? "").trim()) problems.push("`title` is required — it is the figure's accessible name");
  if (!String(d.desc ?? "").trim()) problems.push("`desc` is required — one sentence saying what the figure shows");

  const phases = d.phases ?? {};
  for (const [name, phase] of Object.entries(phases)) {
    if (!PHASE_NAME.test(name) || name === "steg" || /^s\d+$/.test(name)) problems.push(`phase "${name}": the name is lower-case letters, digits and hyphens, and not "steg" or "s1", "s2", …`);
    for (const key of ["grunn", "lys"]) if (!HEX.test(phase?.[key] ?? "")) problems.push(`phase "${name}": \`${key}\` is an opaque hex colour (#rgb or #rrggbb)`);
    if (phase?.tekst !== undefined && !HEX.test(phase.tekst)) problems.push(`phase "${name}": \`tekst\` is an opaque hex colour`);
    if (phase?.label !== undefined && !String(phase.label).trim()) problems.push(`phase "${name}": \`label\` is empty — leave it out for a phase without a line`);
  }
  if (Object.keys(phases).length === 0) problems.push("`phases` needs at least one phase — give a flow without groups one phase without a `label`");

  const steps = Array.isArray(d.steps) ? d.steps : [];
  if (steps.length < 2) problems.push("`steps` needs at least two steps");
  steps.forEach((step, i) => {
    const lines = Array.isArray(step?.label) ? step.label : [];
    if (lines.length < 1 || lines.length > 2 || lines.some((line) => !String(line ?? "").trim())) problems.push(`step ${i + 1}: \`label\` is one or two short lines`);
    if (!Object.hasOwn(phases, step?.phase ?? "")) problems.push(`step ${i + 1}: phase "${step?.phase}" is not in \`phases\``);
  });
  const unused = Object.keys(phases).filter((name) => !steps.some((step) => step?.phase === name));
  if (unused.length > 0) problems.push(`phase(s) ${unused.map((n) => `"${n}"`).join(", ")} have no step`);
  if (steps.length > MAX_STEPS) problems.push(`${steps.length} steps is more than one figure holds (${MAX_STEPS}) — split the flow into two figures`);
  return problems;
}

function draw(description, layoutName) {
  const { steps, phases, title, desc } = description;
  const layout = LAYOUTS[layoutName];
  const perRow = Math.min(layout.perRow, steps.length);
  const rows = Math.ceil(steps.length / perRow);
  const width = 2 * layout.margin + (perRow - 1) * layout.spacing;
  const { r } = layout;
  const at = steps.map((_, i) => ({ cx: layout.margin + (i % perRow) * layout.spacing, cy: TOP + Math.floor(i / perRow) * layout.rowHeight, row: Math.floor(i / perRow) }));
  const out = [];

  // The phase lines: one piece per run of steps in the same phase on the same row.
  for (let i = 0; i < steps.length;) {
    let j = i;
    while (j + 1 < steps.length && steps[j + 1].phase === steps[i].phase && at[j + 1].row === at[i].row) j++;
    const phase = phases[steps[i].phase];
    if (phase.label !== undefined) {
      const y = at[i].cy - 32;
      const [x1, x2] = [at[i].cx - layout.phaseHalf, at[j].cx + layout.phaseHalf];
      out.push(`  <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${phase.lys}" stroke-width="3"/>`);
      out.push(`  <text x="${(x1 + x2) / 2}" y="${y - 5}" text-anchor="middle" font-size="11" fill="${phase.tekst ?? INK}">${xml(phase.label)}</text>`);
    }
    i = j + 1;
  }

  steps.forEach((step, i) => {
    const { cx, cy, row } = at[i];
    out.push(`  <circle class="steg s${i + 1} ${step.phase}" cx="${cx}" cy="${cy}" r="${r}"/>`);
    out.push(`  <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="600" fill="${INK}">${i + 1}</text>`);
    step.label.forEach((line, n) => {
      out.push(`  <text x="${cx}" y="${cy + r + 18 + n * 15}" text-anchor="middle" font-size="12" fill="${INK}">${xml(line)}</text>`);
    });
    if (i + 1 >= steps.length) return;
    const next = at[i + 1];
    if (next.row === row) {
      out.push(`  <line x1="${cx + r}" y1="${cy}" x2="${next.cx - r}" y2="${next.cy}" stroke="${CONNECTOR}" stroke-width="1.5"/>`);
    } else {
      // A new row: out to the right, down between the rows, back to the left edge and in to the next step.
      const between = cy + r + 44;
      out.push(`  <polyline points="${cx + r},${cy} ${width - 12},${cy} ${width - 12},${between} 12,${between} 12,${next.cy} ${next.cx - r},${next.cy}" fill="none" stroke="${CONNECTOR}" stroke-width="1.5"/>`);
    }
  });

  const height = TOP + (rows - 1) * layout.rowHeight + r + 46;
  const size = layout.shownAt ? ` width="${Math.round(width * layout.shownAt)}" height="${Math.round(height * layout.shownAt)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"${size} role="img"
     font-family="${FONT}">
  <title>${xml(title)}</title>
  <desc>${xml(desc)}</desc>
  <style>
    .steg { fill: var(--grunn); stroke: var(--lys); }
    @keyframes lys { 0%, 70% { fill: var(--lys); } 100% { fill: var(--grunn); } }
    .steg { animation: lys ${DURATION}s ease-in-out 1; }
${steps.slice(1).map((_, i) => `    .s${i + 2} { animation-delay: ${Number(((i + 1) * GAP).toFixed(2))}s; }`).join("\n")}
${Object.entries(phases).map(([name, phase]) => `    .${name} { --grunn: ${phase.grunn}; --lys: ${phase.lys}; }`).join("\n")}
    @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
  </style>
${out.join("\n")}
</svg>
`;
}

/**
 * Both layouts of one flow. Throws with every problem named when the description cannot be drawn,
 * or when a drawing does not pass the two figure checks.
 * @returns {{ wide: string, narrow: string }}
 */
export function drawFlowFigure(description) {
  const problems = describeProblems(description);
  if (problems.length > 0) throw new Error(`the description cannot be drawn:\n- ${problems.join("\n- ")}`);

  const figures = { wide: draw(description, "wide"), narrow: draw(description, "narrow") };
  for (const [layout, svg] of Object.entries(figures)) {
    const issues = [
      ...checkFigureMotion(svg).issues.map((issue) => `${issue.kind}: ${issue.detail}`),
      ...checkFigureFit(svg).issues.map((issue) => `${issue.kind} «${issue.text}»: ${issue.detail}`),
    ];
    if (issues.length > 0) throw new Error(`the ${layout} layout does not pass the figure checks — shorten the label or break it differently:\n- ${issues.join("\n- ")}`);
  }
  return figures;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const [descriptionFile, outDir] = process.argv.slice(2);
  if (!descriptionFile || !outDir) {
    console.error("usage: node draw-flow-figure.mjs description.json out-dir");
    process.exit(2);
  }
  try {
    const description = JSON.parse(readFileSync(descriptionFile, "utf8"));
    const { wide, narrow } = drawFlowFigure(description);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${description.name}.svg`), wide, "utf8");
    writeFileSync(join(outDir, `${description.name}.narrow.svg`), narrow, "utf8");
    console.log(`OK   ${description.name}.svg (${Buffer.byteLength(wide)} bytes), ${description.name}.narrow.svg (${Buffer.byteLength(narrow)} bytes)`);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  }
}
