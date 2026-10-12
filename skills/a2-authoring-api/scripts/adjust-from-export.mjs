// adjust-from-export.mjs — turns a course export from the platform into the skill's working set,
// so a published course can be ADJUSTED rather than rewritten (#1095, phase B).
//
//   node scripts/adjust-from-export.mjs <export.json> work
//
// Writes, under work/:
//   package.json        the course as an a2-authoring-package/v1 — every section as files (one per
//                       language), every picture as a file, every module inline; each object and the
//                       course carry `origin` (the platform's ids), which production copies into the
//                       import file so the platform updates the SAME course
//   sections/<ref>.<lang>.md, assets/<ref>/<file>   the texts and the pictures
//   course-state.json   every element APPROVED as it stands — the export is the approved baseline
//   changes.json        the change list, every element "unchanged" until the author says otherwise
//   baseline.json       a copy of the export, which production compares the finished file against
//
// Why a script: the file has three languages, inline base64 pictures and the platform's ids. Written
// out by hand, something always drifts — and then "unchanged" is no longer unchanged.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ASSET_MIME } from "./package-assets.mjs";

const LANGUAGE_ORDER = ["nb", "nn", "en-GB"];
const EXT_BY_MIME = Object.freeze(Object.fromEntries(Object.entries(ASSET_MIME).map(([ext, mime]) => [mime, ext])));

/** A clientRef from a title: a–z, 0–9 and -, at most 64 characters. */
export function slugify(text, fallback = "element") {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function primaryLanguageOf(value) {
  if (!value || typeof value !== "object") return null;
  return LANGUAGE_ORDER.find((language) => typeof value[language] === "string" && value[language].trim()) ?? Object.keys(value)[0] ?? null;
}

function textIn(value, language) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value[language] ?? Object.values(value).find((v) => typeof v === "string") ?? "";
  return "";
}

/** Strip `audit` everywhere — the platform rebuilds it; the package never carries publish history. */
function withoutAudit(value) {
  if (Array.isArray(value)) return value.map(withoutAudit);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === "audit") continue;
      out[key] = withoutAudit(inner);
    }
    return out;
  }
  return value;
}

