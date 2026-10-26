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
//   changes        unchanged is unchanged: every element the change list calls "unchanged" is
//                  word for word as in the export it came from; "changed" differs; "new" has no
//                  origin; "removed" is gone                        (needs --changes, #1095)
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
import { SVG_MIME, checkAssets, readCourseState, resolvePackageAssets } from "./package-assets.mjs";
import { checkSlideCoverage, countForms, readDeck } from "./slide-coverage.mjs";
import { synthesizeStandaloneEnvelopes } from "./synthesize-envelopes.mjs";

const PACKAGE_FORMAT = "a2-authoring-package/v1";
const CLIENT_REF = /^[a-z0-9-]{1,64}$/;
const NOT_PROSE = new Set(["contentBase64", "filename", "mimeType", "sourceId", "sizeBytes"]);
// Where the author uploads each kind of file, as the admin UI names it.
const IMPORT_AT = Object.freeze({
  course: "Innholdsforvaltning → Kurs → «Importer kurs»",
  // #1095: a file that carries `origin` is offered as an UPDATE of the course it came from.
  courseUpdate: "Innholdsforvaltning → Kurs → «Importer kurs», and chooses «Oppdater dette kurset» — new versions are laid ready, nothing is published",
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
    summary: `${assets.count} picture(s) and figure(s), ${(assets.totalBytes / 1024).toFixed(0)} kB with every layout and language; ${assets.icons} icon(s) from the platform library${assets.large?.length ? `; worth cropping (300–600 kB): ${assets.large.join(", ")}` : ""}`,
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

// The learner reads the course, never the source. A sentence that points at the slide ("som vist på
// lysark 4") or the presentation is the author's voice leaking through; the point itself is what
// belongs in the text. In every language, with the phrases each language uses.
//
// Only the POINTING forms. A course about presentations says "lysark" and "slide" as its subject
// ("Hold deg til ett budskap per lysark") and must not be stopped; what is caught is a slide
// number, a demonstrative ("dette lysarket", "this slide") or "as shown on the slide".
const SOURCE_REFERENCES = [
  // `[ \t]+`, not `\s+`: a list "1. Ett budskap per lysark\n2. Store tall" is not "lysark 2".
  // "første/siste lysbildet" is left alone: a course on presentations says that about its subject.
  // Every inflection at once (lysark, lysarket, lysbilde, lysbilder, lysbilete, lysbileta …) — not one
  // ending per round. A ratio like "16:9" after the word is a format, not a slide number.
  /\b(?:lysark|lysbil(?:d|et))[a-zæøå]*[ \t]+(?:nr\.?[ \t]*)?\d+\b(?!:\d)/i,
  /\b(?:dette|forrige|neste) (?:lysarket|lysbildet|lysbiletet)\b/i,
  /\b(?:i|på) (?:denne|dette) (?:presentasjonen|foredraget|lysarket|lysbildet|lysbiletet)\b/i,
  /\bsom (?:vist|nemnt|nevnt|forklart) (?:på|i) (?:lysark|lysbild|lysbilet|presentasjon|foredrag)/i,
  /\bslides?[ \t]+(?:no\.?[ \t]*)?\d+\b(?!:\d)/i,
  /\b(?:on|in) (?:this|the previous|the next) (?:slide|deck|presentation)\b/i,
  /\bthis (?:slide|deck|presentation) (?:shows|says|covers|explains)\b/i,
  /\bas (?:shown|explained|mentioned|described) (?:on|in) the (?:slide|deck|presentation)\b/i,
];

/** The text without code blocks — fenced at any indent, as in a list item. A prompt may say "slide 3". */
function withoutCodeBlocks(text) {
  return String(text ?? "").replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, "");
}

// The platform's own reading of a frame's opening line (`:::kort`, `::: Kort`, `:::cards` — blanks and
// case do not matter), so what is counted here agrees with what the reader will show. The words and
// their English twins are the platform's (src/modules/course/contentBlocks.ts).
const FRAME_OPENER = /^:::[ \t]*(kort|cards|tenk|think|sjekk|check|steg|steps|skriv|write|repetisjon|flashcards|par|pairs)\b/i;
/** Cards take nothing after the word; think, check and write need their question or task there; steps, flashcards and pairs may have a title. */
function isFrameOpener(word, line) {
  const kind = word.toLowerCase();
  if (kind === "kort" || kind === "cards") return /^:::[ \t]*(?:kort|cards)[ \t]*$/i.test(line);
  if (["steg", "steps", "repetisjon", "flashcards", "par", "pairs"].includes(kind)) return new RegExp(`^:::[ \\t]*${kind}(?:[ \\t].*)?$`, "i").test(line);
  return new RegExp(`^:::[ \\t]*${kind}[ \\t]+\\S`, "i").test(line);
}

/** The frames that are drawn only in a section, never in a module's text (2.96.1). */
const SECTION_ONLY_FRAME = /^:::[ \t]*(steg|steps|skriv|write|repetisjon|flashcards|par|pairs)\b/i;
/** A module's text fields the learner reads. */
const MODULE_TEXT_FIELDS = ["taskText", "candidateTaskConstraints"];

/** The frames in a text, line by line: unclosed, stray closing lines, and a frame opened inside another. */
function frameProblems(prose) {
  const problems = [];
  let open = null;
  // #1074: linjene i en :::sjekk-ramme, til kontrollen når den lukkes.
  let checkLines = null;
  // Linja over: en åpningslinje skal ha en BLANK linje over seg (eller en overskrift, eller slutten på en
  // annen ramme). Uten den kan plattformen lese åpningslinja som en del av det over — en liste, et
  // sitat, en tabell, en HTML-blokk — og rammen blir ikke tegnet; for :::sjekk ser deltakeren da fasiten
  // som en avkrysset liste (QA 2.94.0).
  //
  // ⚠️ Låst til malen, ikke en etterligning av hva plattformen leser som hva. Første utgave lette etter
  // lister og tabeller og bommet på fortsettelseslinjer, sitater og HTML; den neste ville bommet på noe
  // annet. En blank linje virker alltid.
  let previous = "";
  for (const line of String(prose ?? "").split(/\r?\n/)) {
    const above = previous;
    previous = line;
    const opener = FRAME_OPENER.exec(line);
    if (opener && isFrameOpener(opener[1], line)) {
      const kind = opener[1].toLowerCase();
      if (above.trim() !== "" && !/^#{1,6}[ \t]/.test(above) && !/^:::[ \t]*$/.test(above)) {
        problems.push(`a :::${kind} line has text right above it — put a blank line above the frame; without one the platform can read the frame as part of the list, quote or table above, and not draw it`);
      }
      if (open) problems.push(`a :::${kind} frame is opened inside a :::${open} frame — frames cannot be nested; the first ::: closes both, and the learner sees the markers as text`);
      else {
        open = kind;
        // #1074–#1078: rammene med en form plattformen krever, samles til de lukkes og kontrolleres da.
        checkLines = FRAME_SHAPE_CHECKS[kind] ? [] : null;
      }
      continue;
    }
    if (/^:::[ \t]*$/.test(line)) {
      if (open) {
        if (checkLines) problems.push(...FRAME_SHAPE_CHECKS[open](open, checkLines));
        open = null;
        checkLines = null;
      } else problems.push("a ::: closes a frame that was never opened");
      continue;
    }
    if (checkLines) checkLines.push(line);
  }
  if (open) problems.push(`a :::${open} frame is opened and never closed — the platform shows it as plain text; close it with ::: on its own line`);
  return problems;
}


/**
 * #1074: en «sjekk deg selv»-ramme er en blokk bare med minst to alternativer først i rammen og nøyaktig
 * ett riktig (`- [x]`). Ellers viser plattformen markørene som tekst — samme regel som
 * src/modules/course/contentBlocks.ts.
 */
function checkProblems(kind, lines) {
  let at = 0;
  while (at < lines.length && lines[at].trim() === "") at += 1;
  const options = [];
  while (at < lines.length) {
    const option = /^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+\S/.exec(lines[at]);
    if (option) options.push(option[1].toLowerCase() === "x");
    // #1110: an indented line right under an option is that option's feedback.
    else if (!(options.length > 0 && /^(?: {2,}|\t)[ \t]*\S/.test(lines[at]))) break;
    at += 1;
  }
  const right = options.filter(Boolean).length;
  if (options.length < 2) return [`a :::${kind} question needs at least two options (\`- [ ]\` / \`- [x]\`) straight after the question line — the learner sees the markers as text`];
  if (right !== 1) return [`a :::${kind} question needs exactly one right option marked \`- [x]\` (it has ${right}) — the learner sees the markers as text`];
  return [];
}

/** A heading line at the frame's own level — what starts a step or a card on the platform. */
const ITEM_HEADING = /^ {0,3}#{1,6}[ \t]+(\S.*)$/;

/**
 * #1075 and #1078: a «steg» or «repetisjon» frame is a block only with at least two headings — one per
 * step or card, the rule of `:::kort`. With fewer the platform shows the markers as text. A card with
 * nothing under its heading has no back to turn to.
 */
function itemsProblems(kind, lines) {
  const steps = kind === "steg" || kind === "steps";
  const items = [];
  for (const line of lines) {
    const heading = ITEM_HEADING.exec(line);
    if (heading) items.push({ title: heading[1].trim(), body: 0 });
    else if (items.length > 0 && line.trim() !== "") items[items.length - 1].body += 1;
  }
  if (items.length < 2) {
    return [`a :::${kind} frame needs at least two ${steps ? "steps" : "cards"} — one ### heading per ${steps ? "step" : "card"} (it has ${items.length}); with fewer the learner sees the markers as text`];
  }
  if (steps) return [];
  return items.filter((item) => item.body === 0).map((item) => `a card in a :::${kind} frame has nothing on its back: «${item.title}» — write the explanation under the heading`);
}

/** The checklist line in a «skriv» frame — the platform's rule: `- [ ] text`. */
const WRITE_CHECK_ITEM = /^[ \t]*[-*][ \t]+\[[ xX]\][ \t]+\S/;

/**
 * #1076: a «skriv» frame is a block only with an example answer — text above the checklist (the run of
 * `- [ ]` lines at the end). A frame with only a checklist is shown as text.
 */
function writeProblems(kind, lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end -= 1;
  while (end > 0 && WRITE_CHECK_ITEM.test(lines[end - 1])) end -= 1;
  if (lines.slice(0, end).some((line) => line.trim() !== "")) return [];
  return [`a :::${kind} frame needs an example answer above the checklist — the learner compares with it; without one the learner sees the markers as text`];
}

/**
 * A line in a «par» frame — the platform's rule (splitPairLine in src/modules/course/contentBlocks.ts):
 * `- term = explanation`, split at the first « = » that is not inside a code span.
 */
function splitPairLine(line) {
  const item = /^[ \t]*[-*][ \t]+(\S.*?)[ \t]*$/.exec(line);
  if (!item) return null;
  const body = item[1];
  let inCode = false;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "`") inCode = !inCode;
    if (inCode || (body[i] !== " " && body[i] !== "\t")) continue;
    const sep = /^[ \t]+=[ \t]+/.exec(body.slice(i));
    if (!sep) continue;
    const term = body.slice(0, i).trim();
    const def = body.slice(i + sep[0].length).trim();
    if (term && def) return { term, def };
  }
  return null;
}
/** What the learner reads: `**Vedtak**` and `Vedtak` are the same term. */
const comparablePairText = (text) => text.replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * #1107: a «par» frame is a block only when every line is a pair, there are at least three, and no
 * term or explanation is repeated (two right answers). Otherwise the learner sees the markers as text.
 */
