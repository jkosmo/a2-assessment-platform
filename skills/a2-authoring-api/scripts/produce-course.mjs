// Gate 6 in one command: attach the pictures, run every check, and write the import file.
//
//   node scripts/produce-course.mjs work/package.json --out work/kurs-rapportskriving.json \
//        --state work/course-state.json --slides work/treatment.json
//
// The checks are the same ones the references describe, run in a fixed order and named in the
// report. The import file is written only when all of them pass, and it is the file that was read
// back and validated — not a second copy made afterwards.
//
//   package        the package holds together: one course, every item found, nothing left outside
//   pictures       every `file` is attached; text and pictures agree; sizes the platform takes
//   figures        every figure, layout and language variant: labels fit, animation is safe
//   questions      no option gives the answer away
//   languages      nb, nn and en-GB complete, real translations, same answer in each
//   approved text  nothing the author approved has gone missing        (needs --state)
//   slides         every slide got what the slide list says           (needs --slides)
//   import file    built, written, read back, validated against the import's own rules
//
// A package without a course object gives one import file per section and module instead.
//
// Node stdlib only.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { auditExport, checkGate6Readiness } from "./course-state.mjs";
import { buildFallbackEnvelope, describeChecks, roundTripFallbackExport } from "./export-validate.mjs";
import { checkFigureFit } from "./figure-fit-check.mjs";
import { checkFigureMotion } from "./figure-motion-check.mjs";
import { LANGUAGES, checkLocalization, extractSvgTextRuns } from "./localization-check.mjs";
import { checkMcqCues, collectMcqSets } from "./mcq-cue-check.mjs";
import { SVG_MIME, checkAssets, resolvePackageAssets } from "./package-assets.mjs";
import { checkSlideCoverage, countForms, readDeck } from "./slide-coverage.mjs";
import { synthesizeStandaloneEnvelopes } from "./synthesize-envelopes.mjs";

const PACKAGE_FORMAT = "a2-authoring-package/v1";
const CLIENT_REF = /^[a-z0-9-]{1,64}$/;
const NOT_PROSE = new Set(["contentBase64", "filename", "mimeType", "sourceId", "sizeBytes"]);
// Where the author uploads each kind of file, as the admin UI names it.
const IMPORT_AT = Object.freeze({
  course: "Innholdsforvaltning → Kurs → «Importer kurs»",
  section: "Innholdsforvaltning → Seksjoner → «Importer seksjon»",
  module: "Innholdsforvaltning → Moduler → «Importer modul»",
});

function decode(base64) {
  return typeof base64 === "string" ? Buffer.from(base64, "base64").toString("utf8") : "";
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) if (!NOT_PROSE.has(key)) strings(item, out);
  }
  return out;
}

/** Every drawing of every SVG in a payload: the figure, its layouts, and each language of both. */
function drawings(payload) {
  const out = [];
  for (const asset of payload?.assets ?? []) {
    if (asset?.mimeType !== SVG_MIME) continue;
    out.push({ name: asset.sourceId, svg: decode(asset.contentBase64) });
    for (const variant of asset.localizedVariants ?? []) out.push({ name: `${asset.sourceId} (${variant.locale})`, svg: decode(variant.contentBase64) });
    for (const layout of asset.layoutVariants ?? []) {
      out.push({ name: `${asset.sourceId} (${layout.layout})`, svg: decode(layout.contentBase64) });
      for (const variant of layout.localizedVariants ?? []) {
        out.push({ name: `${asset.sourceId} (${layout.layout}, ${variant.locale})`, svg: decode(variant.contentBase64) });
      }
    }
  }
  return out;
}

/** What the loss audit reads: the element's words as written — text, and the labels in its figures. */
function elementText(payload) {
  const labels = drawings(payload).flatMap((drawing) => extractSvgTextRuns(drawing.svg));
  return {
    text: [...strings(payload), ...labels].join(" "),
    attachmentsText: strings(payload?.attachments ?? payload?.activeVersion?.attachments).join(" "),
  };
}

