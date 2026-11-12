import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1140 etappe 2 (doc/design/PLAN_1140_E2.md): utkastet til et kurs bor ETT sted.
//   - Tabellen `CourseDraft` leses og skrives bare i modules/course/courseDraft.ts. En leser et annet sted (en deltakerrute,
//     en rapport, eksporten) ville vist noe som ikke er publisert.
//   - Den fila importeres bare av kursbyggerens ruter og av låsesjekken i `claimCourseRevision`.
//   - Bryteren `course_drafts` leses bare der, ved hvert kall, og mellomlagres ikke: app og worker må være enige.
//   - Låsen har ETT unntak (`publishingDraft`), og det kan bare publiseringen av utkastet gi. Skive 2b legger den til her.
// At skrivingen holder innholdslåsen, passer test/content-lock-write-guard.test.js på (`courseDraft` står i lista der).

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const DRAFT_FILE = "modules/course/courseDraft.ts";
const DRAFT_IMPORTERS = ["modules/course/courseVersioning.ts", "routes/adminCourses.ts"];
// Skive 2b: publiseringen av utkastet kommer hit.
const MAY_PUBLISH_DRAFT = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((file) => ({ rel: relative(SRC, file).replace(/\\/g, "/"), text: readFileSync(file, "utf8") }));
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Reglene for én fil, så de kan prøves på kontrollcasene. */
function violationsIn(file, rawText) {
  const text = withoutComments(rawText);
  const out = [];
  if (file !== DRAFT_FILE) {
    // Rå SQL mot tabellen. Navnet alene er lov (en feilmelding sier «CourseDraft» om det som ikke ble funnet).
    if (/\.courseDraft\b/.test(text) || /\b(FROM|INTO|UPDATE|JOIN|TABLE)\s+"CourseDraft"/i.test(text)) out.push(`${file} leser eller skriver CourseDraft. Alt om tabellen bor i ${DRAFT_FILE}`);
    if (/["'`]course_drafts["'`]/.test(text) || /\bCOURSE_DRAFTS_SWITCH_KEY\b/.test(text)) out.push(`${file} leser bryteren selv. Spør isCourseDraftsOn (${DRAFT_FILE})`);
    if (/from\s+["'][^"']*\/courseDraft\.js["']/.test(text) && !DRAFT_IMPORTERS.includes(file)) out.push(`${file} importerer ${DRAFT_FILE}. Bare kursbyggerens ruter og låsesjekken gjør det`);
  }
  // Bare på toppnivå: en `let` inne i en funksjon lever ikke mellom to kall.
  if (file === DRAFT_FILE && /^(let|var)\s|new\s+(Map|Set|WeakMap)\b|\bsetTimeout\b|\bcache\b/m.test(text)) {
    out.push(`${file} mellomlagrer bryteren eller utkastet. Da kan app og worker bli uenige`);
  }
  if (/\bpublishingDraft\s*:/.test(text) && file !== "modules/course/courseVersioning.ts" && !MAY_PUBLISH_DRAFT.includes(file)) {
    out.push(`${file} ber om unntaket fra låsen (publishingDraft). Bare publiseringen av utkastet får det`);
  }
  return out;
}

describe("#1140 etappe 2: vakt for utkastet til et kurs", () => {
  it("tabellen, bryteren og unntaket fra låsen brukes bare der de skal", () => {
    expect(files.flatMap((f) => violationsIn(f.rel, f.text))).toEqual([]);
  });

  it("låsen sitter i `claimCourseRevision`, før telleren tas", () => {
    const text = files.find((f) => f.rel === "modules/course/courseVersioning.ts").text;
    const fn = text.slice(text.indexOf("export async function claimCourseRevision("));
    const lock = fn.indexOf("await assertNoCourseDraftBlocksWrite(client, courseId)");
    const claim = fn.search(/\bcourse\s*\.\s*(update|updateMany)\(/);
    expect(lock, "låsesjekken finnes i claimCourseRevision").toBeGreaterThan(-1);
    expect(claim, "kontroll: vakta ser at telleren skrives").toBeGreaterThan(-1);
    expect(lock).toBeLessThan(claim);
    expect(fn.slice(0, lock)).toMatch(/if \(!options\?\.publishingDraft\)\s*$/);
  });

  it("KONTROLLCASE: vakta ser de ekte brukerne, og ingen oppføring i listene er utdatert", () => {
    const importers = files.filter((f) => /from\s+["'][^"']*\/courseDraft\.js["']/.test(f.text)).map((f) => f.rel).sort();
    expect(importers).toEqual(DRAFT_IMPORTERS);
    expect(files.find((f) => f.rel === DRAFT_FILE).text).toMatch(/\.courseDraft\.findUnique\(/);
    for (const file of MAY_PUBLISH_DRAFT) expect(files.find((f) => f.rel === file)?.text ?? "", file).toMatch(/\bpublishingDraft\s*:/);
  });

  it("KONTROLLCASE: hver regel fanger feilen sin, og slipper det som er lov", () => {
    const caught = (text, file = "modules/probe.ts") => violationsIn(file, text);
    expect(caught("const draft = await prisma.courseDraft.findUnique({ where: { courseId } });")).toHaveLength(1);
    expect(caught("const d = tx.courseDraft; await d.deleteMany();")).toHaveLength(1);
    expect(caught('await tx.$executeRaw`DELETE FROM "CourseDraft"`;')).toHaveLength(1);
    expect(caught('where: { key: "course_drafts" }')).toHaveLength(1);
    expect(caught("where: { key: COURSE_DRAFTS_SWITCH_KEY }")).toHaveLength(1);
    expect(caught('import { findCourseDraft } from "../course/courseDraft.js";')).toHaveLength(1);
    expect(caught("await claimCourseRevision(tx, courseId, expected, { publishingDraft: true });")).toHaveLength(1);
    expect(caught("let cachedSwitch = null;", DRAFT_FILE)).toHaveLength(1);
    expect(caught("const seen = new Map();", DRAFT_FILE)).toHaveLength(1);
    // Lov: rutene importerer fila og bruker funksjonene; ord som likner; en kommentar som nevner tabellen.
    expect(caught('import { findCourseDraft } from "../modules/course/courseDraft.js";\nawait findCourseDraft(prisma, id);', "routes/adminCourses.ts")).toEqual([]);
    expect(caught("const view = await courseDraftView(courseId, draft);")).toEqual([]);
    expect(caught('throw new NotFoundError("CourseDraft", "course_draft_not_found", "This course has no draft.");')).toEqual([]);
    expect(caught("// leser ikke prisma.courseDraft.findUnique her")).toEqual([]);
    expect(caught("export async function findCourseDraft(client, courseId) { return client.courseDraft.findUnique({ where: { courseId } }); }", DRAFT_FILE)).toEqual([]);
  });
});
