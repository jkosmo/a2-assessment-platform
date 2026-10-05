// Did every slide get what the approved slide list says?
//
// At gate 3 the author approves, per slide, what it becomes: a figure, cards, a prompt, a picture,
// or left out — with a reason. That list is saved as work/treatment.json. This script reads it
// beside the assembled package and reports every slide where the course does not hold what the
// list promised: a section that is not there, a figure that was planned and not drawn, an
// expression from the slide that is not in the text, a picture that was listed and not included.
//
// It checks FORM and PRESENCE. It cannot tell whether the section says what the slide meant — that
// is the author's reading at gate 4 and the independent check at gate 5.
//
// usage: node scripts/slide-coverage.mjs work/treatment.json work/package.json [work/deck]
//
// Node stdlib only.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractSvgTextRuns } from "./localization-check.mjs";
import { SVG_MIME, assetFileName, assetMimeType } from "./package-assets.mjs";

/** What a slide can become. `omitted` stands alone and needs a reason. */
export const FORMS = Object.freeze([
  "figure",
  "cards",
  "callout",
  "prompt",
  "table",
  "image",
  "text",
  "objectives",
  "task",
  "omitted",
]);
// Forms that can only stand in a section.
const SECTION_FORMS = new Set(["figure", "cards", "callout", "prompt", "table", "image", "text"]);
// A group of cards is at least two.
const CARDS_PER_GROUP = 2;
const NOT_PROSE = new Set(["contentBase64", "file", "filename", "mimeType", "sourceId", "sizeBytes"]);

