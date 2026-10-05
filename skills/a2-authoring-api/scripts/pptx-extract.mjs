// Reads a PowerPoint file (.pptx) and says, slide by slide, what is on it and HOW it is laid out.
//
// A chat gives the model a deck as loose text. What made the deck a deck is gone: that four frames
// stand side by side, that a strip at the bottom is set apart, which icon belongs to which frame,
// what the speaker notes say, and every word that only exists inside a picture. This script reads
// the file itself and hands the model:
//
//   slides.json   every slide as data: title, layout, frames with heading/icon/lines, a flow's
//                 steps and phases, tables, SmartArt text, notes, pictures, colours
//   slides.md     the same, written to be read
//   images/       the pictures placed on slides (screenshots, infographics) — OPEN AND LOOK AT
//                 THESE: text inside a picture is not in slides.json
//   icons/        the deck's own SVG icons; single-colour icons drawn in a light colour (made for
//                 dark header bars) are written dark, so they show on a light page
//
// What it cannot do: read text inside a picture, or tell a decorative photo from a meaningful one.
// Both are the model's job, by looking.
//
// Node stdlib only (the zip is read by hand), pure functions, repo-tested. Usage:
//   node scripts/pptx-extract.mjs deck.pptx out-dir
//   import { readPresentation, describePresentation } from "./pptx-extract.mjs"

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const EMU_PER_POINT = 12700;
/** The colour a light, single-colour icon is rewritten in. The platform's text colour. */
const ICON_INK = "#33312b";

// ── zip ──────────────────────────────────────────────────────────────────────

function readZip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 65535; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("not a .pptx file (no zip directory found) — a .ppt from before 2007 must be saved as .pptx first");
  const count = buffer.readUInt16LE(end + 10);
  let p = buffer.readUInt32LE(end + 16);
  if (p === 0xffffffff) throw new Error("the file is larger than this reader handles (zip64)");
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error("the file is damaged (zip directory)");
    const method = buffer.readUInt16LE(p + 10), compressed = buffer.readUInt32LE(p + 20), size = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28), extra = buffer.readUInt16LE(p + 30), comment = buffer.readUInt16LE(p + 32), offset = buffer.readUInt32LE(p + 42);
    entries.set(buffer.toString("utf8", p + 46, p + 46 + nameLength), { method, compressed, size, offset });
    p += 46 + nameLength + extra + comment;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const nameLength = buffer.readUInt16LE(e.offset + 26), extra = buffer.readUInt16LE(e.offset + 28);
    const data = buffer.subarray(e.offset + 30 + nameLength + extra, e.offset + 30 + nameLength + extra + e.compressed);
    return e.method === 8 ? inflateRawSync(data) : Buffer.from(data);
  };
  return { entries, read, text: (name) => read(name)?.toString("utf8") ?? null };
}

function relationships(zip, path) {
  const dir = path.slice(0, path.lastIndexOf("/")), file = path.slice(path.lastIndexOf("/") + 1);
  const xml = zip.text(`${dir}/_rels/${file}.rels`) ?? "";
  const out = new Map();
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    if (!a.Id || !a.Target || a.TargetMode === "External") continue;
    const target = a.Target.startsWith("/") ? a.Target.slice(1) : new URL(a.Target, `http://x/${dir}/`).pathname.slice(1);
    out.set(a.Id, { type: (a.Type ?? "").split("/").pop(), target: decodeURIComponent(target) });
  }
  return out;
}

// ── xml helpers ──────────────────────────────────────────────────────────────

const unescape = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");