function checkPackage(pkg) {
  const details = [];
  const objects = Array.isArray(pkg?.objects) ? pkg.objects : [];
  if (pkg?.packageFormat !== PACKAGE_FORMAT) details.push(`packageFormat must be "${PACKAGE_FORMAT}"`);
  if (objects.length === 0) details.push("the package has no objects");

  const byRef = new Map();
  for (const object of objects) {
    if (!CLIENT_REF.test(object?.clientRef ?? "")) details.push(`clientRef "${object?.clientRef ?? ""}" must be 1–64 of a–z, 0–9 and -`);
    else if (byRef.has(object.clientRef)) details.push(`clientRef "${object.clientRef}" is used twice`);
    else byRef.set(object.clientRef, object);
    if (!["section", "module", "course"].includes(object?.type)) details.push(`"${object?.clientRef}": unknown type "${object?.type}"`);
  }

  const courses = objects.filter((object) => object?.type === "course");
  if (courses.length > 1) details.push(`${courses.length} course objects — one import file holds one course`);
  const course = courses[0] ?? null;
  const order = [];
  if (course) {
    const items = Array.isArray(course.payload?.items) ? course.payload.items : [];
    if (items.length === 0) details.push("the course has no items");
    for (const [index, item] of items.entries()) {
      if (item?.moduleId || item?.sectionId) {
        details.push(`course item ${index + 1} points at content already on the platform — an import file cannot; create the drafts through the API instead`);
        continue;
      }
      const target = byRef.get(item?.ref);
      if (!target) details.push(`course item ${index + 1}: "${item?.ref}" is not in the package`);
      else if (target.type !== String(item.type ?? "").toLowerCase()) details.push(`course item ${index + 1}: "${item.ref}" is a ${target.type}, listed as ${item.type}`);
      else order.push(item.ref);
    }
    const placed = new Set(order);
    for (const object of objects) {
      if (object?.type !== "course" && byRef.get(object?.clientRef) === object && !placed.has(object.clientRef)) {
        details.push(`"${object.clientRef}" is in the package and not in the course — place it, or take it out`);
      }
    }
    if (!items.some((item) => item?.type === "MODULE")) details.push("the course has no module — it can never be completed");
  }

  // The platform shows a section's title above its text. A body that opens with the same words as
  // a heading says the title twice.
  const plain = (text) => String(text ?? "").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const object of objects) {
    if (object?.type !== "section") continue;
    const { title, bodyMarkdown } = object.payload ?? {};
    const languages = bodyMarkdown && typeof bodyMarkdown === "object" ? Object.keys(bodyMarkdown) : [""];
    for (const language of languages) {
      const body = language ? bodyMarkdown[language] : bodyMarkdown;
      const name = title && typeof title === "object" ? title[language] : title;
      const first = String(body ?? "").split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
      if (name && /^#{1,6}\s/.test(first) && plain(first) === plain(name)) {
        details.push(`"${object.clientRef}"${language ? ` (${language})` : ""}: the text opens with the section's own title as a heading — the platform shows the title already; take the heading out`);
      }
    }
  }

  const count = (type) => objects.filter((object) => object?.type === type).length;
  return {
    course,
    order,
    check: {
      name: "package",
      status: details.length === 0 ? "ok" : "fail",
      summary: `${count("section")} section(s), ${count("module")} module(s), ${course ? "one course" : "no course — one file per section and module"}`,
      details,
    },
  };
}

function checkPictures(resolved) {
  const assets = checkAssets(resolved.pkg);
  const details = [...resolved.problems, ...assets.problems].map((problem) => `${problem.path}: ${problem.message}`);
  return {
    name: "pictures",
    status: details.length === 0 ? "ok" : "fail",
    summary: `${assets.count} picture(s) and figure(s), ${(assets.totalBytes / 1024).toFixed(0)} kB with every layout and language`,
    details,
  };
}

