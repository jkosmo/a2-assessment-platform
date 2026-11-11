import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#934 skive 4a): alt som skriver innhold, holder innholdslåsen.
//
// doc/DESIGN_934.md, «Låsene»: én lås for alt innhold på plattformen, tatt eksklusivt som FØRSTE setning i
// transaksjonen, og alt annet sjekkes etter den. `runContentWrite` (src/db/contentLock.ts) åpner en slik
// transaksjon og gir en MERKET klient (`ContentWriteTx`). Funksjonene som skriver innhold tar bare imot den, så en
// ny vei som glemmer låsen, kompilerer ikke — så lenge den går gjennom dem. Denne vakta tar resten: ENHVER
// skriving til innholdstabellene i src/, på hvilken som helst klient, må skje på en klient med merket.
//
// Vakta bruker TypeScripts egen typesjekker, ikke tekstsøk: den spør hva slags klient skrivingen faktisk skjer på.
// En skriving på `prisma` (den globale klienten) eller på en transaksjon fra `runInTransaction` er rød, uansett
// hva variabelen heter.
//
// I tillegg: merket kan bare lages i contentLock.ts (ingen `as ContentWriteTx` andre steder), og låsen tas bare
// der — slik er den alltid det første transaksjonen gjør.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const LOCK_FILE = "db/contentLock.ts";

// Innholdstabellene (doc/DESIGN_934.md, «Én hjelpefunksjon»), pluss `CourseVersion`: den skrives bare av
// versjonsendringen, og den skal også holde låsen.
// #934 skive 5a-2: `CourseModuleRequirement` er hvilke moduler et kurs krever, så den skrives under samme lås.
const CONTENT_MODELS = new Set(["courseItem", "course", "module", "moduleVersion", "courseSection", "courseSectionVersion", "sectionAsset", "courseVersion", "courseModuleRequirement"]);
const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
const CONTENT_TABLES_SQL = /"(CourseItem|Course|Module|ModuleVersion|CourseSection|CourseSectionVersion|SectionAsset|CourseVersion|CourseModuleRequirement)"/;

// Bevisste unntak (doc/DESIGN_934.md, «Kjente mangler» nr. 3): vedlikeholdsskript som kjøres for hånd, én gang,
// ikke mens forfattere arbeider. Unntaket er per FUNKSJON, så en ny skriver i samme fil ikke slipper gjennom.
const EXCEPTIONS = [
  { file: "services/localizedTitleCleanup.ts", fn: "collapseDuplicatedLocalizedTitles", why: "vedlikeholdsskript (maint:collapse-duplicated-titles)" },
  { file: "modules/course/assetCommands.ts", fn: "repairUnreadableSvgAssets", why: "vedlikeholdsskript (maint:repair-unreadable-svg-assets)" },
];

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

function enclosingFunctionName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText();
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent)) {
      // En pil som er en variabel, er ikke selve funksjonen; gå videre ut til en navngitt funksjon.
      continue;
    }
  }
  return null;
}

function isPrismaDelegate(checker, expression) {
  const type = checker.getTypeAtLocation(expression);
  return Boolean(checker.getPropertyOfType(type, "findMany")) && Boolean(checker.getPropertyOfType(type, "deleteMany"));
}

function holdsWriteLock(checker, expression) {
  return Boolean(checker.getPropertyOfType(checker.getTypeAtLocation(expression), "__contentWriteLock"));
}

// #934 skive 5a-1: det en deltaker har gjort. Alt dette skrives under deltakerlåsen (`LearnerTx`), eller under den
// eksklusive innholdslåsen, som stenger ute alle lesinger og utstedelser (importen flytter lesinger, #997 setter
// `SUPERSEDED`). For innleveringer gjelder regelen å lage dem; statusen flyttes av vurderingsjobben.
const ALL_WRITES = WRITE_OPS;
const LEARNER_MODELS = new Map([
  ["courseCompletion", ALL_WRITES],
  ["courseSectionRead", ALL_WRITES],
  ["assessmentDecision", ALL_WRITES],
  ["certificationStatus", ALL_WRITES],
  // #934 skive 5a-2: beståtte per innlevering.
  ["modulePass", ALL_WRITES],
  ["submission", new Set(["create", "createMany", "createManyAndReturn", "upsert"])],
]);
const LEARNER_TABLES_SQL = /"(CourseCompletion|CourseSectionRead|AssessmentDecision|CertificationStatus|ModulePass)"|INSERT\s+INTO\s+"Submission"/i;

function holdsLearnerLock(checker, expression) {
  const type = checker.getTypeAtLocation(expression);
  return Boolean(checker.getPropertyOfType(type, "__learnerLock")) || Boolean(checker.getPropertyOfType(type, "__contentWriteLock"));
}