/** The paragraphs of a text body: text, list level, whether it is a bullet, whether it is all bold, largest font size. */
function paragraphs(xml) {
  return [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => {
    const runs = [...p[1].matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].map((r) => ({
      text: unescape([...r[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")),
      bold: /<a:rPr[^>]*\bb="1"/.test(r[1]),
      size: Number(/<a:rPr[^>]*\bsz="(\d+)"/.exec(r[1])?.[1] ?? 0) / 100,
    })).filter((r) => r.text.length > 0);
    return {
      text: runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim(),
      level: Number(/<a:pPr[^>]*\blvl="(\d)"/.exec(p[1])?.[1] ?? 0),
      bullet: /<a:buChar|<a:buAutoNum/.test(p[1]),
      bold: runs.length > 0 && runs.every((r) => r.bold),
      size: Math.max(0, ...runs.map((r) => r.size)),
    };
  }).filter((a) => a.text);
}

function themeColours(zip) {
  const xml = zip.text("ppt/theme/theme1.xml") ?? "";
  const colours = {};
  for (const m of xml.matchAll(/<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")/g)) colours[m[1]] = `#${(m[2] ?? m[3]).toLowerCase()}`;
  const alias = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
  return (name) => colours[alias[name] ?? name] ?? null;
}

/** The solid fill of a shape as hex, or null (no fill, a gradient, a picture). */
function fillOf(shapeXml, theme) {
  const properties = shapeXml.split("<p:txBody>")[0];
  if (/<a:noFill\/>/.test(/<p:spPr>[\s\S]*?<\/p:spPr>/.exec(properties)?.[0]?.split("<a:ln")[0] ?? "")) return null;
  const fill = /<a:solidFill>([\s\S]*?)<\/a:solidFill>/.exec(/<p:spPr>[\s\S]*?<\/p:spPr>/.exec(properties)?.[0]?.split("<a:ln")[0] ?? "")?.[1];
  if (!fill) return null;
  const hex = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(fill)?.[1];
  if (hex) return `#${hex.toLowerCase()}`;
  const name = /<a:schemeClr val="(\w+)"/.exec(fill)?.[1];
  return name ? theme(name) : null;
}

// ── shapes ───────────────────────────────────────────────────────────────────

const SHAPE_TAGS = new Set(["p:sp", "p:pic", "p:cxnSp", "p:graphicFrame"]);

/** Every shape on a slide, also those inside groups, with the group transforms that apply to it. */
function shapesOf(xml) {
  const out = [];
  const groups = [];
  let open = null;
  let depth = 0;
  for (const m of xml.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>/g)) {
    const [whole, closing, name, , selfClosing] = m;
    if (!closing) {
      if (!open && name === "p:grpSp") groups.push({ start: m.index, depth });
      if (!open && SHAPE_TAGS.has(name)) open = { name, start: m.index, depth };
      if (!selfClosing) depth++;
      continue;
    }
    depth--;
    if (open && name === open.name && depth === open.depth) {
      out.push({ tag: name.slice(2), xml: xml.slice(open.start, m.index + whole.length), groups: groups.map((g) => g.transform).filter(Boolean) });
      open = null;
    } else if (!open && name === "p:grpSp") {
      groups.pop();
    } else if (!open && name === "p:grpSpPr" && groups.length) {
      const group = groups.at(-1);
      const t = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>\s*<a:chOff x="(-?\d+)" y="(-?\d+)"\/>\s*<a:chExt cx="(\d+)" cy="(\d+)"\/>/.exec(xml.slice(group.start, m.index));
      if (t) group.transform = t.slice(1).map(Number);
    }
  }
  return out;
}

/** Position and size in points, on the slide (group transforms applied). Null when the shape inherits it from the layout. */
function boxOf(shape) {
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(shape.xml);
  if (!m) return null;
  let [x, y, w, h] = m.slice(1).map(Number);
  for (const [ox, oy, ex, ey, cx, cy, cw, ch] of [...shape.groups].reverse()) {
    x = ox + ((x - cx) * ex) / (cw || 1);
    y = oy + ((y - cy) * ey) / (ch || 1);
    w = (w * ex) / (cw || 1);
    h = (h * ey) / (ch || 1);
  }
  return { x: Math.round(x / EMU_PER_POINT), y: Math.round(y / EMU_PER_POINT), w: Math.round(w / EMU_PER_POINT), h: Math.round(h / EMU_PER_POINT) };
}

// ── pictures and icons ───────────────────────────────────────────────────────

/** Pixel size of a PNG or JPEG, or null. */
function pixelSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let p = 2;
    while (p + 9 < bytes.length && bytes[p] === 0xff) {
      const marker = bytes[p + 1], length = bytes.readUInt16BE(p + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: bytes.readUInt16BE(p + 7), height: bytes.readUInt16BE(p + 5) };
      p += 2 + length;
    }
  }
  return null;
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * An icon drawn in ONE light colour was made for a dark background and is invisible on a light
 * page. Such an icon is rewritten in a dark ink. An icon with several colours, or a dark one, is
 * left as it is.
 * @returns {{ svg: string, recoloured: boolean }}
 */
export function darkenLightIcon(svg) {
  const colours = new Set([...svg.matchAll(/(?:fill|stroke)\s*[:=]\s*"?\s*(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b/g)].map((m) => {
    const c = m[1].toLowerCase();
    return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
  }));
  if (colours.size !== 1) return { svg, recoloured: false };
  const [only] = colours;
  if (luminance(only) < 0.7) return { svg, recoloured: false };
  return { svg: svg.replace(/((?:fill|stroke)\s*[:=]\s*"?\s*)(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b/g, `$1${ICON_INK}`), recoloured: true };
}

// ── one slide ────────────────────────────────────────────────────────────────

const inside = (a, b) => a !== b && a.cx >= b.x && a.cx <= b.x + b.w && a.cy >= b.y && a.cy <= b.y + b.h;
const isBoxShape = (geometry) => /rect/i.test(geometry ?? "");

function readSlide(zip, path, number, size, theme) {
  const xml = zip.text(path) ?? "";
  const rels = relationships(zip, path);

  const shapes = shapesOf(xml).map((shape) => {
    const isPlaceholder = /<p:ph\b/.test(shape.xml);
    // A placeholder without its own position takes it from the layout (typically the title). Its
    // text counts; it is placed off the slide so it is never taken as the content of a frame.
    const box = boxOf(shape) ?? (isPlaceholder ? { x: -1, y: -1, w: 0, h: 0 } : null);
    if (!box) return null;
    let media = null;
    if (shape.tag === "pic") {
      const svg = /<asvg:svgBlip[^>]*r:embed="([^"]+)"/.exec(shape.xml)?.[1];
      const raster = /<a:blip[^>]*r:embed="([^"]+)"/.exec(shape.xml)?.[1];
      media = rels.get(svg ?? raster)?.target ?? null;
    }
    return {
      tag: shape.tag, ...box, cx: box.x + box.w / 2, cy: box.y + box.h / 2,
      geometry: /<a:prstGeom prst="(\w+)"/.exec(shape.xml)?.[1] ?? null,
      textBox: /<p:cNvSpPr[^>]*txBox="1"/.test(shape.xml),
      fill: shape.tag === "sp" ? fillOf(shape.xml, theme) : null,
      text: shape.tag === "sp" ? paragraphs(shape.xml) : [],
      placeholder: /<p:ph\b[^>]*type="(\w+)"/.exec(shape.xml)?.[1] ?? (isPlaceholder ? "body" : null),
      media,
      table: /<a:tbl>/.test(shape.xml)
        ? [...shape.xml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((row) => [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) => paragraphs(cell[0]).map((a) => a.text).join(" / ")))
        : null,
      smartArt: /dgm:relIds/.test(shape.xml),
    };
  }).filter(Boolean);

  // Footer, slide number and date say nothing about the slide's content.
  const isFooter = (s) => s.placeholder === "ftr" || s.placeholder === "sldNum" || s.placeholder === "dt" || (s.y > size.h * 0.9 && s.text.length <= 1);
  const textShapes = shapes.filter((s) => s.tag === "sp" && s.text.length > 0 && !isFooter(s));
  const icons = shapes.filter((s) => s.tag === "pic" && s.media?.toLowerCase().endsWith(".svg"));
  const pictures = shapes.filter((s) => s.tag === "pic" && s.media && !s.media.toLowerCase().endsWith(".svg"));
  const arrows = shapes.filter((s) => /Arrow/.test(s.geometry ?? ""));
  const connectors = shapes.filter((s) => s.tag === "cxnSp");

  // The title: the title placeholder — or, on a slide built from loose text boxes, the box in the
  // top quarter with the largest type.
  const placeholderTitle = shapes.find((s) => s.placeholder === "title" || s.placeholder === "ctrTitle");
  const looseTitle = placeholderTitle ? null : textShapes
    .filter((s) => !s.placeholder && s.y >= 0 && s.y < size.h * 0.25 && s.text.length <= 2)
    .sort((a, b) => Math.max(...b.text.map((t) => t.size)) - Math.max(...a.text.map((t) => t.size)) || a.y - b.y)[0] ?? null;
  const titleShape = placeholderTitle ?? looseTitle;
  const subtitleShape = shapes.find((s) => s.placeholder === "subTitle") ?? (titleShape
    ? textShapes.filter((s) => s !== titleShape && (s.textBox || s.placeholder || !isBoxShape(s.geometry)) && !s.fill && s.y > titleShape.y && s.y < size.h * 0.3 && s.text.length === 1).sort((a, b) => a.y - b.y)[0]
    : null) ?? null;

  // A flow: at least three circles of one size on one line, with arrows between. Each step is the
  // circle, the icon in it, and the text in the column under it (name first, explanation after).
  const circles = shapes.filter((s) => s.tag === "sp" && s.geometry === "ellipse" && s.w > 20 && Math.abs(s.w - s.h) < 4);
  let flow = null;
  if (circles.length >= 3 && arrows.length >= 2) {
    const line = circles.filter((c) => Math.abs(c.cy - circles[0].cy) < 12 && Math.abs(c.w - circles[0].w) < 6).sort((a, b) => a.cx - b.cx);
    if (line.length >= 3) {
      const spacing = (line.at(-1).cx - line[0].cx) / (line.length - 1);
      const column = (s, c) => Math.abs(s.cx - c.cx) < spacing / 2;
      const steps = line.map((circle) => {
        const below = textShapes.filter((s) => s !== circle && !s.placeholder && column(s, circle) && s.y >= circle.y + circle.h - 2 && s.w < spacing * 1.6).sort((a, b) => a.y - b.y);
        const lines = [...circle.text, ...below.flatMap((s) => s.text)].map((t) => t.text);
        return { label: lines[0] ?? "", description: lines.slice(1).join(" "), icon: icons.find((i) => inside(i, circle))?.media.split("/").pop() ?? null, colour: circle.fill };
      });
      // A phase is a labelled band above the steps; it covers the steps whose centre it spans.
      const phases = textShapes
        .filter((s) => !s.placeholder && s !== titleShape && s !== subtitleShape && isBoxShape(s.geometry) && s.fill && s.y + s.h <= line[0].y + 2 && s.y > (titleShape?.y ?? 0) && s.w > 30)
        .map((band) => ({ name: band.text[0].text, colour: band.fill, steps: line.map((c, i) => (c.cx >= band.x && c.cx <= band.x + band.w ? i + 1 : 0)).filter(Boolean) }))
        .filter((phase) => phase.steps.length > 0)
        .sort((a, b) => a.steps[0] - b.steps[0]);
      flow = { steps, phases };
    }
  }
  const inFlow = new Set();
  if (flow) for (const s of shapes) if (circles.includes(s) || arrows.includes(s)) inFlow.add(s);

  // Columns built from the layout's placeholders: a one-line heading with a body right under it,
  // same left edge and width. The frame around them is drawn by the layout, not the slide, so
  // there is no box shape to find — but two or more such pairs at one height are frames side by side.
  const pairs = [];
  for (const head of textShapes.filter((s) => s.placeholder && s !== titleShape && s !== subtitleShape && s.text.length === 1 && s.w > 0)) {
    const body = textShapes.find((s) => s !== head && s.placeholder && Math.abs(s.x - head.x) < 12 && Math.abs(s.w - head.w) < 16 && Math.abs(s.y - (head.y + head.h)) < 16);
    if (body) pairs.push({ head, body });
  }
  const columnPairs = pairs.filter((pair) => pairs.filter((other) => Math.abs(other.head.y - pair.head.y) < 12).length >= 2);
  const inColumn = new Set(columnPairs.flatMap((pair) => [pair.head, pair.body]));

  // Frames: box shapes that hold other content, or that carry several paragraphs themselves. A
  // frame inside a larger frame is part of the larger one.
  const candidates = shapes.filter((s) => s.tag === "sp" && isBoxShape(s.geometry) && !s.textBox && s.w > 60 && s.h > 40 && !s.placeholder);
  // An empty box drawn around one column marks it as the one in focus; it is not a frame of its own.
  const highlights = candidates.filter((c) => c.text.length === 0 && columnPairs.some((pair) => inside(pair.head, c)) && !shapes.some((s) => inside(s, c) && s.text.length > 0 && !inColumn.has(s)));
  const holds = (frame) => shapes.some((s) => inside(s, frame) && (s.text.length > 0 || s.tag === "pic"));
  const frameShapes = candidates.filter((c) => !highlights.includes(c) && (holds(c) || c.text.length >= 2) && !candidates.some((outer) => outer !== c && !highlights.includes(outer) && inside(c, outer) && outer.w * outer.h > c.w * c.h && (holds(outer) || outer.text.length >= 2)));
  const frames = frameShapes.map((frame) => {
    const content = shapes.filter((s) => inside(s, frame)).sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [...frame.text, ...content.flatMap((s) => s.text)];
    return {
      x: frame.x, y: frame.y, w: frame.w, h: frame.h,
      heading: lines[0]?.text ?? "",
      colour: content.find((s) => s.tag === "sp" && s.fill && s.text.length > 0 && s.y - frame.y < 6)?.fill ?? frame.fill,
      icons: content.filter((s) => s.tag === "pic" && s.media?.toLowerCase().endsWith(".svg")).map((s) => s.media.split("/").pop()),
      lines: lines.slice(1).map((a) => ({ text: a.text, bullet: a.bullet, bold: a.bold, level: a.level })),
    };
  });
  for (const { head, body } of columnPairs) {
    frames.push({
      x: head.x, y: head.y, w: head.w, h: head.h + body.h,
      heading: head.text[0].text,
      colour: null,
      icons: [],
      lines: body.text.map((a) => ({ text: a.text, bullet: a.bullet, bold: a.bold, level: a.level })),
      ...(highlights.some((box) => inside(head, box)) ? { highlighted: true } : {}),
    });
  }
  // Frames at the same height and of the same size stand side by side: a row.
  const rows = [];
  for (const frame of [...frames].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0].y - frame.y) < 12 && Math.abs(r[0].h - frame.h) < 16);
    if (row) row.push(frame); else rows.push([frame]);
  }

  const inFrame = (s) => inColumn.has(s) || frameShapes.includes(s) || frameShapes.some((f) => inside(s, f));
  const flowText = new Set(flow ? flow.steps.flatMap((s) => [s.label, s.description]).concat(flow.phases.map((p) => p.name)) : []);
  const loose = textShapes
    .filter((s) => s !== titleShape && s !== subtitleShape && !inFrame(s))
    .flatMap((s) => s.text.map((t) => t.text))
    .filter((text) => !flowText.has(text) && ![...flowText].some((known) => known.includes(text)));

  const notesRel = [...rels.values()].find((r) => r.type === "notesSlide");
  const notesXml = notesRel ? zip.text(notesRel.target) ?? "" : "";
  const notesBody = /<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph\b[^>]*type="body"[\s\S]*?<\/p:sp>/.exec(notesXml)?.[0] ?? "";

  const smartArt = [...rels.values()].filter((r) => r.type === "diagramData").flatMap((r) =>
    [...(zip.text(r.target) ?? "").matchAll(/<dgm:pt\b[\s\S]*?<\/dgm:pt>/g)].map((point) => paragraphs(point[0]).map((a) => a.text).join(" ")).filter(Boolean));

  const colourUse = new Map();
  for (const s of shapes) if (s.fill && s.fill !== "#ffffff") colourUse.set(s.fill, (colourUse.get(s.fill) ?? 0) + 1);

  // The layout, said in words: what is on the slide, not a guess at what it means.
  const layout = [];
  const tables = shapes.filter((s) => s.table).map((s) => s.table);
  for (const table of tables) layout.push(`table (${table.length} rows × ${table[0]?.length ?? 0} columns)`);
  if (flow) layout.push(`flow: ${flow.steps.length} steps in a row${flow.phases.length ? `, grouped in ${flow.phases.length} phases` : ""}${flow.steps.every((s) => s.icon) ? ", each with an icon" : ""}`);
  else if (arrows.length >= 2) layout.push(`${arrows.length} arrows between shapes (a sequence)`);
  for (const row of rows.filter((r) => r.length >= 2)) layout.push(`${row.length} frames side by side${row.every((f) => f.icons.length) ? ", each with an icon" : ""}`);
  for (const row of rows.filter((r) => r.length === 1 && r[0].w > size.w * 0.6)) layout.push(`one wide strip ("${row[0].heading.slice(0, 28)}")`);
  if (smartArt.length) layout.push(`SmartArt with ${smartArt.length} items`);
  if (pictures.length) layout.push(`${pictures.length} picture${pictures.length > 1 ? "s" : ""} — look at ${pictures.length > 1 ? "them" : "it"}: text inside a picture is not read here`);
  if (!layout.length) layout.push(textShapes.reduce((n, s) => n + s.text.length, 0) > 3 ? "text" : "title or divider slide");

  return {
    number,
    title: titleShape?.text.map((t) => t.text).join(" ") ?? "",
    subtitle: subtitleShape?.text.map((t) => t.text).join(" ") ?? "",
    layout,
    flow,
    frames: rows,
    tables,
    smartArt,
    text: loose,
    notes: paragraphs(notesBody).map((a) => a.text).join(" "),
    pictures: pictures.map((s) => ({ media: s.media, x: s.x, y: s.y, w: s.w, h: s.h })),
    icons: [...new Set(icons.map((s) => s.media.split("/").pop()))],
    colours: [...colourUse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([hex, uses]) => ({ hex, uses })),
    words: shapes.flatMap((s) => s.text).map((t) => t.text).join(" ").split(/\s+/).filter(Boolean).length,
  };
}