function pairsProblems(kind, lines) {
  const pairs = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const pair = splitPairLine(line);
    if (!pair) return [`a :::${kind} frame has a line that is not a pair «- term = explanation»: «${line.trim()}» — the learner sees the markers as text`];
    pairs.push({ term: comparablePairText(pair.term), def: comparablePairText(pair.def) });
  }
  if (pairs.length < 3) return [`a :::${kind} frame needs at least three pairs (it has ${pairs.length}) — with fewer the learner sees the markers as text`];
  const repeated = (values) => values.length !== new Set(values).size;
  if (repeated(pairs.map((p) => p.term)) || repeated(pairs.map((p) => p.def))) {
    return [`a :::${kind} frame repeats a term or an explanation — every pair must be different, or two answers would be right; the learner sees the markers as text`];
  }
  return [];
}

/** The frames with a shape the platform requires, and the check for each. */
const FRAME_SHAPE_CHECKS = {
  par: pairsProblems,
  pairs: pairsProblems,
  sjekk: checkProblems,
  check: checkProblems,
  steg: itemsProblems,
  steps: itemsProblems,
  repetisjon: itemsProblems,
  flashcards: itemsProblems,
  skriv: writeProblems,
  write: writeProblems,
};

function checkLearnerText(pkg) {
  const details = [];
  let sections = 0;
  for (const object of pkg.objects ?? []) {
    if (object?.type !== "section") continue;
    sections += 1;
    const body = object.payload?.bodyMarkdown;
    const languages = body && typeof body === "object" ? Object.entries(body) : [["", body]];
    for (const [language, markdown] of languages) {
      const text = String(markdown ?? "");
      const where = `"${object.clientRef}"${language ? ` (${language})` : ""}`;
      const prose = withoutCodeBlocks(text);
      for (const pattern of SOURCE_REFERENCES) {
        const match = pattern.exec(prose);
        if (match) {
          details.push(`${where}: «${match[0]}» points at the source — the learner reads the course, not the slides; say the point itself`);
          break;
        }
      }
      // A frame that is not closed is shown as text. Read the way the platform reads frames — the
      // first ::: line closes whatever frame is open, so a frame inside a frame (#1072: a «tenk
      // først» inside cards, or the other way round) breaks both — and only outside code blocks.
      for (const problem of frameProblems(prose)) details.push(`${where}: ${problem}`);
    }
  }
  // 2.96.1 (produkteier 2026-10-20): steg for steg, skriv selv og repetisjonskort tegnes bare i
  // seksjoner. I modulens tekst — det deltakeren svarer på — står markørene som tekst.
  for (const object of pkg.objects ?? []) {
    if (object?.type !== "module") continue;
    const version = object.payload?.activeVersion ?? {};
    for (const field of MODULE_TEXT_FIELDS) {
      const value = version[field];
      const languages = value && typeof value === "object" ? Object.entries(value) : [["", value]];
      for (const [language, markdown] of languages) {
        for (const line of withoutCodeBlocks(String(markdown ?? "")).split(/\r?\n/)) {
          const opener = SECTION_ONLY_FRAME.exec(line);
          if (!opener) continue;
          details.push(`"${object.clientRef}" ${field}${language ? ` (${language})` : ""}: a :::${opener[1].toLowerCase()} frame works only in a section — in a module's text the learner sees the markers as text; move the exercise to the section before the module`);
        }
      }
    }
  }
  return { name: "learner text", status: details.length === 0 ? "ok" : "fail", summary: `${sections} section(s) read for the learner's voice and card frames`, details };
}