function checkFigures(pkg) {
  const details = [];
  let measured = 0;
  for (const object of pkg.objects ?? []) {
    if (object?.type !== "section") continue;
    for (const drawing of drawings(object.payload)) {
      measured += 1;
      for (const issue of checkFigureFit(drawing.svg).issues) {
        details.push(`${object.clientRef}/${drawing.name}: «${issue.text}» ${issue.kind} — ${issue.detail}`);
      }
      for (const issue of checkFigureMotion(drawing.svg).issues) {
        details.push(`${object.clientRef}/${drawing.name}: ${issue.kind} — ${issue.detail}`);
      }
    }
  }
  return { name: "figures", status: details.length === 0 ? "ok" : "fail", summary: `${measured} drawing(s) measured`, details };
}

function checkQuestions(pkg, primary) {
  const details = [];
  const sets = collectMcqSets(pkg);
  let questions = 0;
  for (const set of sets) {
    const result = checkMcqCues(set.questions, { primary });
    questions += result.stats.questions;
    for (const issue of result.issues) {
      details.push(`${set.path} ${issue.index == null ? "the set" : `question ${issue.index + 1}`}: ${issue.kind} — ${issue.detail}`);
    }
  }
  return { name: "questions", status: details.length === 0 ? "ok" : "fail", summary: `${questions} question(s) in ${sets.length} set(s)`, details };
}

function checkLanguages(pkg, primary) {
  const result = checkLocalization(pkg, { primary });
  const details = [...result.reasons];
  const where = (entry) => [entry.path, entry.locale, entry.missingLocales?.join("+"), entry.token, entry.detail].filter(Boolean).join(" · ");
  const lists = [result.missing, result.answerKeyChanges, result.optionCountMismatches, result.tokenDrift, result.blindCopies];
  for (const list of [...lists, ...Object.values(result.figures ?? {}).filter(Array.isArray)]) {
    for (const entry of list ?? []) if (entry && typeof entry === "object") details.push(`  ${where(entry)}`);
  }
  // A translation keeps the section's shape: a table, a box or a card that is in one language
  // and not in another was lost on the way.
  const shape = [];
  const names = { cards: "card or sub-heading(s)", callout: "highlighted box(es)", prompt: "prompt box(es)", table: "table(s)" };
  for (const object of pkg.objects ?? []) {
    const body = object?.type === "section" ? object.payload?.bodyMarkdown : null;
    if (!body || typeof body !== "object" || typeof body[primary] !== "string") continue;
    const original = countForms(body[primary]);
    for (const language of LANGUAGES) {
      if (language === primary || typeof body[language] !== "string") continue;
      const translated = countForms(body[language]);
      for (const [form, name] of Object.entries(names)) {
        if (translated[form] !== original[form]) shape.push(`${object.clientRef}: ${language} has ${translated[form]} ${name}, ${primary} has ${original[form]}`);
      }
    }
  }
  const failed = result.blocks || shape.length > 0;
  return {
    name: "languages",
    status: failed ? "fail" : "ok",
    summary: `${LANGUAGES.join(", ")} — written in ${primary}`,
    details: failed ? [...(result.blocks ? details : []), ...shape] : [],
  };
}

function auditDetails(audit) {
  const details = [...audit.reasons];
  for (const entry of audit.lostMandatory) details.push(`  ${entry.clientRef}: ${entry.category} — «${entry.item}»`);
  for (const entry of audit.unexpectedlyMissingItems) {
    if (!entry.mandatory) details.push(`  ${entry.clientRef}: ${entry.category} — «${entry.item}»`);
  }
  return details;
}

function checkApprovedText(master, pkg) {
  const readiness = checkGate6Readiness(master);
  const elements = (pkg.objects ?? []).map((object) => ({ ref: object.clientRef, ...elementText(object.payload) }));
  const audit = auditExport(master, elements);
  const details = [...readiness.issues, ...(audit.blocks ? auditDetails(audit) : [])];
  const totals = audit.totals;
  return {
    name: "approved text",
    status: details.length === 0 ? "ok" : "fail",
    summary: `${totals.preserved} item(s) in place, ${totals.moved} moved to an attachment, ${totals.deliberatelyRemoved} removed with the author's consent`,
    details,
  };
}