// ── the presentation ─────────────────────────────────────────────────────────

/**
 * @param {Buffer} buffer  the .pptx file
 * @returns {{ size: { w: number, h: number }, slides: object[], images: object[], icons: object[] }}
 */
export function readPresentation(buffer) {
  const zip = readZip(buffer);
  const presentation = zip.text("ppt/presentation.xml");
  if (!presentation) throw new Error("not a PowerPoint file (ppt/presentation.xml is missing)");
  const rels = relationships(zip, "ppt/presentation.xml");
  const order = [...presentation.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => rels.get(m[1])?.target).filter(Boolean);
  if (order.length === 0) throw new Error("the presentation has no slides");
  const sz = /<p:sldSz\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presentation);
  const size = { w: Math.round(Number(sz?.[1] ?? 12192000) / EMU_PER_POINT), h: Math.round(Number(sz?.[2] ?? 6858000) / EMU_PER_POINT) };
  const theme = themeColours(zip);

  const slides = order.map((path, i) => readSlide(zip, path, i + 1, size, theme));

  // Pictures: one file per place a picture stands, named after the slide so the model can match them.
  const images = [];
  for (const slide of slides) {
    slide.pictures = slide.pictures.map((picture, i) => {
      const bytes = zip.read(picture.media);
      const extension = picture.media.slice(picture.media.lastIndexOf(".")).toLowerCase();
      const file = `slide-${String(slide.number).padStart(2, "0")}-${i + 1}${extension}`;
      if (bytes) images.push({ file, slide: slide.number, bytes, kB: Math.round(bytes.length / 1024), ...(pixelSize(bytes) ?? {}) });
      return { file, kB: bytes ? Math.round(bytes.length / 1024) : 0, ...(bytes ? pixelSize(bytes) ?? {} : {}), x: picture.x, y: picture.y, w: picture.w, h: picture.h };
    });
  }
  const icons = [];
  for (const name of new Set(slides.flatMap((s) => s.icons))) {
    const source = zip.text(`ppt/media/${name}`);
    if (!source) continue;
    const { svg, recoloured } = darkenLightIcon(source);
    icons.push({ file: name, svg, recoloured, slides: slides.filter((s) => s.icons.includes(name)).map((s) => s.number) });
  }
  return { size, slides, images, icons };
}