// `onlyRefs` (#1095, adjusting): the rule is computed over the WHOLE course — a new test after four
// unchanged sections still needs four questions — but reported only for the changed and new modules.
// `baselineCounts` (ref → questions in the export): a CHANGED test that already had too few questions
// is not asked to grow for a typo fix — the requirement does not exceed what the export had.
function checkQuestions(pkg, primary, course, { onlyRefs = null, baselineCounts = null } = {}) {
  const details = [];
  const inScope = (ref) => !onlyRefs || onlyRefs.has(ref);
  const sets = collectMcqSets(pkg).filter((set) => inScope(set.clientRef ?? String(set.path).replace(/^objects\[([^\]]+)\].*$/, "$1")));
  let questions = 0;
  for (const set of sets) {
    const result = checkMcqCues(set.questions, { primary, reading: set.reading });
    questions += result.stats.questions;
    for (const issue of result.issues) {
      details.push(`${set.path} ${issue.index == null ? "the set" : `question ${issue.index + 1}`}: ${issue.kind} — ${issue.detail}`);
    }
  }
  // A module tests the whole of what the sections before it teach: at least one question per
  // section it follows, and at least three. A four-question quiz after six sections leaves four
  // sections untested. Free-text-only modules are not counted; their task covers the ground.
  const byRef = new Map((pkg.objects ?? []).map((object) => [object?.clientRef, object]));
  let sectionsBefore = 0;
  for (const item of course?.payload?.items ?? []) {
    const target = byRef.get(item?.ref);
    if (!target) continue;
    if (target.type === "section") {
      sectionsBefore += 1;
      continue;
    }
    if (target.type !== "module") continue;
    const version = target.payload?.activeVersion ?? {};
    if (version.assessmentMode !== "FREETEXT_ONLY") {
      const count = version.mcqSet?.questions?.length ?? 0;
      const had = baselineCounts?.get(target.clientRef);
      const needed = Math.min(Math.max(3, sectionsBefore), had === undefined ? Infinity : Math.max(had, 0));
      if (count < needed && inScope(target.clientRef)) {
        details.push(`"${target.clientRef}": ${count} question(s) after ${sectionsBefore} section(s) — a module tests the whole of what its sections teach: at least one question per section and at least 3 (${needed} here)`);
      }
    }
    sectionsBefore = 0;
  }
  return { name: "questions", status: details.length === 0 ? "ok" : "fail", summary: `${questions} question(s) in ${sets.length} set(s)`, details };
}