function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[*_`«»“”„"'’]/g, "")
    .replace(/\p{Pd}/gu, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) if (!NOT_PROSE.has(key)) strings(item, out);
  }
  return out;
}

function svgSource(asset, baseDir) {
  if (typeof asset?.contentBase64 === "string") return Buffer.from(asset.contentBase64, "base64").toString("utf8");
  if (typeof asset?.file === "string") {
    try {
      return readFileSync(path.resolve(baseDir, asset.file), "utf8");
    } catch {
      return "";
    }
  }
  return "";
}

function primaryMarkdown(payload, primary) {
  const body = payload?.bodyMarkdown;
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  return body[primary] ?? Object.values(body).find((v) => typeof v === "string") ?? "";
}

/**
 * What a markdown text holds, counted by form. Fenced blocks are taken out before the rest is
 * counted: a table typed inside a prompt is part of the prompt.
 */
export function countForms(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const outside = [];
  let fences = 0;
  let open = null;
  for (const line of lines) {
    const fence = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence && (open === null || fence[1][0] === open)) {
      if (open === null) {
        open = fence[1][0];
        fences += 1;
      } else open = null;
      continue;
    }
    if (open === null) outside.push(line);
  }

  let tables = 0;
  let callouts = 0;
  let cards = 0;
  let inQuote = false;
  for (const line of outside) {
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)) tables += 1;
    if (/^#{3,4}\s+\S/.test(line)) cards += 1;
    const quoted = /^\s{0,3}>/.test(line);
    if (quoted && !inQuote && /^\s{0,3}>\s*\*\*[^*]+\*\*/.test(line)) callouts += 1;
    inQuote = quoted;
  }
  return { prompt: fences, table: tables, callout: callouts, cards };
}

/** One row per object in the package: what kind it is, and what it holds. */
export function describeObjects(pkg, { baseDir = "." } = {}) {
  const primary = typeof pkg?.locale === "string" ? pkg.locale : "nb";
  const objects = new Map();
  for (const object of pkg?.objects ?? []) {
    if (typeof object?.clientRef !== "string") continue;
    const assets = object.type === "section" && Array.isArray(object.payload?.assets) ? object.payload.assets : [];
    const markdown = object.type === "section" ? primaryMarkdown(object.payload, primary) : "";
    const shown = new Set([...markdown.matchAll(/\]\(asset:([^)\s]+)\)/g)].map((m) => m[1]));
    const labels = [];
    let figures = 0;
    const pictures = new Map();
    for (const asset of assets) {
      if (assetMimeType(asset) === SVG_MIME) {
        // A figure says something: it has labels. An icon is an SVG too, and has none.
        const runs = extractSvgTextRuns(svgSource(asset, baseDir));
        labels.push(...runs);
        if (runs.length > 0 && shown.has(asset.sourceId)) figures += 1;
      } else {
        const name = assetFileName(asset);
        if (name) pictures.set(name, { shown: shown.has(asset.sourceId), sourceId: asset.sourceId });
      }
    }
    objects.set(object.clientRef, {
      type: object.type,
      text: fold([...strings(object.payload), ...labels].join(" ")),
      have: { ...countForms(markdown), figure: figures },
      pictures,
    });
  }
  return objects;
}

/**
 * @param {{ slides?: Array<object> }} treatment the approved slide list
 * @param {object} pkg the assembled package (pictures as `file` or attached)
 * @param {{ deck?: { slides: Array<{ number: number, pictures?: Array<{ file: string }> }> } | null, baseDir?: string }} [options]
 *   `deck` is slides.json from pptx-extract: with it, a slide or a picture that the list does not
 *   mention at all is reported too.
 * @returns {{ ok: boolean, rows: Array<{ slide: unknown, becomes: string[], in: string | null, problems: string[] }>, problems: string[] }}
 */
export function checkSlideCoverage(treatment, pkg, { deck = null, baseDir = "." } = {}) {
  const problems = [];
  const rows = [];
  const list = Array.isArray(treatment?.slides) ? treatment.slides : [];
  if (list.length === 0) problems.push("the slide list has no slides — save the list approved at gate 3 as { \"slides\": [ … ] }");

  const objects = describeObjects(pkg, { baseDir });
  const used = new Map(); // "<ref> <form>" -> how many slides have claimed one so far
  const listedPictures = new Map(); // "<ref> <file>" -> true

  for (const entry of list) {
    const row = { slide: entry?.slide, becomes: [], in: typeof entry?.in === "string" ? entry.in : null, problems: [] };
    rows.push(row);
    const fail = (message) => row.problems.push(message);

    if (!Number.isInteger(entry?.slide) || entry.slide < 1) fail("`slide` must be the slide's number");
    const becomes = Array.isArray(entry?.becomes) ? entry.becomes : [];
    row.becomes = becomes.filter((form) => typeof form === "string");
    if (becomes.length === 0) {
      fail("`becomes` is empty — say what the slide becomes, or [\"omitted\"] with a reason");
      continue;
    }
    const unknown = becomes.filter((form) => !FORMS.includes(form));
    if (unknown.length > 0) {
      fail(`unknown form: ${unknown.join(", ")} — use ${FORMS.join(", ")}`);
      continue;
    }

    if (becomes.includes("omitted")) {
      if (becomes.length > 1) fail("`omitted` stands alone — a slide that gives the course anything is not omitted");
      if (typeof entry.why !== "string" || entry.why.trim().length === 0) fail("an omitted slide needs `why`");
      continue;
    }

    const needsPlace = becomes.some((form) => form !== "objectives");
    if (!row.in) {
      if (needsPlace) fail("`in` is missing — the clientRef of the section or module the slide went into");
      continue;
    }
    const target = objects.get(row.in);
    if (!target) {
      fail(`"${row.in}" is not in the package`);
      continue;
    }
    const sectionForms = becomes.filter((form) => SECTION_FORMS.has(form));
    if (sectionForms.length > 0 && target.type !== "section") {
      fail(`${sectionForms.join(", ")} can only stand in a section, and "${row.in}" is a ${target.type}`);
      continue;
    }
    if (becomes.includes("task") && target.type !== "module") fail(`a task belongs in a module, and "${row.in}" is a ${target.type}`);

    for (const form of ["figure", "cards", "callout", "prompt", "table"]) {
      if (!becomes.includes(form)) continue;
      const key = `${row.in} ${form}`;
      const nth = (used.get(key) ?? 0) + 1;
      used.set(key, nth);
      const per = form === "cards" ? CARDS_PER_GROUP : 1;
      const have = target.have[form];
      if (have >= nth * per) continue;
      const what = {
        figure: "figure with labels shown in the text",
        cards: "card heading (### …)",
        callout: "highlighted box (> **Label:** …)",
        prompt: "prompt box (a fenced block)",
        table: "table",
      }[form];
      fail(
        nth === 1
          ? `was to become ${form}, and "${row.in}" has ${have} ${what}${have === 1 ? "" : "s"}${form === "cards" ? " — a group of cards is at least two" : ""}`
          : `is slide number ${nth} that was to become ${form} in "${row.in}", which has ${have} ${what}${have === 1 ? "" : "s"}`,
      );
    }

    const images = Array.isArray(entry.images) ? entry.images : [];
    if (becomes.includes("image") && images.length === 0) fail("was to become image, and `images` lists no file");
    if (!becomes.includes("image") && images.length > 0) fail("`images` lists files, and `becomes` does not include image");
    for (const file of images) {
      listedPictures.set(`${row.in} ${file}`, true);
      const picture = target.pictures.get(file);
      if (!picture) fail(`the picture ${file} is not in "${row.in}"`);
      else if (!picture.shown) fail(`the picture ${file} is in "${row.in}" and is not shown in the text`);
    }

    for (const phrase of Array.isArray(entry.phrases) ? entry.phrases : []) {
      const wanted = fold(phrase);
      if (wanted && !target.text.includes(wanted)) fail(`not found in "${row.in}": «${phrase}»`);
    }
  }

  // The other way round: a picture in the course that no slide lists was never shown to the author.
  for (const [ref, object] of objects) {
    for (const file of object.pictures.keys()) {
      if (!listedPictures.has(`${ref} ${file}`)) problems.push(`the picture ${file} is in "${ref}" and no slide lists it under \`images\``);
    }
  }

  if (deck && Array.isArray(deck.slides)) {
    const bySlide = new Map();
    for (const entry of list) {
      if (!bySlide.has(entry?.slide)) bySlide.set(entry?.slide, []);
      bySlide.get(entry?.slide).push(entry);
    }
    for (const slide of deck.slides) {
      const entries = bySlide.get(slide.number) ?? [];
      if (entries.length === 0) {
        problems.push(`slide ${slide.number} has no row in the slide list`);
        continue;
      }
      for (const picture of slide.pictures ?? []) {
        const accounted = entries.some((entry) => {
          const leftOut = entry.imagesLeftOut && typeof entry.imagesLeftOut === "object" ? entry.imagesLeftOut : {};
          const reason = leftOut[picture.file];
          return (entry.images ?? []).includes(picture.file) || (typeof reason === "string" && reason.trim().length > 0);
        });
        if (!accounted) {
          problems.push(`slide ${slide.number}: the picture ${picture.file} is neither in \`images\` nor in \`imagesLeftOut\` with a reason`);
        }
      }
    }
    const last = deck.slides.length;
    for (const row of rows) {
      if (Number.isInteger(row.slide) && row.slide > last) row.problems.push(`the presentation has ${last} slides`);
    }
  }

  return { ok: problems.length === 0 && rows.every((row) => row.problems.length === 0), rows, problems };
}

