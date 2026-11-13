import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1140 etappe 2 (doc/design/PLAN_1140_E2.md): utkastet til et kurs bor ETT sted.
//   - Tabellen `CourseDraft` leses og skrives bare i modules/course/courseDraft.ts. En leser et annet sted (en deltakerrute,
//     en rapport, eksporten) ville vist noe som ikke er publisert.
//   - Den fila importeres bare av kursbyggerens ruter, av låsesjekken i `claimCourseRevision`, og (#1150 skive 2a-1) av
//     regelen «brukes andre steder» i contentLifecycle.ts (elementlista i utkastene) og forhåndsvisningen av kursarkiveringen
//     (om kurset har et utkast). Innholdet i utkastet tolkes ETT sted, `readCourseDraftPayload` i courseDraft.ts.
//   - Utkastet leses fra databasen ved hvert kall og mellomlagres ikke: app og worker må være enige. (Bryteren fra skive
//     2a og 2b er fjernet; utkast er alltid på.)
//   - Låsen har ETT unntak (`publishingDraft: true`), og det gis ETT sted: i ruta som publiserer utkastet, inne i
//     `publishCourseDraft`, som sletter utkastet i samme transaksjon.
// At skrivingen holder innholdslåsen, passer test/content-lock-write-guard.test.js på (`courseDraft` står i lista der).
//
// Relasjonen fra kurset heter `courseDraft` (ikke `draft`), så ordet kan søkes etter: `include: { courseDraft: true }` på et
// kurs leser tabellen like sikkert som `prisma.courseDraft`, og ville sluppet forbi en vakt som bare så etter det siste
// (QA-porten, skive 2a).

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const DRAFT_FILE = "modules/course/courseDraft.ts";
// Sortert: kontrollcasen under sammenligner med de faktiske importørene i sortert rekkefølge.
const DRAFT_IMPORTERS = [
  // #1150: `findCourseDraftItemLists` for regelen «brukes andre steder».
  "modules/course/contentLifecycle.ts",
  // #1150: `findCourseIdsWithDraft` for `hasDraft` i forhåndsvisningen av kursarkiveringen.
  "modules/course/courseArchivePreview.ts",
  "modules/course/courseVersioning.ts",
  "routes/adminCourses.ts",
];
const PUBLISH_ROUTE_FILE = "routes/adminCourses.ts";
// Hvor ordet `publishingDraft` står, og hvor mange ganger (kommentarer ikke medregnet):
const PUBLISHING_DRAFT_USES = {
  // valget i signaturen til `claimCourseRevision`, og sjekken av det
  "modules/course/courseVersioning.ts": 2,
  // valget i signaturen til `updateCourse`, og videresendingen (`{ publishingDraft: options?.publishingDraft }`)
  "modules/course/courseCommands.ts": 3,
  // det ENE stedet det settes: `publishingDraft: true` i ruta som publiserer utkastet
  [PUBLISH_ROUTE_FILE]: 1,
};
// Vakta leser `src/`. Et vedlikeholdsskript i `scripts/` som leser tabellen, ser den ikke; det finnes ingen i dag.
// I filene utenfor courseDraft.ts: kall en variabel `draft`, ikke `courseDraft` — ordet er det vakta søker etter.

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
    // Ordet `courseDraft` hvor som helst (klienten, et alias, relasjonen fra kurset), utenom stien i en import. Og rå SQL
    // mot tabellen. Navnet «CourseDraft» alene er lov (en feilmelding sier det om det som ikke ble funnet).
    const withoutImportPaths = text.replace(/["'][^"'\n]*\/courseDraft\.js["']/g, '""');
    if (/\bcourseDraft\b/.test(withoutImportPaths) || /\b(FROM|INTO|UPDATE|JOIN|TABLE)\s+"CourseDraft"/i.test(text)) out.push(`${file} leser eller skriver CourseDraft. Alt om tabellen bor i ${DRAFT_FILE}`);
    if (/from\s+["'][^"']*\/courseDraft\.js["']/.test(text) && !DRAFT_IMPORTERS.includes(file)) out.push(`${file} importerer ${DRAFT_FILE}. Bare kursbyggerens ruter og låsesjekken gjør det`);
    // #1150: innholdet i utkastet tolkes ETT sted (`readCourseDraftPayload`). En fil som leser `payloadText` selv, er en
    // tolking nummer to: rutene og regelen «brukes andre steder» kunne da lest samme utkast ulikt.
    if (/\bpayloadText\b/.test(text)) out.push(`${file} leser payloadText. Innholdet i utkastet tolkes bare av readCourseDraftPayload i ${DRAFT_FILE}`);
  }
  // Bare på toppnivå: en `let`, `Map` eller `Set` inne i en funksjon lever ikke mellom to kall (en funksjon som svarer med
  // et `Set` over kurs med utkast, er lov).
  if (file === DRAFT_FILE && /^(let|var)\s|^(export\s+)?const\s+\w+[^=\n]*=\s*new\s+(Map|Set|WeakMap)\b|\bsetTimeout\b|\bcache\b/m.test(text)) {
    out.push(`${file} mellomlagrer utkastet. Da kan app og worker bli uenige`);
  }
  // Ordet `publishingDraft` får stå et fast antall ganger i tre filer, og ingen andre steder. Tellingen fanger også
  // `{ publishingDraft: flagg }` og `{ publishingDraft }`, som en regel på `publishingDraft: true` ville sluppet gjennom
  // (QA-porten, skive 2b). Et nytt sted må legges inn her med vilje.
  const uses = [...text.matchAll(/\bpublishingDraft\b/g)].length;
  const allowed = PUBLISHING_DRAFT_USES[file] ?? 0;
  if (uses !== allowed) {
    out.push(`${file} nevner unntaket fra låsen (publishingDraft) ${uses} ganger, ventet ${allowed}. Bare publiseringen av utkastet setter det`);
  }
  if (/\bpublishCourseDraft\(/.test(text) && file !== DRAFT_FILE && file !== PUBLISH_ROUTE_FILE) {
    out.push(`${file} publiserer et kursutkast. Bare ruta POST …/draft/publish gjør det`);
  }
  return out;
}