/** Skrivinger av det en deltaker har gjort, på en klient uten låsen. Samme tanke som `unlockedWrites` under. */
function unlockedLearnerWrites(program, files) {
  const checker = program.getTypeChecker();
  const out = [];
  const locked = [];
  for (const fileName of files) {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) throw new Error(`fant ikke ${fileName} i programmet`);
    const file = rel(fileName);
    const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && LEARNER_MODELS.has(node.name.text) && isPrismaDelegate(checker, node)) {
        const parent = node.parent;
        const op = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : null;
        if (op === null) {
          out.push(`${file}:${lineOf(node)} bruker \`${node.getText()}\` som verdi — skriv på klienten direkte`);
        } else if (LEARNER_MODELS.get(node.name.text).has(op)) {
          if (holdsLearnerLock(checker, node.expression)) locked.push(`${file}:${lineOf(node)}`);
          else out.push(`${file}:${lineOf(node)} skriver ${node.name.text}.${op} uten deltakerlåsen (${enclosingFunctionName(node) ?? "?"})`);
        }
      }
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const params = checker.getResolvedSignature(node)?.getParameters() ?? [];
        node.arguments.forEach((arg, index) => {
          const param = params[Math.min(index, params.length - 1)];
          if (!param) return;
          const paramType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(param, node));
          if (!checker.getPropertyOfType(paramType, "__learnerLock")) return;
          if (holdsLearnerLock(checker, arg)) return;
          out.push(`${file}:${lineOf(arg)} sender en klient uten deltakerlåsen til ${node.expression.getText().slice(0, 60)} (${enclosingFunctionName(node) ?? "?"})`);
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { out, locked };
}