function checkLanguages(pkg, primary) {
  const result = checkLocalization(pkg, { primary });
  const details = [...result.reasons];
  // A figure's labels are counted per piece of text: each line of a label is one.
  const counts = (entry) =>
    Number.isInteger(entry.expected) && Number.isInteger(entry.actual)
      ? `${entry.actual} pieces of label text, the original has ${entry.expected} — keep the same number of lines in every label`
      : null;
  const where = (entry) => [entry.path, entry.locale, entry.missingLocales?.join("+"), entry.token, entry.detail, counts(entry)].filter(Boolean).join(" · ");
  const lists = [result.missing, result.answerKeyChanges, result.blockShapeChanges, result.optionCountMismatches, result.tokenDrift, result.labelDrift, result.blindCopies];
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

// #1095: the change list against the baseline export. Comparable form: what the platform's update
// looks at, without `audit` (publish history), without `sortOrder`, keys in a fixed order.
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "audit") continue;
      out[key] = comparable(value[key]);
    }
    return out;
  }
  return value;
}
const sameContent = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

function sectionContent(payload) {
  return { title: payload?.title, bodyMarkdown: payload?.bodyMarkdown, assets: payload?.assets ?? [] };
}
function moduleContent(payload) {
  return { module: payload?.module, activeVersion: payload?.activeVersion };
}