/** The report, one line per slide. */
export function formatCoverage(result) {
  const out = [];
  for (const row of result.rows) {
    const where = row.in ? ` → ${row.in}` : "";
    out.push(`${row.problems.length === 0 ? "OK  " : "FAIL"} slide ${row.slide}: ${row.becomes.join(", ") || "(nothing)"}${where}`);
    for (const problem of row.problems) out.push(`  - ${problem}`);
  }
  for (const problem of result.problems) out.push(`FAIL ${problem}`);
  const failed = result.rows.filter((row) => row.problems.length > 0).length + result.problems.length;
  out.push(result.ok ? `OK   ${result.rows.length} rows, every slide has what the list says` : `FAIL ${failed} thing(s) to fix — or change the list with the author's consent`);
  return out.join("\n");
}

/** slides.json from the reader, when it is where the workflow puts it. */
export function readDeck(deckDir) {
  const file = deckDir && path.join(deckDir, "slides.json");
  if (!file || !existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed?.slides) ? parsed : null;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const [treatmentFile, packageFile, deckArg] = process.argv.slice(2);
  if (!treatmentFile || !packageFile) {
    console.error("usage: node scripts/slide-coverage.mjs work/treatment.json work/package.json [work/deck]");
    process.exit(2);
  }
  const deckDir = deckArg ?? path.join(path.dirname(treatmentFile), "deck");
  const deck = readDeck(deckDir);
  if (deckArg && !deck) {
    console.error(`FAIL no slides.json in ${deckArg}`);
    process.exit(2);
  }
  console.log(deck ? `Checked against ${path.join(deckDir, "slides.json")}: every slide and every picture must be in the list.` : "No slides.json found: checking only the slides the list names.");
  const result = checkSlideCoverage(JSON.parse(readFileSync(treatmentFile, "utf8")), JSON.parse(readFileSync(packageFile, "utf8")), {
    deck,
    baseDir: path.dirname(packageFile),
  });
  console.log(formatCoverage(result));
  process.exit(result.ok ? 0 : 1);
}