describe("#1140 etappe 2: vakt for utkastet til et kurs", () => {
  it("tabellen og unntaket fra låsen brukes bare der de skal", () => {
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
  });

  it("unntaket fra låsen gis ETT sted: i ruta som publiserer utkastet, inne i `publishCourseDraft`", () => {
    const text = files.find((f) => f.rel === PUBLISH_ROUTE_FILE).text;
    expect([...text.matchAll(/\bpublishingDraft\s*:\s*true\b/g)]).toHaveLength(1);
    expect([...text.matchAll(/\bpublishCourseDraft\(/g)]).toHaveLength(1);
    const start = text.indexOf('adminCoursesRouter.post("/:courseId/draft/publish"');
    expect(start, "ruta finnes").toBeGreaterThan(-1);
    const route = text.slice(start, text.indexOf("\nadminCoursesRouter.", start + 1));
    // Unntaket står inne i `apply`, som `publishCourseDraft` kaller etter sine egne sjekker og før den sletter utkastet.
    expect(route).toMatch(/await publishCourseDraft\(\{[\s\S]*apply: async \(tx, draft\) => \{[\s\S]*publishingDraft: true,[\s\S]*\}, tx\);/);
    // Og `publishCourseDraft` sletter raden etter at `apply` har skrevet, i samme transaksjon.
    const service = files.find((f) => f.rel === DRAFT_FILE).text;
    const fn = service.slice(service.indexOf("export async function publishCourseDraft"));
    expect(fn.indexOf("await input.apply(tx, existing)")).toBeGreaterThan(-1);
    expect(fn.indexOf("await input.apply(tx, existing)")).toBeLessThan(fn.indexOf("await tx.courseDraft.delete("));
  });

  it("KONTROLLCASE: hver regel fanger feilen sin, og slipper det som er lov", () => {
    const caught = (text, file = "modules/probe.ts") => violationsIn(file, text);
    expect(caught("const draft = await prisma.courseDraft.findUnique({ where: { courseId } });")).toHaveLength(1);
    expect(caught("const d = tx.courseDraft; await d.deleteMany();")).toHaveLength(1);
    expect(caught('await tx.$executeRaw`DELETE FROM "CourseDraft"`;')).toHaveLength(1);
    expect(caught('import { findCourseDraft } from "../course/courseDraft.js";')).toHaveLength(1);
    expect(caught("await claimCourseRevision(tx, courseId, expected, { publishingDraft: true });")).toHaveLength(1);
    // Relasjonen fra kurset: lesing og skriving uten å nevne klientens `courseDraft`-delegat.
    expect(caught("const rows = await prisma.course.findMany({ include: { courseDraft: true } });")).toHaveLength(1);
    expect(caught("await tx.course.update({ where: { id }, data: { courseDraft: { delete: true } } });")).toHaveLength(1);
    expect(caught("const has = course.courseDraft != null;")).toHaveLength(1);
    expect(caught("await publishCourseDraft({ courseId, loaded, apply });")).toHaveLength(1);
    // #1150: en tolking nummer to av den lagrede teksten, også gjennom en rad fra en lovlig funksjon.
    expect(caught("const items = JSON.parse(draft.payloadText).items;")).toHaveLength(1);
    // (I ruta teller også regelen for `publishingDraft`, som sier fra når ordet mangler; bare regelen for teksten måles her.)
    const aboutText = (out) => out.filter((v) => /payloadText/.test(v));
    expect(aboutText(caught("const items = JSON.parse(draft.payloadText).items;", PUBLISH_ROUTE_FILE))).toHaveLength(1);
    expect(aboutText(caught("const payload = readCourseDraftPayload(draft);", PUBLISH_ROUTE_FILE))).toEqual([]);
    // Unntaket fra låsen satt med en variabel, eller en gang til i ruta som har lov til å sette det én gang.
    expect(caught("await claimCourseRevision(tx, courseId, expected, { publishingDraft: flagg });")).toHaveLength(1);
    expect(caught("const publishingDraft = true; await updateCourse(id, input, actor, { publishingDraft }, tx);")).toHaveLength(1);
    expect(caught("a({ publishingDraft: true }); b({ publishingDraft: true });", PUBLISH_ROUTE_FILE)).toHaveLength(1);
    expect(caught("a({ publishingDraft: true });", PUBLISH_ROUTE_FILE)).toEqual([]);
    // Lov i fila som eier tabellen: et `Set` inne i en funksjon.
    expect(caught("export async function findCourseIdsWithDraft(client, ids) {\n  return new Set((await client.courseDraft.findMany()).map((r) => r.courseId));\n}", DRAFT_FILE)).toEqual([]);
    expect(caught("let cachedSwitch = null;", DRAFT_FILE)).toHaveLength(1);
    expect(caught("const seen = new Map();", DRAFT_FILE)).toHaveLength(1);
    // Lov: rutene importerer fila og bruker funksjonene; ord som likner; en kommentar som nevner tabellen.
    expect(caught('import { findCourseDraft } from "../modules/course/courseDraft.js";\nawait findCourseDraft(prisma, id);\na({ publishingDraft: true });', "routes/adminCourses.ts")).toEqual([]);
    expect(caught("const view = await courseDraftView(courseId, draft);")).toEqual([]);
    expect(caught('throw new NotFoundError("CourseDraft", "course_draft_not_found", "This course has no draft.");')).toEqual([]);
    expect(caught("// leser ikke prisma.courseDraft.findUnique her")).toEqual([]);
    expect(caught("export async function findCourseDraft(client, courseId) { return client.courseDraft.findUnique({ where: { courseId } }); }", DRAFT_FILE)).toEqual([]);
  });
});
