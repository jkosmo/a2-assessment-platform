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
const CONTENT_MODELS = new Set(["courseItem", "course", "module", "moduleVersion", "courseSection", "courseSectionVersion", "sectionAsset", "courseVersion"]);
const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
const CONTENT_TABLES_SQL = /"(CourseItem|Course|Module|ModuleVersion|CourseSection|CourseSectionVersion|SectionAsset|CourseVersion)"/;

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
  ["submission", new Set(["create", "createMany", "createManyAndReturn", "upsert"])],
]);
const LEARNER_TABLES_SQL = /"(CourseCompletion|CourseSectionRead|AssessmentDecision|CertificationStatus)"|INSERT\s+INTO\s+"Submission"/i;

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
  const out = [];
  for (const fileName of files) {
    const file = rel(fileName);
    const text = readFileSync(fileName, "utf8");
    if (file === LOCK_FILE) continue;
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
    for (const match of text.matchAll(/\$(executeRaw|queryRaw)(Unsafe)?\s*[`(]/g)) {
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
    expect(out).toHaveLength(4);
    expect(locked).toHaveLength(2);
  }, 120_000);

  it("KONTROLLCASE: tekstsjekkene fanger en egen typekonvertering og et eget låsekall", () => {
    expect(/as\s+Content(Write|Read)Tx\b/.test("const t = tx as ContentWriteTx;")).toBe(true);
    expect(/\bwithContentLock\s*\(/.test("await withContentLock(tx, 'exclusive')")).toBe(true);
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
      /som verdi/,
      /sender en klient uten deltakerlåsen til probeParam \(probePass\)/,
    ]) {
      expect(out.some((v) => expected.test(v)), `${expected}\n${out.join("\n")}`).toBe(true);
    }
    // `submission.update` er vurderingsjobbens, og står ikke her. De fire låste er ikke med.
    expect(out).toHaveLength(8);
    expect(locked).toHaveLength(4);
  }, 120_000);

  it("KONTROLLCASE: tekstsjekkene fanger en egen typekonvertering og et eget låsekall", () => {
    expect(/as\s+Learner(Content)?Tx\b/.test("const t = tx as LearnerTx;")).toBe(true);
    expect(/as\s+Learner(Content)?Tx\b/.test("const t = tx as LearnerContentTx;")).toBe(true);
    expect(/\bwithLearnerLock\s*\(/.test("await withLearnerLock(tx, userId)")).toBe(true);
  });
});
