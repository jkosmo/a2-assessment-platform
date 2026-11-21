import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#1156, doc/design/PLAN_1156_LEST_PA_TVERS.md): «hvilke seksjoner har deltakeren lest i dette kurset» går gjennom
// ÉN funksjon, `findSectionReadCredit` (src/modules/course/sectionReadCredit.ts).
//
// En lest seksjon teller nå i alle kurs med seksjonen, bare i kurs deltakeren ser, og bare fram til arkiveringen i et arkivert
// kurs. En ny leser som spør `CourseSectionRead` med `courseId` direkte, ville stille fått den gamle regelen tilbake: «Seksjoner
// 0/9» i ett kurs og 1/9 i et annet, for den samme seksjonen. Det var #1156. Vakta finner leserne selv (typesjekkeren, som
// `content-lock-write-guard.test.js`), så unntakene står her, med grunn, og en oppføring som ikke finnes lenger er også rød.
//
// Det som er lov utenom regelen:
//   - lesinger gjort I kurset selv (`findOwnReadPairs`, learnerVisibility.ts): e-post og synlighet krever aktivitet i kurset selv (produkteier
//     14.11.2026), og vilkår 9 i tildelings-e-posten stiller det samme spørsmålet i rå SQL;
//   - aktivitetsrapporten og «Min statistikk»: én hendelse per lesing, med kurset den ble gjort i;
//   - vakta for gamle kursbevis: et bevis utstedt før 2.23.0 matches mot lesingene i SITT kurs;
//   - skriveren (`markSectionRead`) leser raden den skriver.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

const READERS = new Map([
  ["modules/course/sectionReadCredit.ts:findSectionReadCredit", "regelen selv: lesinger fra alle kurs, synlighet, arkivering, seneste, hovedversjon"],
  ["modules/course/learnerVisibility.ts:findOwnReadPairs", "lesinger gjort I kurset: «i gang» i den ukentlige e-posten, «påbegynt» og kurs fra arkiverte klasser"],
  ["modules/course/courseRepository.ts:markSectionRead", "skriveren leser raden den skriver"],
  ["modules/reporting/activityReport.ts:loadActivitySources", "aktivitetsrapporten og «Min statistikk»: én hendelse per lesing"],
  ["modules/reporting/activityReport.ts:getActivityRecent", "aktivitetsrapporten: det siste én person har gjort, med kurset lesingen ble gjort i"],
  ["modules/course/contentLifecycle.ts:assertSectionNotInIssuedCertificate", "vakta for gamle kursbevis (før 2.23.0): lesingen i beviset sitt kurs"],
  // 2.169.0 (produkteier, A, 21.11.2026): kravet til et arkivert kurs kan ikke gjenskapes. Da teller ENHVER lesing av seksjonene som
  // falt ut, i alle kurs og når som helst; utstedelsens regel (bare fram til arkiveringen) ga feil svar (QA-porten, runde 2).
  ["modules/course/courseDeleteGuard.ts:findProgressOnUncertainRequirement", "et arkivert kurs med uklart krav: enhver lesing av det som falt ut, beholder kurset"],
]);