/** The label text of an SVG figure, for the course state: what the author approved in the drawing. */
function svgLabels(contentBase64) {
  try {
    const svg = Buffer.from(String(contentBase64 ?? ""), "base64").toString("utf8");
    const runs = [];
    for (const match of svg.matchAll(/<(?:text|tspan)\b[^>]*>([^<]*)<\//g)) {
      const label = match[1].replace(/\s+/g, " ").trim();
      if (label) runs.push(label);
    }
    return runs;
  } catch {
    return [];
  }
}

function fileNameFor(asset, index) {
  const given = typeof asset.filename === "string" && asset.filename.trim() ? path.basename(asset.filename.trim()) : "";
  const ext = EXT_BY_MIME[asset.mimeType] ?? (given ? path.extname(given) : "") ?? "";
  const stem = (given ? given.replace(/\.[^.]*$/, "") : "") || `${asset.sourceId || "bilde"}`;
  return `${slugify(stem, `bilde-${index + 1}`)}${ext || path.extname(given) || ""}`;
}

/**
 * Convert an export envelope into the working set. Pure apart from `write`, so it can be tested
 * without touching the disk.
 * @param {object} envelope an a2-content-export/v1 course envelope, as the platform wrote it
 * @param {{ outDir: string, baselineFile?: string, write?: (file: string, data: string | Buffer) => void }} options
 */
export function convertExport(envelope, { outDir, baselineFile = "baseline.json", write = defaultWrite } = {}) {
  const problems = [];
  const course = envelope?.course?.course;
  if (envelope?.exportFormat !== "a2-content-export/v1" || envelope?.scope !== "course" || !course) {
    return { ok: false, problems: ["this is not a course export (a2-content-export/v1 with scope \"course\")"] };
  }
  const items = [...(course.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (items.length === 0) problems.push("the course has no items");
  if (!course.origin?.courseId) {
    problems.push("the file has no `origin` — it was not exported from the platform (2.88.0 or newer), or it is a file from the «lag kurs» workflow; adjusting needs the platform's own export");
  }
  const primaryLanguage = primaryLanguageOf(course.title) ?? primaryLanguageOf(items.find((i) => i.type === "SECTION")?.section?.title) ?? "nb";

  const usedRefs = new Set();
  const uniqueRef = (base) => {
    let ref = base;
    let n = 2;
    while (usedRefs.has(ref)) ref = `${base.slice(0, 60)}-${n++}`;
    usedRefs.add(ref);
    return ref;
  };

  const objects = [];
  const elements = [];
  const order = [];
  const files = [];
  const put = (relative, data) => {
    files.push(relative);
    write(path.join(outDir, relative), data);
  };

  items.forEach((item, index) => {
    const number = String(index + 1).padStart(2, "0");
    if (item.type === "SECTION" && item.section) {
      const section = item.section;
      const ref = uniqueRef(`sec-${number}-${slugify(textIn(section.title, primaryLanguage))}`);
      const body = typeof section.bodyMarkdown === "string" ? { [primaryLanguage]: section.bodyMarkdown } : (section.bodyMarkdown ?? {});
      const bodyFiles = {};
      for (const language of Object.keys(body)) {
        if (typeof body[language] !== "string") continue;
        const file = `sections/${ref}.${language}.md`;
        put(file, body[language]);
        bodyFiles[language] = file;
      }
      const assets = [];
      const figures = [];
      (section.assets ?? []).forEach((asset, assetIndex) => {
        const name = fileNameFor(asset, assetIndex);
        const stem = name.replace(/\.[^.]*$/, "");
        const ext = path.extname(name);
        const dir = `assets/${ref}`;
        const entry = { sourceId: asset.sourceId, file: `${dir}/${name}` };
        put(entry.file, Buffer.from(String(asset.contentBase64 ?? ""), "base64"));
        if (asset.mimeType && ASSET_MIME[ext] !== asset.mimeType) entry.mimeType = asset.mimeType;
        if (asset.sourceLocale) entry.sourceLocale = asset.sourceLocale;
        if (Array.isArray(asset.localizedVariants) && asset.localizedVariants.length > 0) {
          entry.localizedVariants = asset.localizedVariants.map((variant) => {
            const file = `${dir}/${stem}.${variant.locale}${ext}`;
            put(file, Buffer.from(String(variant.contentBase64 ?? ""), "base64"));
            return { locale: variant.locale, file };
          });
        }
        if (Array.isArray(asset.layoutVariants) && asset.layoutVariants.length > 0) {
          entry.layoutVariants = asset.layoutVariants.map((layout) => {
            const file = `${dir}/${stem}.${layout.layout}${ext}`;
            put(file, Buffer.from(String(layout.contentBase64 ?? ""), "base64"));
            const out = { layout: layout.layout, file };
            if (Array.isArray(layout.localizedVariants) && layout.localizedVariants.length > 0) {
              out.localizedVariants = layout.localizedVariants.map((variant) => {
                const variantFile = `${dir}/${stem}.${layout.layout}.${variant.locale}${ext}`;
                put(variantFile, Buffer.from(String(variant.contentBase64 ?? ""), "base64"));
                return { locale: variant.locale, file: variantFile };
              });
            }
            return out;
          });
        }
        assets.push(entry);
        if (asset.mimeType === "image/svg+xml") figures.push({ sourceId: asset.sourceId, labels: svgLabels(asset.contentBase64) });
      });
      objects.push({
        clientRef: ref,
        type: "section",
        ...(item.origin ? { origin: structuredClone(item.origin) } : {}),
        payload: { title: structuredClone(section.title), bodyFiles, ...(assets.length > 0 ? { assets } : {}) },
      });
      elements.push({
        clientRef: ref,
        type: "section",
        title: textIn(section.title, primaryLanguage),
        status: "approved",
        contentFile: bodyFiles[primaryLanguage] ?? Object.values(bodyFiles)[0] ?? "",
        mandatory: { examples: [], formulas: [], templates: [], tasks: [], assessmentCriteria: [], terms: [] },
        figures,
        deliberatelyRemoved: [],
      });
      order.push(ref);
      if (!item.origin?.sectionId) problems.push(`section ${index + 1} («${textIn(section.title, primaryLanguage)}») has no origin — the file is not a platform export`);
    } else if (item.type === "MODULE" && item.module) {
      const module = item.module;
      const ref = uniqueRef(`mod-${number}-${slugify(textIn(module.module?.title, primaryLanguage))}`);
      const payload = withoutAudit({ module: module.module, activeVersion: module.activeVersion });
      objects.push({ clientRef: ref, type: "module", ...(item.origin ? { origin: structuredClone(item.origin) } : {}), payload });
      elements.push({
        clientRef: ref,
        type: "module",
        title: textIn(module.module?.title, primaryLanguage),
        status: "approved",
        content: JSON.stringify(payload),
        mandatory: { examples: [], formulas: [], templates: [], tasks: [], assessmentCriteria: [], terms: [] },
        figures: [],
        deliberatelyRemoved: [],
      });
      order.push(ref);
      if (!item.origin?.moduleId) problems.push(`module ${index + 1} («${textIn(module.module?.title, primaryLanguage)}») has no origin — the file is not a platform export`);
    } else {
      problems.push(`item ${index + 1} is neither a section nor a module`);
    }
  });

  const courseRef = uniqueRef(`kurs-${slugify(textIn(course.title, primaryLanguage), "kurs")}`);
  objects.push({
    clientRef: courseRef,
    type: "course",
    ...(course.origin?.courseId ? { origin: { courseId: course.origin.courseId } } : {}),
    payload: {
      course: {
        title: structuredClone(course.title),
        ...(course.description != null ? { description: structuredClone(course.description) } : {}),
        certificationLevel: course.certificationLevel ?? null,
      },
      items: order.map((ref) => ({ type: objects.find((o) => o.clientRef === ref).type === "section" ? "SECTION" : "MODULE", ref })),
    },
  });

  const pkg = {
    packageFormat: "a2-authoring-package/v1",
    locale: primaryLanguage,
    constraints: {
      source: `Eksportfil fra plattformen: «${textIn(course.title, primaryLanguage)}», eksportert ${course.origin?.exportedAt ?? envelope.exportedAt ?? "ukjent"}. Fila er det godkjente grunnlaget; bare det forfatteren ber om, endres.`,
      requirements: "",
    },
    objects,
  };
  const state = { primaryLanguage, order, elements };
  const changes = {
    baseline: baselineFile,
    note: "Every element is \"unchanged\" until the author asks for a change. Values: unchanged | changed | new | removed.",
    elements: Object.fromEntries(order.map((ref) => [ref, "unchanged"])),
  };

  if (problems.length > 0) return { ok: false, problems, pkg, state, changes, files };
  put("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  put("course-state.json", `${JSON.stringify(state, null, 2)}\n`);
  put("changes.json", `${JSON.stringify(changes, null, 2)}\n`);
  put(baselineFile, `${JSON.stringify(envelope, null, 2)}\n`);
  return { ok: true, problems: [], pkg, state, changes, files, primaryLanguage, courseRef };
}

function defaultWrite(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

export function formatConversion(result, outDir) {
  const lines = [];
  if (!result.ok) {
    lines.push("FAIL the export could not be turned into a working set:");
    for (const problem of result.problems) lines.push(`  - ${problem}`);
    return lines.join("\n");
  }
  lines.push(`OK   ${result.state.order.length} element(s) read from the export, written in ${result.primaryLanguage} (primary) — all APPROVED as they stand`);
  for (const element of result.state.elements) lines.push(`     ${element.type.padEnd(7)} ${element.clientRef.padEnd(34)} ${element.title}`);
  lines.push(`     course  ${result.courseRef}`);
  lines.push(`OK   ${result.files.length} file(s) under ${outDir}: package.json, course-state.json, changes.json, ${result.changes.baseline}, sections/, assets/`);
  lines.push("");
  lines.push("NEXT agree the change list with the author (workflows/adjust-course.md, gate 2), write each change into");
  lines.push(`     ${outDir}/changes.json, and produce with:`);
  lines.push(`     node scripts/produce-course.mjs ${outDir}/package.json --out ${outDir}/kurs-oppdatert.json --state ${outDir}/course-state.json --changes ${outDir}/changes.json`);
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const [exportFile, outDir] = process.argv.slice(2);
  if (!exportFile || !outDir) {
    console.error("usage: node scripts/adjust-from-export.mjs <export.json> work");
    process.exit(2);
  }
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(exportFile, "utf8"));
  } catch (error) {
    console.error(`FAIL cannot read ${exportFile}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const result = convertExport(envelope, { outDir });
  console.log(formatConversion(result, outDir));
  process.exit(result.ok ? 0 : 1);
}