function checkSlides(treatment, pkg, deck) {
  const result = checkSlideCoverage(treatment, pkg, { deck });
  const details = [
    ...result.rows.flatMap((row) => row.problems.map((problem) => `slide ${row.slide}: ${problem}`)),
    ...result.problems,
  ];
  return {
    name: "slides",
    status: result.ok ? "ok" : "fail",
    summary: `${result.rows.length} row(s) in the slide list${deck ? `, ${deck.slides.length} slides in the presentation` : ""}`,
    details,
  };
}

function readJson(file, what, problems) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push(`cannot read ${what} ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * @param {{ packageFile: string, outFile?: string, stateFile?: string, slidesFile?: string, deckDir?: string, packageOut?: string, now?: Date }} options
 * @returns {Promise<{ ok: boolean, checks: Array<{ name: string, status: "ok" | "fail" | "skipped", summary: string, details: string[] }>, files: Array<{ file: string, importAt: string }> }>}
 */
export async function produceCourse({ packageFile, outFile, stateFile, slidesFile, deckDir, packageOut, now = new Date() }) {
  const checks = [];
  const files = [];
  const unreadable = [];
  const baseDir = path.dirname(packageFile);

  const source = readJson(packageFile, "the package", unreadable);
  if (!source) {
    return { ok: false, checks: [{ name: "package", status: "fail", summary: "not read", details: unreadable }], files };
  }
  const primary = LANGUAGES.includes(source.locale) ? source.locale : "nb";

  const { course, order, check: packageCheck } = checkPackage(source);
  checks.push(packageCheck);

  const resolved = resolvePackageAssets(source, { baseDir });
  const pkg = resolved.pkg;
  checks.push(checkPictures(resolved));
  checks.push(checkFigures(pkg));
  checks.push(checkQuestions(pkg, primary));
  checks.push(checkLanguages(pkg, primary));

  let master = null;
  if (stateFile) {
    const problems = [];
    master = readJson(stateFile, "the course state", problems);
    checks.push(master ? checkApprovedText(master, pkg) : { name: "approved text", status: "fail", summary: "not read", details: problems });
  } else {
    checks.push({ name: "approved text", status: "skipped", summary: "NOT RUN — no --state file. Say so in the report", details: [] });
  }

  if (slidesFile) {
    const problems = [];
    const treatment = readJson(slidesFile, "the slide list", problems);
    const deck = readDeck(deckDir ?? path.join(path.dirname(slidesFile), "deck"));
    checks.push(treatment ? checkSlides(treatment, pkg, deck) : { name: "slides", status: "fail", summary: "not read", details: problems });
  } else {
    checks.push({ name: "slides", status: "skipped", summary: "not run — no --slides file (only a course from a presentation has one)", details: [] });
  }

  if (checks.some((check) => check.status === "fail")) {
    checks.push({ name: "import file", status: "skipped", summary: "NOT WRITTEN — fix the checks above first", details: [] });
    return { ok: false, checks, files };
  }

  const fileCheck = { name: "import file", status: "ok", summary: "", details: [] };
  const deliver = async (envelope, file, importAt, contentIntegrity) => {
    mkdirSync(path.dirname(file), { recursive: true });
    const report = await roundTripFallbackExport(envelope, { filePath: file, contentIntegrity });
    fileCheck.details.push(`${file}: ${describeChecks(report).slice(0, 5).join(" · ")}`);
    if (report.delivered) {
      files.push({ file, importAt });
      return;
    }
    fileCheck.status = "fail";
    for (const check of Object.values(report.checks)) {
      for (const issue of check.issues ?? []) fileCheck.details.push(`  ${issue.path}: ${issue.message}`);
      for (const reason of check.reasons ?? []) fileCheck.details.push(`  ${reason}`);
      for (const offender of check.offenders ?? []) fileCheck.details.push(`  garbled text at ${offender.path ?? JSON.stringify(offender)}`);
    }
    // A file that did not pass is not left where it can be handed over by mistake.
    rmSync(file, { force: true });
  };

  try {
    if (course) {
      const file = outFile ?? path.join(baseDir, "course-import.json");
      const integrity = master
        ? (parsed) => {
            const items = [...(parsed?.course?.course?.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            const written = parsed?.course?.course ?? {};
            // The course's own title and description are an element too, when the author approved them as one.
            return auditExport(master, [
              { ref: course.clientRef, ...elementText({ title: written.title, description: written.description }) },
              ...items.map((item, index) => ({ ref: order[index], ...elementText(item.section ?? item.module) })),
            ]);
          }
        : undefined;
      await deliver(buildFallbackEnvelope(pkg, { exportedAt: now }), file, IMPORT_AT.course, integrity);
    } else {
      const dir = outFile ?? baseDir;
      for (const entry of synthesizeStandaloneEnvelopes(pkg, () => now.toISOString())) {
        await deliver(entry.envelope, path.join(dir, `${entry.type}-${entry.clientRef}.json`), IMPORT_AT[entry.type]);
      }
    }
  } catch (error) {
    fileCheck.status = "fail";
    fileCheck.details.push(error instanceof Error ? error.message : String(error));
  }

  if (fileCheck.status === "ok" && packageOut) {
    mkdirSync(path.dirname(packageOut), { recursive: true });
    writeFileSync(packageOut, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    fileCheck.details.push(`${packageOut}: the package with every picture attached, for the API route`);
  }
  if (fileCheck.status === "fail") for (const entry of files.splice(0)) rmSync(entry.file, { force: true });
  fileCheck.summary = fileCheck.status === "ok" ? `${files.length} file(s) written, read back and validated` : "NOT DELIVERABLE";
  checks.push(fileCheck);
  return { ok: fileCheck.status === "ok", checks, files };
}

/** The report: one line per check, the findings under it, and what to hand over. */
export function formatProduction(result) {
  const mark = { ok: "OK  ", fail: "FAIL", skipped: "--  " };
  const out = [];
  for (const check of result.checks) {
    out.push(`${mark[check.status]} ${check.name.padEnd(14)} ${check.summary}`);
    for (const detail of check.details) out.push(`       ${detail}`);
  }
  out.push("");
  if (result.ok) {
    for (const entry of result.files) out.push(`DELIVER ${entry.file}  —  the author imports it at ${entry.importAt}`);
    const notRun = result.checks.filter((check) => check.status === "skipped").map((check) => check.name);
    if (notRun.length > 0) out.push(`Not run: ${notRun.join(", ")}. Name them as not run when you report.`);
  } else {
    const failed = result.checks.filter((check) => check.status === "fail").map((check) => check.name);
    out.push(`DO NOT DELIVER — failed: ${failed.join(", ")}. Fix what is listed and run again.`);
  }
  return out.join("\n");
}

function parseArgs(argv) {
  const args = {};
  const names = { "--out": "outFile", "--state": "stateFile", "--slides": "slidesFile", "--deck": "deckDir", "--package-out": "packageOut" };
  for (let i = 0; i < argv.length; i += 1) {
    const name = names[argv[i]];
    if (name) {
      args[name] = argv[i + 1];
      i += 1;
    } else if (argv[i].startsWith("--") || args.packageFile) {
      throw new Error(`unknown argument: ${argv[i]}`);
    } else args.packageFile = argv[i];
  }
  if (!args.packageFile || Object.values(args).some((value) => value === undefined)) throw new Error("missing argument");
  return args;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(
      "usage: node scripts/produce-course.mjs work/package.json [--out course.json] [--state work/course-state.json]\n" +
        "       [--slides work/treatment.json] [--deck work/deck] [--package-out work/package.complete.json]",
    );
    process.exit(2);
  }
  if (!existsSync(args.packageFile)) {
    console.error(`FAIL no such file: ${args.packageFile}`);
    process.exit(2);
  }
  const result = await produceCourse(args);
  console.log(formatProduction(result));
  process.exit(result.ok ? 0 : 1);
}