/** The presentation written to be read: one section per slide. */
export function describePresentation(presentation, { name = "presentation" } = {}) {
  const out = [`# ${name} — ${presentation.slides.length} slides`, "", "Text inside pictures is NOT in this file. Open each file under `images/` and read it.", ""];
  for (const slide of presentation.slides) {
    out.push(`## Slide ${slide.number}: ${slide.title || "(no title)"}`);
    if (slide.subtitle) out.push(`*${slide.subtitle}*`);
    out.push(`**Layout:** ${slide.layout.join(" · ")}`);
    if (slide.flow) {
      for (const phase of slide.flow.phases) out.push(`- phase **${phase.name}**${phase.colour ? ` (${phase.colour})` : ""}: steps ${phase.steps.join(", ")}`);
      slide.flow.steps.forEach((step, i) => out.push(`${i + 1}. **${step.label}**${step.icon ? ` [icon: ${step.icon}]` : ""}${step.description ? ` — ${step.description}` : ""}`));
    }
    for (const row of slide.frames) {
      for (const frame of row) {
        out.push(`- **${frame.heading}**${frame.highlighted ? " ← the one in focus on this slide" : ""}${frame.colour ? ` (${frame.colour})` : ""}${frame.icons.length ? ` [icon: ${frame.icons.join(", ")}]` : ""}`);
        for (const line of frame.lines) out.push(`    ${"  ".repeat(line.level)}${line.bullet ? "• " : ""}${line.bold ? `**${line.text}**` : line.text}`);
      }
    }
    for (const table of slide.tables) out.push("", ...table.map((row) => `| ${row.join(" | ")} |`), "");
    if (slide.smartArt.length) out.push(`**SmartArt:** ${slide.smartArt.join(" · ")}`);
    if (slide.text.length) out.push(`**Other text:** ${slide.text.join(" · ")}`);
    for (const picture of slide.pictures) out.push(`**Picture:** images/${picture.file} (${picture.kB} kB${picture.width ? `, ${picture.width}×${picture.height} px` : ""}) — look at it`);
    if (slide.notes) out.push(`**Speaker notes:** ${slide.notes}`);
    out.push("");
  }
  return out.join("\n");
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const [file, outDir] = process.argv.slice(2);
  if (!file || !outDir) {
    console.error("usage: node scripts/pptx-extract.mjs deck.pptx out-dir");
    process.exit(2);
  }
  try {
    const presentation = readPresentation(readFileSync(file));
    mkdirSync(join(outDir, "images"), { recursive: true });
    mkdirSync(join(outDir, "icons"), { recursive: true });
    for (const image of presentation.images) writeFileSync(join(outDir, "images", image.file), image.bytes);
    for (const icon of presentation.icons) writeFileSync(join(outDir, "icons", icon.file), icon.svg, "utf8");
    const name = file.replace(/\\/g, "/").split("/").pop();
    const data = { ...presentation, images: presentation.images.map(({ bytes: _bytes, ...rest }) => rest), icons: presentation.icons.map(({ svg: _svg, ...rest }) => rest) };
    writeFileSync(join(outDir, "slides.json"), JSON.stringify(data, null, 2), "utf8");
    writeFileSync(join(outDir, "slides.md"), describePresentation(presentation, { name }), "utf8");
    console.log(`OK   ${presentation.slides.length} slides · ${presentation.images.length} pictures in images/ · ${presentation.icons.length} icons in icons/ (${presentation.icons.filter((i) => i.recoloured).length} made dark)`);
    console.log("     Read slides.md, then OPEN EVERY FILE under images/ — text inside pictures is not in slides.md.");
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exit(1);
  }
}