/**
 * Unchanged is unchanged. The change list (`changes.json`) says, per clientRef, what the author
 * decided: unchanged | changed | new | removed. Against the baseline (the platform's export the
 * package was made from), an "unchanged" element must be word for word the same — text, title and
 * pictures — a "changed" one must differ, a "new" one has no origin, and a "removed" one is out of
 * the package. Every element on both sides must be accounted for.
 */
function checkChanges(changes, baseline, pkg) {
  const details = [];
  const decisions = changes?.elements && typeof changes.elements === "object" ? changes.elements : null;
  if (!decisions) details.push("changes.json has no `elements` map (clientRef → unchanged | changed | new | removed)");
  // The course's own title, description and level: the platform writes them straight onto the live
  // course at import, without a version — so they are part of the change list too (`course`).
  const courseObject = (pkg.objects ?? []).find((o) => o?.type === "course");
  const baseCourse = baseline?.course?.course;
  if (courseObject && baseCourse) {
    const fields = (c) => ({ title: c?.title, description: c?.description ?? null, certificationLevel: c?.certificationLevel ?? null });
    const courseSame = sameContent(fields(courseObject.payload?.course), fields(baseCourse));
    const courseDecision = changes?.course;
    if (courseDecision === undefined) details.push("changes.json has no `course` decision (unchanged | changed) for the course's own title, description and level");
    else if (!["unchanged", "changed"].includes(courseDecision)) details.push(`course: "${courseDecision}" is not a decision the course can have (unchanged | changed)`);
    else if (courseDecision === "unchanged" && !courseSame) details.push("course: listed as unchanged, but its title, description or level differs from the export — the platform would change the live course at import; restore it, or list the course as changed");
    else if (courseDecision === "changed" && courseSame) details.push("course: listed as changed, but its title, description and level are as in the export");
  }
  const refs = changes?.refs && typeof changes.refs === "object" ? changes.refs : null;
  // The order of the course: a moved element is word for word the same, so it is not "changed" —
  // but the platform applies the new order at once. It has its own line, `order`.
  if (courseObject && baseCourse) {
    const idOf = (o) => (o?.type === "section" ? (o.origin?.sectionId ? `SECTION:${o.origin.sectionId}` : null) : o?.type === "module" ? (o.origin?.moduleId ? `MODULE:${o.origin.moduleId}` : null) : null);
    const byRef = new Map((pkg.objects ?? []).map((o) => [o?.clientRef, o]));
    const packageSequence = (courseObject.payload?.items ?? []).map((item) => idOf(byRef.get(item?.ref))).filter(Boolean);
    const inPackage = new Set(packageSequence);
    const baselineSequence = [...(baseline?.course?.course?.items ?? [])].sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0)).map((item) => (item.type === "SECTION" ? `SECTION:${item.origin?.sectionId}` : `MODULE:${item.origin?.moduleId}`)).filter((key) => inPackage.has(key));
    const orderSame = JSON.stringify(packageSequence) === JSON.stringify(baselineSequence);
    const orderDecision = changes?.order;
    if (orderDecision === undefined) details.push("changes.json has no `order` decision (unchanged | changed) for the course's order");
    else if (!["unchanged", "changed"].includes(orderDecision)) details.push(`order: "${orderDecision}" is not a decision the order can have (unchanged | changed)`);
    else if (orderDecision === "unchanged" && !orderSame) details.push("order: listed as unchanged, but the elements stand in another order than in the export — the platform applies the order at import; restore it, or list the order as changed");
    else if (orderDecision === "changed" && orderSame) details.push("order: listed as changed, but the elements stand as in the export");
  }
  const items = [...(baseline?.course?.course?.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (!baseline?.course?.course) details.push("the baseline is not a course export");
  const baselineById = new Map();
  for (const item of items) {
    const id = item.type === "SECTION" ? item.origin?.sectionId : item.origin?.moduleId;
    if (id) baselineById.set(`${item.type}:${id}`, item);
  }
  const counts = { unchanged: 0, changed: 0, new: 0, removed: 0 };
  const seenBaseline = new Set();
  for (const object of pkg.objects ?? []) {
    if (object?.type === "course") continue;
    const ref = object?.clientRef;
    const decision = decisions?.[ref];
    const typeKey = object.type === "section" ? "SECTION" : "MODULE";
    const originId = object.type === "section" ? object.origin?.sectionId : object.origin?.moduleId;
    const key = originId ? `${typeKey}:${originId}` : null;
    const baseItem = key ? baselineById.get(key) : undefined;
    if (key) seenBaseline.add(key);
    if (!decision) {
      details.push(`"${ref}": not in the change list — say what happens to it (unchanged | changed | new)`);
      continue;
    }
    if (!["unchanged", "changed", "new"].includes(decision)) {
      details.push(`"${ref}": "${decision}" is not a decision an element in the package can have (unchanged | changed | new; "removed" is for elements that are out of the package)`);
      continue;
    }
    if (decision === "new") {
      if (object.origin) details.push(`"${ref}": listed as new, but it carries an origin from the baseline — it is "changed" or "unchanged", or drop the origin if it really is a new element`);
      else counts.new += 1;
      continue;
    }
    if (!object.origin) {
      details.push(`"${ref}": listed as ${decision}, but it has no origin — an element from the export keeps its origin; a new one is listed as "new"`);
      continue;
    }
    if (!baseItem) {
      details.push(`"${ref}": its origin is not in the baseline export — the package and the baseline are not from the same file`);
      continue;
    }
    const same = object.type === "section"
      ? sameContent(sectionContent(object.payload), sectionContent(baseItem.section))
      : sameContent(moduleContent(object.payload), moduleContent(baseItem.module));
    if (decision === "unchanged" && !same) details.push(`"${ref}": listed as unchanged, but it differs from the export (text, title or a picture) — restore it word for word, or list it as changed and show the author`);
    if (decision === "changed" && same) details.push(`"${ref}": listed as changed, but it is word for word as in the export — list it as unchanged, or make the change`);
    if (same === (decision === "unchanged")) counts[decision] += 1;
  }
  for (const [key, item] of baselineById) {
    if (seenBaseline.has(key)) continue;
    const title = item.section?.title ?? item.module?.module?.title;
    const name = typeof title === "object" && title ? Object.values(title).find((v) => typeof v === "string") : title;
    // A removed element is named by its ref in the change list; `refs` (written with the working
    // set) says which element of the export that ref was. Without `refs`, any "removed" counts.
    const removedRefs = decisions ? Object.entries(decisions).filter(([, d]) => d === "removed").map(([ref]) => ref) : [];
    const matched = refs
      ? removedRefs.some((ref) => refs[ref] && `${refs[ref].type}:${refs[ref].id}` === key)
      : removedRefs.length > 0;
    if (matched) counts.removed += 1;
    else details.push(`baseline element «${name ?? key}» is not in the package and the change list does not say "removed" for it — restore it, or list its ref as removed`);
  }
  if (decisions) {
    const refsInPackage = new Set((pkg.objects ?? []).map((o) => o?.clientRef));
    for (const [ref, decision] of Object.entries(decisions)) {
      if (decision === "removed" && refsInPackage.has(ref)) details.push(`"${ref}": listed as removed, but it is still in the package — take it out, or change the decision`);
      if (decision !== "removed" && !refsInPackage.has(ref)) details.push(`"${ref}": in the change list as ${decision}, but not in the package`);
    }
  }
  return {
    name: "changes",
    status: details.length === 0 ? "ok" : "fail",
    summary: `${counts.unchanged} unchanged (word for word), ${counts.changed} changed, ${counts.new} new, ${counts.removed} removed — against the export the package was made from`,
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
 * @param {{ packageFile: string, outFile?: string, stateFile?: string, slidesFile?: string, deckDir?: string, packageOut?: string, changesFile?: string, now?: Date }} options
 * @returns {Promise<{ ok: boolean, checks: Array<{ name: string, status: "ok" | "fail" | "skipped", summary: string, details: string[] }>, files: Array<{ file: string, importAt: string }> }>}
 */
export async function produceCourse({ packageFile, outFile, stateFile, slidesFile, deckDir, packageOut, changesFile, now = new Date() }) {
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

  // #1095: when the course is adjusted from the platform's export, the craft checks (figures,
  // learner text, questions, languages) run on the CHANGED and NEW elements only. The unchanged ones
  // are what the platform already holds — a partly translated title or a test with three questions
  // is the author's course as it stands, and the workflow forbids touching it. The `changes` check
  // below is what guards them: word for word.
  let changesEarly = null;
  if (changesFile) changesEarly = readJson(changesFile, "the change list", []);
  const inScope = (object) => {
    if (!changesEarly?.elements || object?.type === "course") return true;
    const decision = changesEarly.elements[object?.clientRef];
    return decision === "changed" || decision === "new";
  };
  const scoped = changesEarly?.elements
    ? (() => {
        const kept = new Set((pkg.objects ?? []).filter(inScope).map((o) => o.clientRef));
        const objects = (pkg.objects ?? []).filter((o) => kept.has(o?.clientRef)).map((o) =>
          o.type === "course" ? { ...o, payload: { ...o.payload, items: (o.payload?.items ?? []).filter((item) => kept.has(item?.ref)) } } : o,
        );
        return { pkg: { ...pkg, objects }, course: objects.find((o) => o.type === "course") ?? null };
      })()
    : { pkg, course };
  checks.push(checkFigures(scoped.pkg));
  checks.push(checkLearnerText(scoped.pkg));
  let baselineCounts = null;
  if (changesEarly?.elements) {
    // Questions each changed module had in the export, by its origin.
    const baselineEarly = changesEarly.baseline ? readJson(path.resolve(path.dirname(changesFile), changesEarly.baseline), "the baseline export", []) : null;
    const byModuleId = new Map((baselineEarly?.course?.course?.items ?? []).filter((i) => i?.type === "MODULE" && i.origin?.moduleId).map((i) => [i.origin.moduleId, i.module?.activeVersion?.mcqSet?.questions?.length ?? 0]));
    baselineCounts = new Map((pkg.objects ?? []).filter((o) => o?.type === "module" && o.origin?.moduleId && byModuleId.has(o.origin.moduleId)).map((o) => [o.clientRef, byModuleId.get(o.origin.moduleId)]));
  }
  checks.push(checkQuestions(pkg, primary, course, changesEarly?.elements ? { onlyRefs: new Set(scoped.pkg.objects.map((o) => o.clientRef)), baselineCounts } : {}));
  checks.push(checkLanguages(scoped.pkg, primary));

  let master = null;
  if (stateFile) {
    const problems = [];
    try {
      master = readCourseState(stateFile);
    } catch (error) {
      problems.push(`cannot read the course state ${stateFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  // #1095: a course made from the platform's export is an UPDATE; the change list keeps it honest.
  let isUpdate = false;
  if (changesFile) {
    const problems = [];
    const changes = readJson(changesFile, "the change list", problems);
    const baselineFile = changes?.baseline ? path.resolve(path.dirname(changesFile), changes.baseline) : null;
    const baseline = baselineFile ? readJson(baselineFile, "the baseline export", problems) : null;
    if (!baselineFile) problems.push("changes.json names no `baseline` (the export the package was made from)");
    checks.push(changes && baseline ? checkChanges(changes, baseline, pkg) : { name: "changes", status: "fail", summary: "not read", details: problems });
    isUpdate = Boolean(course?.origin?.courseId);
    if (changes && !isUpdate) checks.push({ name: "changes", status: "fail", summary: "the course object has no origin", details: ["a change list only makes sense for a course made from the platform's export (scripts/adjust-from-export.mjs)"] });
  } else if (course?.origin?.courseId) {
    checks.push({ name: "changes", status: "fail", summary: "NOT RUN — the course carries an origin (it is an update) but no --changes file was given", details: ["run with --changes work/changes.json so that unchanged is unchanged"] });
  } else {
    checks.push({ name: "changes", status: "skipped", summary: "not run — no --changes file (only a course adjusted from the platform's export has one)", details: [] });
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
      await deliver(buildFallbackEnvelope(pkg, { exportedAt: now }), file, isUpdate ? IMPORT_AT.courseUpdate : IMPORT_AT.course, integrity);
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
  const names = { "--out": "outFile", "--state": "stateFile", "--slides": "slidesFile", "--deck": "deckDir", "--package-out": "packageOut", "--changes": "changesFile" };
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
        "       [--slides work/treatment.json] [--deck work/deck] [--package-out work/package.complete.json] [--changes work/changes.json]",
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