// Relasjoner og rå SQL ser ikke typesjekkeren som en lesing av tabellen. De står her per fil, med grunn.
const TEXT_EXCEPTIONS = new Map([
  ["modules/reporting/activityReport.ts", "«har gjort noe på plattformen» (`courseSectionReads: { some: {} }`), deltakerne i aktivitetsrapporten"],
  ["modules/course/courseAssignmentNotice.ts", "vilkår 9 i tildelings-e-posten: en lesing gjort i kurset selv (rå SQL)"],
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

function rel(fileName) {
  return fileName.split("\\").join("/").slice(SRC.split("\\").join("/").length + 1);
}

function compilerOptions() {
  const config = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  return { ...parsed.options, noEmit: true };
}

function namedFunctionOf(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current;
  }
  return null;
}

function isPrismaDelegate(checker, expression) {
  const type = checker.getTypeAtLocation(expression);
  return Boolean(checker.getPropertyOfType(type, "findMany")) && Boolean(checker.getPropertyOfType(type, "deleteMany"));
}

/** Lesinger av `courseSectionRead` (alt annet enn skriving, også tabellen som verdi), per fil og funksjon. */
function sectionReadReaders(activeProgram, activeFiles) {
  const checker = activeProgram.getTypeChecker();
  const out = [];
  const seen = [];
  for (const fileName of activeFiles) {
    const sourceFile = activeProgram.getSourceFile(fileName);
    if (!sourceFile) continue;
    const file = rel(fileName);
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "courseSectionRead" && isPrismaDelegate(checker, node)) {
        const parent = node.parent;
        const op = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : null;
        if (op === null || !WRITE_OPS.has(op)) {
          const where = `${file}:${namedFunctionOf(node)?.name.getText() ?? "?"}`;
          seen.push(where);
          if (!READERS.has(where)) {
            out.push(`${where} leser courseSectionRead direkte. Lest seksjon i et kurs går gjennom findSectionReadCredit (sectionReadCredit.ts)`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { out, seen };
}

/** Relasjoner (`courseSectionReads`, `sectionReads`, seksjonens `reads`) og rå SQL mot tabellen, for én fil. */
function textReadersIn(file, text) {
  if (TEXT_EXCEPTIONS.has(file)) return [];
  const out = [];
  if (/\b(courseSectionReads|sectionReads)\s*:/.test(text)) out.push(`${file} leser lesinger via en relasjon. Gå gjennom findSectionReadCredit`);
  if (/\breads\s*:\s*\{\s*(some|every|none|where|select|orderBy|take)\b/.test(text) || /_count\s*:\s*\{\s*select\s*:\s*\{[^}]*\breads\b/.test(text)) {
    out.push(`${file} leser seksjonens lesinger via relasjonen \`reads\`. Gå gjennom findSectionReadCredit`);
  }
  if (/"CourseSectionRead"/.test(text)) out.push(`${file} leser CourseSectionRead med rå SQL. Gå gjennom findSectionReadCredit`);
  return out;
}

let program;
let files;

beforeAll(() => {
  files = walk(SRC);
  program = ts.createProgram(files, compilerOptions());
}, 120_000);

const VIRTUAL = join(SRC, "__section_read_guard_probe__.ts");
const VIRTUAL_TEXT = `
import { prisma } from "./db/prisma.js";
export async function probeByCourse(userId: string, courseId: string) { return prisma.courseSectionRead.findMany({ where: { userId, courseId } }); }
export async function probeCount(userId: string) { return prisma.courseSectionRead.count({ where: { userId } }); }
export async function probeAlias() { const d = prisma.courseSectionRead; return d.findFirst(); }
export async function probeWrite() { await prisma.courseSectionRead.deleteMany({ where: { userId: "u" } }); }
`;

describe("#1156: «lest seksjon i kurset» går gjennom findSectionReadCredit", () => {
  it("ingen leser courseSectionRead utenom regelen og de navngitte unntakene", () => {
    expect(sectionReadReaders(program, files).out).toEqual([]);
  });

  it("ingen leser lesingene via en relasjon eller rå SQL utenom unntakene", () => {
    expect(files.flatMap((fileName) => textReadersIn(rel(fileName), readFileSync(fileName, "utf8")))).toEqual([]);
  });

  it("KONTROLLCASE: vakta ser de ekte leserne, og ingen oppføring peker på noe som ikke finnes lenger", () => {
    const { seen } = sectionReadReaders(program, files);
    expect(seen).toContain("modules/course/sectionReadCredit.ts:findSectionReadCredit");
    const stale = [...READERS.keys()].filter((where) => !seen.includes(where));
    expect(stale).toEqual([]);
    // Tekstunntakene må fortsatt ha noe å unnta.
    for (const file of TEXT_EXCEPTIONS.keys()) {
      const text = readFileSync(join(SRC, file), "utf8");
      expect(/\b(courseSectionReads|sectionReads)\s*:|"CourseSectionRead"/.test(text), file).toBe(true);
    }
  });

  it("KONTROLLCASE: en ny leser er rød, med courseId, som telling og via et alias; en skriving er ikke en lesing", () => {
    const host = ts.createCompilerHost(compilerOptions());
    const getSourceFile = host.getSourceFile.bind(host);
    const same = (a, b) => a.split("\\").join("/") === b.split("\\").join("/");
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
      same(fileName, VIRTUAL) ? ts.createSourceFile(fileName, VIRTUAL_TEXT, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => same(fileName, VIRTUAL) || fileExists(fileName);
    const probe = ts.createProgram([VIRTUAL], compilerOptions(), host, program);
    const { out } = sectionReadReaders(probe, [VIRTUAL]);
    for (const expected of [/probeByCourse leser courseSectionRead/, /probeCount leser courseSectionRead/, /probeAlias leser courseSectionRead/]) {
      expect(out.some((v) => expected.test(v)), `${expected}\n${out.join("\n")}`).toBe(true);
    }
    expect(out).toHaveLength(3);
  }, 120_000);

  it("KONTROLLCASE: tekstsjekkene fanger en relasjon og rå SQL, og slipper unntakene", () => {
    const caught = (text, file = "modules/probe.ts") => textReadersIn(file, text);
    expect(caught("where: { courseSectionReads: { some: { courseId } } }")).toHaveLength(1);
    expect(caught("include: { sectionReads: { where: { userId } } }")).toHaveLength(1);
    expect(caught("select: { reads: { where: { userId } } }")).toHaveLength(1);
    expect(caught("_count: { select: { reads: true } }")).toHaveLength(1);
    expect(caught('tx.$queryRaw`SELECT 1 FROM "CourseSectionRead" r WHERE r."courseId" = ${id}`')).toHaveLength(1);
    expect(caught("{ courseSectionReads: { some: {} } }", "modules/reporting/activityReport.ts")).toEqual([]);
    expect(caught("const reads = await load(); return { reads: distinctReads(reads) };")).toEqual([]);
  });
});