/** Skrivinger til innholdstabellene på en klient uten merket. */
function unlockedWrites(program, files) {
  const checker = program.getTypeChecker();
  const out = [];
  const locked = [];
  for (const fileName of files) {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) throw new Error(`fant ikke ${fileName} i programmet`);
    const file = rel(fileName);
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && CONTENT_MODELS.has(node.name.text) && isPrismaDelegate(checker, node)) {
        const where = `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const parent = node.parent;
        const op = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : null;
        const fn = enclosingFunctionName(node);
        const excepted = EXCEPTIONS.some((e) => e.file === file && e.fn === fn);
        if (op === null) {
          // Tabellen som verdi (`const d = tx.module`): da kan skrivingen skje et sted vakta ikke ser.
          if (!excepted) out.push(`${where} bruker \`${node.getText()}\` som verdi — skriv på klienten direkte`);
        } else if (WRITE_OPS.has(op)) {
          if (holdsWriteLock(checker, node.expression)) locked.push(where);
          else if (!excepted) out.push(`${where} skriver ${node.name.text}.${op} uten innholdslåsen (${fn ?? "?"})`);
        }
      }
      // En klient uten merket sendt til en funksjon som krever det (`createAdminContentWriter(tx)`,
      // `setCourseItems(…, tx)`): typesjekkeren nekter det ved bygging, og vakta nekter det her også, så den ikke
      // er avhengig av at noen kjørte `npm run build`.
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const signature = checker.getResolvedSignature(node);
        const params = signature?.getParameters() ?? [];
        node.arguments.forEach((arg, index) => {
          const param = params[Math.min(index, params.length - 1)];
          if (!param) return;
          const paramType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(param, node));
          if (!checker.getPropertyOfType(paramType, "__contentWriteLock")) return;
          if (holdsWriteLock(checker, arg)) return;
          // `undefined` for en valgfri klient: funksjonen åpner da sin egen låste transaksjon.
          if (checker.getTypeAtLocation(arg).flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) return;
          const fn = enclosingFunctionName(node);
          if (EXCEPTIONS.some((e) => e.file === file && e.fn === fn)) return;
          out.push(`${file}:${sourceFile.getLineAndCharacterOfPosition(arg.getStart()).line + 1} sender en klient uten innholdslåsen til ${node.expression.getText().slice(0, 60)} (${fn ?? "?"})`);
        });
      }
      if (ts.isElementAccessExpression(node) && Boolean(checker.getPropertyOfType(checker.getTypeAtLocation(node.expression), "courseItem"))) {
        out.push(`${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} slår opp en tabell med [] på en Prisma-klient`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { out, locked };
}

function textViolations(files) {
  return files.flatMap((fileName) => textViolationsIn(rel(fileName), readFileSync(fileName, "utf8")));
}

function textViolationsIn(file, text) {
  const out = [];
  {
    if (file === LOCK_FILE) return out;
    if (/__content(Write|Read)Lock/.test(text)) out.push(`${file} nevner merket direkte — bare ${LOCK_FILE} lager det`);
    if (/as\s+Content(Write|Read)Tx\b|<Content(Write|Read)Tx>/.test(text)) out.push(`${file} gjør en klient om til Content…Tx med en typekonvertering`);
    if (/pg_advisory_xact_lock(_shared)?\s*\(\s*\$\{\s*CONTENT_LOCK_KEY/.test(text) || /\bwithContentLock\s*\(/.test(text)) {
      out.push(`${file} tar innholdslåsen selv — bruk runContentWrite/runContentRead, så låsen er det første transaksjonen gjør`);
    }
    if (/__learnerLock/.test(text)) out.push(`${file} nevner deltakermerket direkte — bare ${LOCK_FILE} lager det`);
    if (/as\s+Learner(Content)?Tx\b|<Learner(Content)?Tx>/.test(text)) out.push(`${file} gjør en klient om til Learner…Tx med en typekonvertering`);
    if (/\bLEARNER_LOCK_NAMESPACE\b/.test(text) || /\bwithLearnerLock\s*\(/.test(text)) {
      out.push(`${file} tar deltakerlåsen selv — bruk runLearnerWrite/runContentReadForLearner, så rekkefølgen holder`);
    }
    for (const match of text.matchAll(/\$(executeRaw|queryRaw)(Unsafe)?\s*(<[^>]*>)?\s*[`(]/g)) {
      const snippet = text.slice(match.index, match.index + 400);
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(snippet) && CONTENT_TABLES_SQL.test(snippet)) {
        out.push(`${file}:${text.slice(0, match.index).split("\n").length} skriver en innholdstabell med rå SQL`);
      }
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(snippet) && LEARNER_TABLES_SQL.test(snippet)) {
        out.push(`${file}:${text.slice(0, match.index).split("\n").length} skriver det en deltaker har gjort, med rå SQL`);
      }
    }
  }
  return out;
}

const VIRTUAL = join(SRC, "__content_lock_guard_probe__.ts");
const VIRTUAL_TEXT = `
import { prisma } from "./db/prisma.js";
import { runInTransaction } from "./db/transaction.js";
import { runContentWrite, type ContentWriteTx } from "./db/contentLock.js";
export async function probeUnlockedTx() { await runInTransaction(async (tx) => tx.courseItem.deleteMany({ where: { courseId: "x" } })); }
export async function probeGlobal() { await prisma.courseSection.update({ where: { id: "x" }, data: { title: "y" } }); }
export async function probeAlias() { await runContentWrite(async (tx) => { const d = tx.module; return d.count(); }); }
export async function probeLocked() { await runContentWrite(async (tx) => tx.courseItem.deleteMany({ where: { courseId: "x" } })); }
export async function probeParam(tx: ContentWriteTx) { await tx.sectionAsset.deleteMany({ where: { sectionId: "x" } }); }
export async function probeRequirement() { await prisma.courseModuleRequirement.deleteMany({ where: { moduleId: "x" } }); }
// @ts-expect-error — det er nettopp feilen: en transaksjon uten låsen sendt til en som krever den.
export async function probePass() { await runInTransaction(async (tx) => probeParam(tx)); }
`;

let program;
let files;

beforeAll(() => {
  files = walk(SRC);
  program = ts.createProgram(files, compilerOptions());
}, 120_000);

describe("#934 skive 4a: alt som skriver innhold, holder innholdslåsen", () => {
  it("ingen skriving til innholdstabellene i src/ skjer på en klient uten innholdslåsen", () => {
    const { out } = unlockedWrites(program, files);
    expect(out, "Ny vei inn som skriver innhold uten låsen. Åpne transaksjonen med runContentWrite (src/db/contentLock.ts), eller ta imot ContentWriteTx fra kalleren.").toEqual([]);
  });

  it("merket lages bare i contentLock.ts, låsen tas bare der, og ingen skriver innhold med rå SQL", () => {
    expect(textViolations(files)).toEqual([]);
  });

  it("KONTROLLCASE: vakta ser de låste skrivingene — ellers måler den ingenting", () => {
    const { locked } = unlockedWrites(program, files);
    // Kursets elementer, kurs, moduler, modulversjoner, seksjoner, seksjonsversjoner og bilder skrives alle et sted.
    expect(locked.length).toBeGreaterThanOrEqual(50);
    for (const owner of ["modules/course/courseCommands.ts", "modules/course/sectionCommands.ts", "modules/adminContent/adminContentRepository.ts", "modules/course/courseVersioning.ts", "modules/adminContent/contentImportService.ts", "modules/course/courseCascadeDeleteService.ts", "modules/course/assetCommands.ts"]) {
      expect(locked.some((where) => where.startsWith(`${owner}:`)), owner).toBe(true);
    }
  });

  it("KONTROLLCASE: en skriving uten låsen er rød — på runInTransaction, på den globale klienten, via et alias, og en ulåst klient sendt videre", () => {
    const host = ts.createCompilerHost(compilerOptions());
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
      fileName.split("\\").join("/") === VIRTUAL.split("\\").join("/")
        ? ts.createSourceFile(fileName, VIRTUAL_TEXT, languageVersion, true)
        : getSourceFile(fileName, languageVersion, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => fileName.split("\\").join("/") === VIRTUAL.split("\\").join("/") || fileExists(fileName);
    const probe = ts.createProgram([VIRTUAL], compilerOptions(), host, program);
    const { out, locked } = unlockedWrites(probe, [VIRTUAL]);
    expect(out.some((v) => /deleteMany uten innholdslåsen \(probeUnlockedTx\)/.test(v)), out.join("\n")).toBe(true);
    expect(out.some((v) => /courseSection\.update uten innholdslåsen \(probeGlobal\)/.test(v)), out.join("\n")).toBe(true);
    expect(out.some((v) => /som verdi/.test(v)), out.join("\n")).toBe(true);
    expect(out.some((v) => /sender en klient uten innholdslåsen til probeParam \(probePass\)/.test(v)), out.join("\n")).toBe(true);
    expect(out.some((v) => /courseModuleRequirement\.deleteMany uten innholdslåsen \(probeRequirement\)/.test(v)), out.join("\n")).toBe(true);
    expect(out).toHaveLength(5);
    expect(locked).toHaveLength(2);
  }, 120_000);

  it("KONTROLLCASE: tekstsjekkene fanger en egen typekonvertering og et eget låsekall", () => {
    const caught = (text) => textViolationsIn("modules/probe.ts", text);
    expect(caught("const t = tx as ContentWriteTx;")).toHaveLength(1);
    expect(caught("await withContentLock(tx, 'exclusive')")).toHaveLength(1);
    expect(caught('await tx.$executeRaw`UPDATE "CourseItem" SET x = 1`')).toHaveLength(1);
    expect(caught("const t = tx as DbTransactionClient;")).toEqual([]);
  });
});

const LEARNER_VIRTUAL = join(SRC, "__learner_lock_guard_probe__.ts");
const LEARNER_VIRTUAL_TEXT = `
import { prisma } from "./db/prisma.js";
import { runInTransaction } from "./db/transaction.js";
import { runContentRead, runContentReadForLearner, runContentWrite, runLearnerWrite, type LearnerTx } from "./db/contentLock.js";
const data = {} as never;
export async function probeCompletionTx() { await runInTransaction(async (tx) => tx.courseCompletion.create({ data })); }
export async function probeCompletionRead() { await runContentRead(async (tx) => tx.courseCompletion.create({ data })); }
export async function probeDecisionGlobal() { await prisma.assessmentDecision.create({ data }); }
export async function probeReadGlobal() { await prisma.courseSectionRead.upsert(data); }
export async function probeStatusGlobal() { await prisma.certificationStatus.upsert(data); }
export async function probeSubmissionGlobal() { await prisma.submission.create({ data }); }
export async function probePassGlobal() { await prisma.modulePass.deleteMany({ where: { userId: "u" } }); }
export async function probeAlias() { await runLearnerWrite("u", async (tx) => { const d = tx.courseCompletion; return d.count(); }); }
export async function probeStatusUpdate() { await prisma.submission.update(data); }
export async function probeLearner() { await runLearnerWrite("u", async (tx) => tx.assessmentDecision.create({ data })); }
export async function probeBoth() { await runContentReadForLearner("u", async (tx) => tx.courseCompletion.create({ data })); }
export async function probeWrite() { await runContentWrite(async (tx) => tx.courseSectionRead.createMany({ data })); }
export async function probeParam(tx: LearnerTx) { await tx.submission.create({ data }); }
// @ts-expect-error — det er nettopp feilen: en transaksjon uten låsen sendt til en som krever den.
export async function probePass() { await runInTransaction(async (tx) => probeParam(tx)); }
`;

describe("#934 skive 5a-1: det en deltaker har gjort, skrives under deltakerlåsen", () => {
  it("ingen innlevering, vedtak, modulstatus, lesing eller kursbevis skrives på en klient uten låsen", () => {
    const { out } = unlockedLearnerWrites(program, files);
    expect(out, "Ny vei inn som skriver det en deltaker har gjort, uten låsen. Åpne transaksjonen med runLearnerWrite eller runContentReadForLearner (src/db/contentLock.ts), eller ta imot LearnerTx fra kalleren.").toEqual([]);
  });

  it("KONTROLLCASE: vakta ser de låste skrivingene — alle fem tabellene, der de hører hjemme", () => {
    const { locked } = unlockedLearnerWrites(program, files);
    for (const owner of ["modules/course/courseRepository.ts", "repositories/decisionRepository.ts", "modules/certification/certificationRepository.ts", "modules/submission/submissionRepository.ts", "modules/adminContent/contentImportService.ts"]) {
      expect(locked.some((where) => where.startsWith(`${owner}:`)), owner).toBe(true);
    }
  });

  it("KONTROLLCASE: en skriving uten låsen er rød, på runInTransaction, på en delt innholdslås, på den globale klienten, via et alias, og en ulåst klient sendt videre", () => {
    const host = ts.createCompilerHost(compilerOptions());
    const getSourceFile = host.getSourceFile.bind(host);
    const same = (a, b) => a.split("\\").join("/") === b.split("\\").join("/");
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
      same(fileName, LEARNER_VIRTUAL) ? ts.createSourceFile(fileName, LEARNER_VIRTUAL_TEXT, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => same(fileName, LEARNER_VIRTUAL) || fileExists(fileName);
    const probe = ts.createProgram([LEARNER_VIRTUAL], compilerOptions(), host, program);
    const { out, locked } = unlockedLearnerWrites(probe, [LEARNER_VIRTUAL]);
    for (const expected of [
      /courseCompletion\.create uten deltakerlåsen \(probeCompletionTx\)/,
      /courseCompletion\.create uten deltakerlåsen \(probeCompletionRead\)/,
      /assessmentDecision\.create uten deltakerlåsen \(probeDecisionGlobal\)/,
      /courseSectionRead\.upsert uten deltakerlåsen \(probeReadGlobal\)/,
      /certificationStatus\.upsert uten deltakerlåsen \(probeStatusGlobal\)/,
      /submission\.create uten deltakerlåsen \(probeSubmissionGlobal\)/,
      /modulePass\.deleteMany uten deltakerlåsen \(probePassGlobal\)/,
      /som verdi/,
      /sender en klient uten deltakerlåsen til probeParam \(probePass\)/,
    ]) {
      expect(out.some((v) => expected.test(v)), `${expected}\n${out.join("\n")}`).toBe(true);
    }
    // `submission.update` er vurderingsjobbens, og står ikke her. De fire låste er ikke med.
    expect(out).toHaveLength(9);
    expect(locked).toHaveLength(4);
  }, 120_000);

  it("KONTROLLCASE: tekstsjekkene fanger en egen typekonvertering og et eget låsekall", () => {
    const caught = (text) => textViolationsIn("modules/probe.ts", text);
    expect(caught("const t = tx as LearnerTx;")).toHaveLength(1);
    expect(caught("const t = tx as LearnerContentTx;")).toHaveLength(1);
    expect(caught("await withLearnerLock(tx, userId)")).toHaveLength(1);
    expect(caught('await tx.$executeRaw`UPDATE "CourseCompletion" SET x = 1`')).toHaveLength(1);
    expect(caught('await tx.$executeRawUnsafe(\'INSERT INTO "Submission" VALUES (1)\')')).toHaveLength(1);
    expect(caught('await tx.$queryRaw<Row[]>`DELETE FROM "CertificationStatus"`')).toHaveLength(1);
    expect(caught('await tx.$queryRaw`SELECT * FROM "CourseCompletion"`')).toEqual([]);
    expect(caught('await tx.$executeRaw`DELETE FROM "ModulePass"`')).toHaveLength(1);
    expect(caught('await tx.$executeRaw`UPDATE "CourseModuleRequirement" SET x = 1`')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #934 skive 5a-2 (doc/DESIGN_934.md, «5a-2 — bygget», «Veier inn»): nummeret, kravet og beståtten skrives ett sted.
//
// Låsen alene sier ikke at en ny vei husker dem. Disse sjekkene spør derfor HVOR skrivingen skjer, ikke bare på hvilken klient:
//   - en modulversjon settes live bare i `publishModuleVersion`, for der får den nummer;
//   - versjonsnummeret skrives bare der og i `numberModuleHistory`;
//   - `CourseModuleRequirement` skrives bare i moduleVersioning.ts;
//   - `ModulePass` skrives bare i modulePass.ts og tilbakefyllingen;
//   - den som skriver kursets elementer, kaller `syncModuleRequirements`;
//   - den som lager et vedtak, kaller `upsertCertificationStatusFromDecision`.
// ─────────────────────────────────────────────────────────────────────────────
function namedFunctionOf(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current;
  }
  return null;
}

/** Skrivinger av `model` i disse filene, med fil, funksjon og argumentene som tekst. */
function writesOf(activeProgram, activeFiles, model) {
  const checker = activeProgram.getTypeChecker();
  const out = [];
  for (const fileName of activeFiles) {
    const sourceFile = activeProgram.getSourceFile(fileName);
    if (!sourceFile) continue;
    const file = rel(fileName);
    const visit = (node) => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && WRITE_OPS.has(node.expression.name.text)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.name.text === model
        && isPrismaDelegate(checker, node.expression.expression)
      ) {
        const fn = namedFunctionOf(node);
        out.push({
          file,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          fn: fn?.name.getText() ?? "?",
          fnText: fn?.getText() ?? "",
          op: node.expression.name.text,
          // Det som skrives. `select` og `where` nevner også feltene, men det er ikke å skrive dem.
          args: node.arguments
            .flatMap((a) => (ts.isObjectLiteralExpression(a) ? a.properties.filter((p) => !["select", "where", "include"].includes(p.name?.getText())) : [a]))
            .map((a) => a.getText())
            .join(","),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return out;
}

const ACTIVATION = /\bactiveVersionId\s*:(?!\s*null\b)|\bactiveVersion\s*:/;
const NUMBER_FIELDS = /\b(versionMajor|versionMinor)\b/;
const NUMBERED_PUBLISH = new Set(["modules/adminContent/adminContentRepository.ts:publishModuleVersion", "modules/adminContent/moduleVersioning.ts:numberModuleHistory"]);

/** Alle brudd på reglene over, så de kan prøves både på koden og på kontrollcasene. */
function placementViolations(activeProgram, activeFiles) {
  const where = (w) => `${w.file}:${w.line} (${w.fn})`;
  const out = [];
  for (const w of writesOf(activeProgram, activeFiles, "module")) {
    if (ACTIVATION.test(w.args) && `${w.file}:${w.fn}` !== "modules/adminContent/adminContentRepository.ts:publishModuleVersion") {
      out.push(`${where(w)} setter en modulversjon live utenom publishModuleVersion, og den får ikke nummer`);
    }
  }
  for (const w of writesOf(activeProgram, activeFiles, "moduleVersion")) {
    if (NUMBER_FIELDS.test(w.args) && !NUMBERED_PUBLISH.has(`${w.file}:${w.fn}`)) out.push(`${where(w)} skriver versjonsnummeret utenom de to stedene`);
    if (/\bpublishedAt\s*:/.test(w.args) && !NUMBERED_PUBLISH.has(`${w.file}:${w.fn}`)) out.push(`${where(w)} setter publishedAt utenom publishModuleVersion`);
  }
  for (const w of writesOf(activeProgram, activeFiles, "courseModuleRequirement")) {
    if (w.file !== "modules/adminContent/moduleVersioning.ts") out.push(`${where(w)} skriver kravet utenom moduleVersioning.ts`);
  }
  for (const w of writesOf(activeProgram, activeFiles, "modulePass")) {
    // Tilbakefyllingen (moduleCreditBackfill.ts) skrev også, og er fjernet 2026-11-08.
    if (w.file !== "modules/certification/modulePass.ts") out.push(`${where(w)} skriver ModulePass utenom vedtakssporet`);
  }
  for (const w of writesOf(activeProgram, activeFiles, "courseItem")) {
    // Slettingen av hele kurset tar kravene med seg: fremmednøkkelen står med CASCADE.
    if (w.file === "modules/course/courseCascadeDeleteService.ts" && w.op === "deleteMany") continue;
    if (!/\bsyncModuleRequirements\(/.test(w.fnText)) out.push(`${where(w)} skriver kursets elementer uten syncModuleRequirements`);
  }
  for (const w of writesOf(activeProgram, activeFiles, "assessmentDecision")) {
    if (w.file === "repositories/decisionRepository.ts") continue;
    out.push(`${where(w)} lager et vedtak utenom decisionRepository`);
  }
  // Vedtakene går gjennom repositoriet; den som kaller det, må også skrive status og ModulePass.
  const checker = activeProgram.getTypeChecker();
  for (const fileName of activeFiles) {
    const sourceFile = activeProgram.getSourceFile(fileName);
    if (!sourceFile) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createAssessmentDecision") {
        const params = checker.getResolvedSignature(node)?.getParameters() ?? [];
        const first = params[0] ? checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(params[0], node)) : null;
        if (first && checker.getPropertyOfType(first, "__learnerLock")) {
          const fn = namedFunctionOf(node);
          if (!/\bupsertCertificationStatusFromDecision\(/.test(fn?.getText() ?? "")) {
            out.push(`${rel(fileName)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1} (${fn?.name.getText() ?? "?"}) lager et vedtak uten upsertCertificationStatusFromDecision`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return out;
}

const PLACEMENT_VIRTUAL = join(SRC, "__placement_guard_probe__.ts");
const PLACEMENT_VIRTUAL_TEXT = `
import { runContentWrite, runLearnerWrite, type LearnerTx } from "./db/contentLock.js";
import { createDecisionRepository } from "./repositories/decisionRepository.js";
const data = {} as never;
export async function probeActivate() { await runContentWrite(async (tx) => tx.module.update({ where: { id: "m" }, data: { activeVersionId: "v" } })); }
export async function probeNullOk() { await runContentWrite(async (tx) => tx.module.update({ where: { id: "m" }, data: { activeVersionId: null } })); }
export async function probeNumber() { await runContentWrite(async (tx) => tx.moduleVersion.update({ where: { id: "v" }, data: { versionMajor: 9 } })); }
export async function probePublishedAt() { await runContentWrite(async (tx) => tx.moduleVersion.updateMany({ where: { id: "v" }, data: { publishedAt: new Date() } })); }
export async function probeRequirement() { await runContentWrite(async (tx) => tx.courseModuleRequirement.deleteMany({ where: { moduleId: "m" } })); }
export async function probePass() { await runLearnerWrite("u", async (tx) => tx.modulePass.deleteMany({ where: { userId: "u" } })); }
export async function probeItems() { await runContentWrite(async (tx) => tx.courseItem.deleteMany({ where: { courseId: "c" } })); }
export async function probeDecision(tx: LearnerTx) { await createDecisionRepository(tx).createAssessmentDecision(tx, data); }
`;

describe("#934 skive 5a-2: nummeret, kravet og beståtten skrives ett sted", () => {
  it("koden holder seg til de stedene", () => {
    expect(placementViolations(program, files)).toEqual([]);
  });

  it("KONTROLLCASE: vakta ser de ekte skrivingene", () => {
    const seen = (model) => writesOf(program, files, model).map((w) => `${w.file}:${w.fn}`);
    expect(seen("moduleVersion")).toContain("modules/adminContent/adminContentRepository.ts:publishModuleVersion");
    expect(seen("moduleVersion")).toContain("modules/adminContent/moduleVersioning.ts:numberModuleHistory");
    expect(seen("module")).toContain("modules/adminContent/adminContentRepository.ts:publishModuleVersion");
    expect(seen("courseModuleRequirement")).toContain("modules/adminContent/moduleVersioning.ts:syncModuleRequirements");
    expect(seen("courseModuleRequirement")).toContain("modules/adminContent/moduleVersioning.ts:raiseModuleRequirementInCourse");
    expect(seen("modulePass")).toContain("modules/certification/modulePass.ts:recordModulePassFromDecision");
    expect(seen("courseItem")).toContain("modules/course/courseCommands.ts:writeCourseItems");
    expect(seen("courseItem")).toContain("modules/course/courseCommands.ts:setCourseModules");
  });

  it("KONTROLLCASE: hvert brudd er rødt, og `activeVersionId: null` er lov", () => {
    const host = ts.createCompilerHost(compilerOptions());
    const getSourceFile = host.getSourceFile.bind(host);
    const same = (a, b) => a.split("\\").join("/") === b.split("\\").join("/");
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
      same(fileName, PLACEMENT_VIRTUAL) ? ts.createSourceFile(fileName, PLACEMENT_VIRTUAL_TEXT, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => same(fileName, PLACEMENT_VIRTUAL) || fileExists(fileName);
    const probe = ts.createProgram([PLACEMENT_VIRTUAL], compilerOptions(), host, program);
    const out = placementViolations(probe, [PLACEMENT_VIRTUAL]);
    for (const expected of [
      /\(probeActivate\) setter en modulversjon live/,
      /\(probeNumber\) skriver versjonsnummeret/,
      /\(probePublishedAt\) setter publishedAt/,
      /\(probeRequirement\) skriver kravet/,
      /\(probePass\) skriver ModulePass/,
      /\(probeItems\) skriver kursets elementer/,
      /\(probeDecision\) lager et vedtak uten/,
    ]) {
      expect(out.some((v) => expected.test(v)), `${expected}\n${out.join("\n")}`).toBe(true);
    }
    expect(out).toHaveLength(7);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// #934 skive 5a-3 (doc/DESIGN_934.md, «5a-3 — bygget»): fremdrift i kurs går gjennom ÉN funksjon.
//   - `CertificationStatus`, `ModulePass` og `CourseModuleRequirement` leses bare av de stedene som står under. Alt som svarer på
//     «har deltakeren bestått i dette kurset», spør `findModuleProgress` (moduleCredit.ts).
//   - `isCertificationPassed` og `CERTIFICATION_PASSED_STATUSES` brukes ikke utenfor disse stedene. Heller ikke via en relasjon.
//   - 2026-11-08: den gamle regelen (bryteren av) er fjernet. Ingenting skriver `SUPERSEDED` på modulstatus, og ingenting i `src/`
//     leser bryteren: regelen om beståtte per kurs gjelder alltid. Bare modulePassSwitch.ts kjenner raden, for skriptet som slår
//     den på. Listene under har også en sjekk for oppføringer som ikke finnes lenger.
// ─────────────────────────────────────────────────────────────────────────────
const PROGRESS_READERS = new Map([
  [
    "certificationStatus",
    new Set([
      // Det som gjelder modulen uten kurs: statusrapporten, #997-tallet i den gamle dialogen og vakta mot nedgradering.
      "repositories/reportingRepository.ts:findCertificationsForStatusReport",
      "modules/certification/certificationRepository.ts:findPassedCertificationsForModule",
      "modules/certification/certificationRepository.ts:findByUserAndModule",
      // Nummereringen av historikk uten nummer leser #997-sporet (`supersededByVersionId`).
      "modules/adminContent/moduleVersioning.ts:numberModuleHistory",
    ]),
  ],
  [
    "modulePass",
    new Set(["modules/course/moduleCredit.ts:readPerCourseRule", "modules/course/moduleCredit.ts:findCreditedModules", "modules/course/moduleCredit.ts:hasValidModulePass"]),
  ],
  [
    "courseModuleRequirement",
    new Set([
      "modules/course/moduleCredit.ts:readPerCourseRule",
      "modules/course/moduleCredit.ts:findCreditedModules",
      "modules/adminContent/moduleVersioning.ts:syncModuleRequirements",
      // #1140 etappe 1: hovedversjonen kurset VISER (`shownModuleMajor`). Ikke fremdrift: hvilken versjon en deltaker får,
      // avgjøres i participantModuleVersion.ts. Vakt: participant-module-version-guard.test.js.
      "modules/adminContent/moduleVersioning.ts:findShownModuleMajors",
    ]),
  ],
]);

function progressReadViolations(activeProgram, activeFiles) {
  const checker = activeProgram.getTypeChecker();
  const out = [];
  const seen = [];
  for (const fileName of activeFiles) {
    const sourceFile = activeProgram.getSourceFile(fileName);
    if (!sourceFile) continue;
    const file = rel(fileName);
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && PROGRESS_READERS.has(node.name.text) && isPrismaDelegate(checker, node)) {
        const parent = node.parent;
        const op = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : null;
        if (op === null || !WRITE_OPS.has(op)) {
          const where = `${file}:${namedFunctionOf(node)?.name.getText() ?? "?"}`;
          seen.push(`${node.name.text} ${where}`);
          if (!PROGRESS_READERS.get(node.name.text).has(where)) {
            out.push(`${where} leser ${node.name.text} direkte. Fremdrift i kurs går gjennom findModuleProgress (moduleCredit.ts)`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { out, seen };
}

const PASSED_STATUS_USERS = new Set([
  "modules/certification/certificationRepository.ts",
  "modules/certification/index.ts",
  "modules/reporting/reviewAppealReport.ts",
]);
const SWITCH_FILE = "modules/course/modulePassSwitch.ts";

/** Tekstsjekkene for én fil, så de kan prøves på kontrollcasene. */
function progressTextViolationsIn(file, text) {
  const out = [];
  if (/\b(isCertificationPassed|CERTIFICATION_PASSED_STATUSES)\b/.test(text) && !PASSED_STATUS_USERS.has(file)) {
    out.push(`${file} bruker reglene for modulstatus direkte. Fremdrift i kurs går gjennom findModuleProgress`);
  }
  // Via en relasjon: `include: { certifications: { … } }`. Tellingen i slettesperren (`_count`) er `certificationStatuses: true`.
  if (/\b(certifications|certificationStatuses|modulePasses)\s*:\s*\{/.test(text) && file !== "routes/me.ts") {
    out.push(`${file} leser beståtte via en relasjon. Fremdrift i kurs går gjennom findModuleProgress`);
  }
  // 2026-11-08: #997-skrivingen (`supersedeCertificationsForModule`) er fjernet. Ingen kode skriver `SUPERSEDED` på modulstatus.
  if (/\bstatus\s*:\s*["']SUPERSEDED["']/.test(text) || /\bsupersedeCertificationsForModule\b/.test(text)) {
    out.push(`${file} skriver SUPERSEDED på modulstatus. Den gamle regelen (#997) er fjernet`);
  }
  if (file !== SWITCH_FILE && (/module_pass_per_course/.test(text) || /\bMODULE_PASS_SWITCH_KEY\b/.test(text) || /\bisModulePassPerCourseOn\b/.test(text))) {
    out.push(`${file} leser bryteren. Den gamle regelen er fjernet, og regelen om beståtte per kurs gjelder alltid (${SWITCH_FILE})`);
  }
  if (file === SWITCH_FILE && /^\s*(let|var)\s|new\s+(Map|Set|WeakMap)\b|\bsetTimeout\b|\bcache\b/m.test(text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""))) {
    out.push(`${file} mellomlagrer bryteren. Da kan app og worker bli uenige`);
  }
  return out;
}

const PROGRESS_VIRTUAL = join(SRC, "__progress_guard_probe__.ts");
const PROGRESS_VIRTUAL_TEXT = `
import { prisma } from "./db/prisma.js";
export async function probeStatusCount(userId: string) { return prisma.certificationStatus.count({ where: { userId } }); }
export async function probePassRead(userId: string) { return prisma.modulePass.findMany({ where: { userId } }); }
export async function probeRequirementRead(courseId: string) { return prisma.courseModuleRequirement.findMany({ where: { courseId } }); }
export async function probeAlias() { const d = prisma.certificationStatus; return d.count(); }
`;

describe("#934 skive 5a-3: fremdrift i kurs går gjennom én funksjon, ingenting skriver SUPERSEDED, og ingenting leser bryteren", () => {
  it("ingenting leser modulstatus, beståtte eller kravet utenom stedene som er listet", () => {
    expect(progressReadViolations(program, files).out).toEqual([]);
  });

  it("tekstsjekkene: reglene for modulstatus og relasjoner står der de skal, ingenting skriver SUPERSEDED, og ingenting leser bryteren", () => {
    expect(files.flatMap((fileName) => progressTextViolationsIn(rel(fileName), readFileSync(fileName, "utf8")))).toEqual([]);
  });


  it("KONTROLLCASE: vakta ser de ekte leserne, også regelen selv", () => {
    const { seen } = progressReadViolations(program, files);
    for (const expected of [
      "modulePass modules/course/moduleCredit.ts:readPerCourseRule",
      "courseModuleRequirement modules/course/moduleCredit.ts:readPerCourseRule",
      "certificationStatus repositories/reportingRepository.ts:findCertificationsForStatusReport",
    ]) {
      expect(seen).toContain(expected);
    }
    // Ingen oppføring i lista over lesere peker på noe som ikke finnes lenger.
    const stale = [...PROGRESS_READERS].flatMap(([table, readers]) => [...readers].filter((where) => !seen.includes(`${table} ${where}`)).map((where) => `${table} ${where}`));
    expect(stale).toEqual([]);
  });

  it("KONTROLLCASE: en ny leser er rød, på alle tre tabellene og via et alias", () => {
    const host = ts.createCompilerHost(compilerOptions());
    const getSourceFile = host.getSourceFile.bind(host);
    const same = (a, b) => a.split("\\").join("/") === b.split("\\").join("/");
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
      same(fileName, PROGRESS_VIRTUAL) ? ts.createSourceFile(fileName, PROGRESS_VIRTUAL_TEXT, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => same(fileName, PROGRESS_VIRTUAL) || fileExists(fileName);
    const probe = ts.createProgram([PROGRESS_VIRTUAL], compilerOptions(), host, program);
    const { out } = progressReadViolations(probe, [PROGRESS_VIRTUAL]);
    for (const expected of [/probeStatusCount leser certificationStatus/, /probePassRead leser modulePass/, /probeRequirementRead leser courseModuleRequirement/, /probeAlias leser certificationStatus/]) {
      expect(out.some((v) => expected.test(v)), `${expected}\n${out.join("\n")}`).toBe(true);
    }
    expect(out).toHaveLength(4);

  }, 120_000);

  it("KONTROLLCASE: tekstsjekkene fanger de samme feilene, og slipper det som er lov", () => {
    const caught = (text, file = "modules/probe.ts") => progressTextViolationsIn(file, text);
    expect(caught("isCertificationPassed(row.status)")).toHaveLength(1);
    expect(caught("status: { in: CERTIFICATION_PASSED_STATUSES }")).toHaveLength(1);
    expect(caught("include: { certifications: { where: { moduleId } } }")).toHaveLength(1);
    expect(caught("include: { modulePasses: { where: { moduleId } } }")).toHaveLength(1);
    expect(caught('data: { status: "SUPERSEDED" }')).toHaveLength(1);
    expect(caught('data: { status: "SUPERSEDED" }', "modules/certification/certificationRepository.ts")).toHaveLength(1);
    expect(caught("createCertificationRepository(tx).supersedeCertificationsForModule(tx, m, v)")).toHaveLength(1);
    expect(caught('where: { key: "module_pass_per_course" }')).toHaveLength(1);
    expect(caught("where: { key: MODULE_PASS_SWITCH_KEY }")).toHaveLength(1);
    expect(caught("if (await isModulePassPerCourseOn(tx)) {")).toHaveLength(1);
    expect(caught('import { isModulePassPerCourseOn } from "./modulePassSwitch.js";')).toHaveLength(1);
    expect(caught("export async function isModulePassPerCourseOn(client) {", SWITCH_FILE)).toEqual([]);
    expect(caught("let cached = null;", SWITCH_FILE)).toHaveLength(1);
    expect(caught("const seen = new Map();", SWITCH_FILE)).toHaveLength(1);
    // Lov: tellingen i slettesperren, og et svar om en innlevering, en anke eller en sak, som har samme ord.
    expect(caught("_count: { select: { certificationStatuses: true } }")).toEqual([]);
    expect(caught('appealStatus: "SUPERSEDED"')).toEqual([]);
    expect(caught("isCertificationPassed(row.status)", "modules/reporting/reviewAppealReport.ts")).toEqual([]);
    // 2026-11-08: moduleCredit.ts leste modulstatus for den gamle regelen. Den er fjernet, og nå er det rødt der også.
    expect(caught("isCertificationPassed(row.status)", "modules/course/moduleCredit.ts")).toHaveLength(1);
    expect(caught("certifications: { select: { moduleId: true } }", "routes/me.ts")).toEqual([]);
  });
});
