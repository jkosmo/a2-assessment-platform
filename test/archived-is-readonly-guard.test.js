import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#1151, doc/design/CONTENT_LIFECYCLE.md G5): ARKIVERT ER URØRLIG.
//
// Vakta finner SKRIVESTEDENE selv: hver skriving i src/ til en tabell som hører til et kurs, en modul eller en seksjon, med
// TypeScripts typesjekker (samme tanke som test/content-lock-write-guard.test.js), uansett om funksjonen åpner transaksjonen selv
// eller tar imot den fra kalleren. Nøkkelen er «fil#funksjon tabell.operasjon», med antallet.
//
// Hvert skrivested står i `EXPECTED` med ett av to:
//   - `by`: funksjonen som holder vakta for dette skrivestedet (`assertNotArchived`, eller «slett krever arkivert» med
//     `deleteRequiresArchivedError`). Vakta sjekker at den funksjonen faktisk kaller den.
//   - `unntak`: hvorfor skrivingen er lov på et arkivert element (gjenoppretting, sletting, arkiveringen selv, nye elementer …).
// Et nytt skrivested (eller et nytt antall) er rødt til noen har tatt stilling til det.
//
// Det vakta IKKE ser: at vakta i `by` står FØR skrivingen, og at den gjelder riktig element. Det måler rutetestene
// (test/m2-archived-readonly-1151.test.ts og …-lock-1151.test.ts). Og en ny skriving til et ANNET element inne i en funksjon som
// alt står her, med samme tabell og operasjon, øker bare antallet.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/** Tabellene, og hvilket element de hører til. */
const OWNER = new Map([
  ["course", "COURSE"], ["courseItem", "COURSE"], ["courseVersion", "COURSE"], ["courseModuleRequirement", "COURSE"],
  ["courseDraft", "COURSE"], ["courseThemeAssignment", "COURSE"],
  ["module", "MODULE"], ["moduleVersion", "MODULE"], ["rubricVersion", "MODULE"], ["promptTemplateVersion", "MODULE"],
  ["mCQSetVersion", "MODULE"], ["mCQQuestion", "MODULE"],
  ["courseSection", "SECTION"], ["courseSectionVersion", "SECTION"], ["sectionAsset", "SECTION"],
]);
const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

const GUARD_CALL = /\bassertNotArchived\s*\(|\bdeleteRequiresArchivedError\s*\(/;

// Grunnene som går igjen.
const NY = "nytt element: det finnes ikke før, og kan ikke være arkivert";
const ARKIVERING = "arkiveringen selv (G5 sier hva som er lov på et arkivert element, ikke om det kan arkiveres)";
const GJENOPPRETTING = "gjenopprettingen: veien tilbake fra arkivet";
const VEDLIKEHOLD = "vedlikeholdsskript som kjøres for hånd (samme unntak som i content-lock-write-guard)";

const VERSJONENE_A =
  "kursets versjon: et arkivert kurs følger versjonene av delte elementer som før (#1149; bekreftet av produkteier " +
  "13.11.2026, #1151 A). For kursets EGNE skrivinger står vakta hos kalleren (claimCourseRevision, publishCourse, publiseringene)";

const AC = "modules/adminContent/adminContentCommands.ts";
const AR = "modules/adminContent/adminContentRepository.ts";
const CI = "modules/adminContent/contentImportService.ts";
const MV = "modules/adminContent/moduleVersioning.ts";
const CC = "modules/course/courseCommands.ts";
const CV = "modules/course/courseVersioning.ts";
const CD = "modules/course/courseDraft.ts";
const SC = "modules/course/sectionCommands.ts";
const KA = "modules/course/courseCascadeDeleteService.ts";
const ARK = "modules/course/courseArchive.ts";
const AS = "modules/course/assetCommands.ts";
const LT = "services/localizedTitleCleanup.ts";

/** Vakta står i `by` (én eller flere funksjoner, alle skal kalle den). */
const by = (...fns) => ({ by: fns });
const unntak = (why) => ({ unntak: why });
/** Hver skrivning i lista har samme regel. */
const each = (rule, ...keys) => keys.map(([key, count]) => [key, [count, rule]]);

/** Nøkkel → [antall, `{ by }` eller `{ unntak }`]. */
const EXPECTED = new Map([
  // ── Modul: kommandoene holder vakta, skriveren (adminContentRepository.ts) skriver ──
  ...each(by(`${AC}#prepareComponentWrite`, `${AC}#syncActiveRubricBlueprintHash`), [`${AR}#createRubricVersion rubricVersion.create`, 1]),
  ...each(by(`${AC}#prepareComponentWrite`, `${AC}#createBenchmarkExampleVersion`), [`${AR}#createPromptTemplateVersion promptTemplateVersion.create`, 1]),
  ...each(by(`${AC}#prepareComponentWrite`), [`${AR}#createMcqSetVersion mCQSetVersion.create`, 1]),
  ...each(by(`${AC}#createModuleVersionLocked`, `${AC}#restoreModuleVersion`, `${AC}#appendMcqQuestions`, `${AC}#publishModuleVersionWithThresholds`), [`${AR}#createModuleVersion moduleVersion.create`, 1]),
  // Skriverens publisering er felles: gjenopprettingen med kurset (`restoreModuleWithCourse`) bruker den også, etter at den har
  // nullstilt `archivedAt`. Vakta står i kommandoene, som er veiene en forfatter starter.
  ...each(by(`${AC}#publishModuleVersion`, `${AC}#publishModuleVersionWithThresholds`), [`${AR}#publishModuleVersion module.update`, 1], [`${AR}#publishModuleVersion moduleVersion.update`, 1]),
  ...each(by(`${AC}#unpublishModule`), [`${AR}#unpublishModule module.update`, 1]),
  ...each(by(`${AC}#updateModuleTitle`), [`${AR}#updateModuleTitle module.update`, 1]),
  // Detaljene skrives bare av lagringen (`composeModuleVersion`), som alltid ender i `createModuleVersion` i samme transaksjon.
  ...each(by(`${AC}#createModuleVersionLocked`), [`${AR}#updateModuleDetails module.update`, 1]),
  ...each(by(`${AC}#deleteModule`), [`${AR}#deleteModule module.delete`, 1]),
  ...each(unntak(NY), [`${AR}#createModule module.create`, 1]),
  ...each(unntak(`${ARKIVERING}: «Arkiver», og importen som arkiverer et element den byttet ut`), [`${AR}#archiveModule module.update`, 1], [`${AR}#archiveModuleWithCourse module.update`, 1]),
  ...each(unntak(GJENOPPRETTING), [`${AR}#restoreModule module.update`, 1], [`${AR}#restoreModuleWithCourse module.update`, 1]),
  ...each(
    unntak("motsatt regel (#1151 F): masseryddingen sletter bare upubliserte moduler som IKKE er arkivert (administrator, «Rydd stage»)"),
    [`${AC}#purgeUnpublishedModules mCQQuestion.deleteMany`, 1], [`${AC}#purgeUnpublishedModules mCQSetVersion.deleteMany`, 1],
    [`${AC}#purgeUnpublishedModules module.delete`, 1], [`${AC}#purgeUnpublishedModules moduleVersion.deleteMany`, 1],
    [`${AC}#purgeUnpublishedModules promptTemplateVersion.deleteMany`, 1], [`${AC}#purgeUnpublishedModules rubricVersion.deleteMany`, 1],
  ),
  ...each(
    unntak("nummererer eldre versjoner som mangler nummer (datareparasjon, innholdet endres ikke). Kalles fra publiseringen (vakt i kommandoen; gjenopprettingen med kurset er unntaket over) og kursets elementliste"),
    [`${MV}#numberModuleHistory moduleVersion.update`, 1],
  ),
  ...each(unntak(VERSJONENE_A), [`${MV}#raiseModuleRequirementInCourse courseModuleRequirement.createMany`, 1], [`${MV}#raiseModuleRequirementInCourse courseModuleRequirement.updateMany`, 1]),
  ...each(by(`${CC}#claimRevisionForItemWrite`, `${CV}#claimCourseRevision`), [`${MV}#syncModuleRequirements courseModuleRequirement.createMany`, 1], [`${MV}#syncModuleRequirements courseModuleRequirement.deleteMany`, 1]),

  // ── Import ──
  ...each(by(`${CI}#appendInactiveSectionVersion`), [`${CI}#appendInactiveSectionVersion courseSection.update`, 1], [`${CI}#appendInactiveSectionVersion courseSectionVersion.create`, 1], [`${CI}#appendInactiveSectionVersion sectionAsset.create`, 1]),
  // Kursets felt (`updateExisting`) og avpubliseringen ved tilbakeholdt innhold (`replaceExisting`): vakta for målkurset står rett
  // etter låsen, før noe skrives (#1151 G).
  ...each(by(`${CI}#importCourseFromEnvelope`), [`${CI}#importCourseFromEnvelope course.update`, 2]),
  ...each(unntak(`${ARKIVERING}: «Oppdater dette kurset» arkiverer et element den byttet ut (et alt arkivert element røres ikke)`), [`${CI}#importCourseFromEnvelope courseSection.update`, 1]),
  ...each(unntak(`${NY}: seksjonen importen lager`), [`${CI}#persistStagedSection sectionAsset.create`, 1]),

  // ── Seksjon ──
  ...each(by(`${AS}#createSectionAsset`), [`${AS}#createSectionAsset sectionAsset.create`, 1]),
  ...each(by(`${AS}#localizeSectionAssets`), [`${AS}#localizeSectionAssets sectionAsset.updateMany`, 1]),
  ...each(unntak(VEDLIKEHOLD), [`${AS}#repairUnreadableSvgAssets sectionAsset.update`, 1]),
  ...each(by(`${SC}#updateSectionTitle`), [`${SC}#updateSectionTitle courseSection.update`, 1]),
  ...each(by(`${SC}#updateSectionContent`), [`${SC}#updateSectionContent courseSection.update`, 1], [`${SC}#updateSectionContent courseSectionVersion.create`, 1]),
  ...each(by(`${SC}#publishSectionLocked`), [`${SC}#publishSectionLocked courseSection.update`, 1], [`${SC}#publishSectionLocked courseSectionVersion.update`, 1]),
  ...each(by(`${SC}#unpublishSection`), [`${SC}#unpublishSection courseSection.update`, 1]),
  ...each(by(`${SC}#deleteSection`), [`${SC}#deleteSection courseSection.delete`, 1], [`${SC}#deleteSection courseSection.update`, 1], [`${SC}#deleteSection courseSectionVersion.deleteMany`, 1]),
  ...each(unntak(NY), [`${SC}#createSection courseSection.create`, 1], [`${SC}#createSection courseSection.update`, 1], [`${SC}#createSection courseSectionVersion.create`, 1], [`${SC}#createSectionWithAssets sectionAsset.create`, 1]),
  ...each(unntak(ARKIVERING), [`${SC}#archiveSection courseSection.update`, 1], [`${SC}#archiveSectionWithCourse courseSection.update`, 1]),
  ...each(unntak(GJENOPPRETTING), [`${SC}#restoreSection courseSection.update`, 1], [`${SC}#restoreSectionWithCourse courseSection.update`, 1]),

  // ── Kurs ──
  ...each(by(`${CV}#claimCourseRevision`), [`${CV}#claimCourseRevision course.updateMany`, 2], [`${CC}#updateCourse course.update`, 1]),
  ...each(by(`${CC}#claimRevisionForItemWrite`, `${CV}#claimCourseRevision`), [`${CC}#writeCourseItems course.update`, 1], [`${CC}#writeCourseItems courseItem.createMany`, 1], [`${CC}#writeCourseItems courseItem.deleteMany`, 1]),
  ...each(by(`${CC}#claimRevisionForItemWrite`), [`${CC}#setCourseModules course.update`, 1], [`${CC}#setCourseModules courseItem.createMany`, 1], [`${CC}#setCourseModules courseItem.deleteMany`, 1]),
  ...each(by(`${CC}#publishCourse`), [`${CC}#publishCourse course.update`, 1], ["modules/course/courseSlug.ts#assignCourseSlugIfMissing course.update", 1]),
  ...each(by(`${CC}#unpublishCourse`), [`${CC}#unpublishCourse course.update`, 1]),
  ...each(by(`${CC}#deleteCourse`), [`${CC}#deleteCourse course.delete`, 1]),
  ...each(unntak(NY), [`${CC}#createCourse course.create`, 1]),
  // Temaene: fra `updateCourse` (vakt i claimCourseRevision) og `createCourse` (nytt kurs).
  ...each(by(`${CV}#claimCourseRevision`), ["modules/course/courseThemeService.ts#setCourseThemes courseThemeAssignment.createMany", 1], ["modules/course/courseThemeService.ts#setCourseThemes courseThemeAssignment.deleteMany", 1]),
  ...each(by(`${CD}#saveCourseDraft`), [`${CD}#saveCourseDraft courseDraft.create`, 1], [`${CD}#saveCourseDraft courseDraft.update`, 1]),
  ...each(by(`${CD}#publishCourseDraft`), [`${CD}#publishCourseDraft courseDraft.delete`, 1]),
  ...each(unntak("«Forkast utkast»: veien ut for et utkast, også på et arkivert kurs (courseDraft.ts)"), [`${CD}#discardCourseDraft courseDraft.delete`, 1]),
  ...each(unntak(`${ARKIVERING}: kursets utkast forkastes når kurset arkiveres`), [`${CD}#discardCourseDraftOnArchive courseDraft.delete`, 1]),
  ...each(unntak(VERSJONENE_A), [`${CV}#applyCourseVersionChange course.update`, 2], [`${CV}#applyCourseVersionChange courseVersion.create`, 1], [`${CV}#applyCourseVersionChange courseVersion.upsert`, 1]),
  ...each(by(`${CI}#importCourseFromEnvelope`), [`${CV}#renameSectionInVersionSnapshots courseVersion.update`, 2]),
  ...each(unntak(ARKIVERING), [`${ARK}#archiveCourse course.update`, 1]),
  ...each(unntak(GJENOPPRETTING), [`${ARK}#restoreCourse course.update`, 1]),
  ...each(unntak("merkene fra kursarkiveringen nullstilles ved gjenoppretting og sletting av kurset; elementene forblir arkivert"), [`${ARK}#clearArchiveMarksForCourse courseSection.updateMany`, 1], [`${ARK}#clearArchiveMarksForCourse module.updateMany`, 1]),
  ...each(
    by(`${KA}#analyzeCourseCascade`),
    [`${KA}#cascadeDeleteCourse course.delete`, 1], [`${KA}#cascadeDeleteCourse courseItem.deleteMany`, 1],
    [`${KA}#cascadeDeleteCourse courseSection.delete`, 1], [`${KA}#cascadeDeleteCourse courseSection.update`, 1],
    [`${KA}#cascadeDeleteCourse courseSectionVersion.deleteMany`, 1], [`${KA}#cascadeDeleteCourse mCQQuestion.deleteMany`, 1],
    [`${KA}#cascadeDeleteCourse mCQSetVersion.deleteMany`, 1], [`${KA}#cascadeDeleteCourse module.delete`, 1],
    [`${KA}#cascadeDeleteCourse module.update`, 1], [`${KA}#cascadeDeleteCourse moduleVersion.deleteMany`, 1],
    [`${KA}#cascadeDeleteCourse promptTemplateVersion.deleteMany`, 1], [`${KA}#cascadeDeleteCourse rubricVersion.deleteMany`, 1],
  ),

  // ── Vedlikehold ──
  ...each(unntak(VEDLIKEHOLD), [`${LT}#collapseDuplicatedLocalizedTitles course.update`, 2], [`${LT}#collapseDuplicatedLocalizedTitles courseSection.update`, 1], [`${LT}#collapseDuplicatedLocalizedTitles module.update`, 1]),
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

const norm = (p) => p.split("\\").join("/");
const rel = (fileName) => norm(fileName).slice(norm(SRC).length + 1);

function compilerOptions() {
  const config = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  return { ...parsed.options, noEmit: true };
}

/** Navnet på den nærmeste navngitte funksjonen (deklarasjon, metode, eller en pil/funksjon lagt i en variabel). */
function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
      // En lokal pil (`const run = async (tx) => …`) inne i en navngitt funksjon hører til den ytre.
      let outer = current.parent.parent;
      while (outer && !ts.isSourceFile(outer) && !ts.isFunctionDeclaration(outer) && !ts.isMethodDeclaration(outer)) outer = outer.parent;
      if (!outer || ts.isSourceFile(outer)) return current.parent;
    }
  }
  return null;
}

function functionName(node) {
  if (!node) return "?";
  if (ts.isVariableDeclaration(node)) return node.name.getText();
  return node.name.getText();
}

function isPrismaDelegate(checker, expression) {
  const type = checker.getTypeAtLocation(expression);
  return Boolean(checker.getPropertyOfType(type, "findMany")) && Boolean(checker.getPropertyOfType(type, "deleteMany"));
}

/** Skrivestedene, gruppert: nøkkel → antall. Og funksjonstekstene, så `by` kan sjekkes. */
function collectWrites(program, files) {
  const checker = program.getTypeChecker();
  const counts = new Map();
  const functions = new Map();
  for (const fileName of files) {
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) throw new Error(`fant ikke ${fileName} i programmet`);
    const file = rel(fileName);
    const visitFunctions = (node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body) {
        functions.set(`${file}#${node.name.getText()}`, node.getText());
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        functions.set(`${file}#${node.name.getText()}`, node.getText());
      }
      ts.forEachChild(node, visitFunctions);
    };
    visitFunctions(sourceFile);
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && OWNER.has(node.name.text) && isPrismaDelegate(checker, node)) {
        const parent = node.parent;
        const op = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : null;
        if (op && WRITE_OPS.has(op)) {
          const key = `${file}#${functionName(enclosingFunction(node))} ${node.name.text}.${op}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { counts, functions };
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Det som ikke stemmer mellom skrivestedene og `EXPECTED`. */
function violations({ counts, functions }, expected) {
  const out = [];
  for (const [key, count] of counts) {
    const entry = expected.get(key);
    if (!entry) {
      out.push(`NY SKRIVER: «${key}» (${count}). Legg den i EXPECTED med \`by\` (funksjonen som kaller assertNotArchived) eller \`unntak\` (hvorfor den er lov på et arkivert element).`);
      continue;
    }
    if (entry[0] !== count) out.push(`«${key}»: ${count} skrivinger, ventet ${entry[0]}. Ta stilling til den nye.`);
  }
  for (const key of expected.keys()) if (!counts.has(key)) out.push(`«${key}» står i EXPECTED, men finnes ikke lenger. Ta den ut.`);
  for (const [key, [, rule]] of expected) {
    if (!rule || (!rule.by && !rule.unntak)) out.push(`«${key}»: mangler \`by\` eller \`unntak\``);
    for (const fn of rule?.by ?? []) {
      const text = functions.get(fn);
      if (!text) out.push(`«${key}»: vakta skal stå i ${fn}, men den funksjonen finnes ikke`);
      else if (!GUARD_CALL.test(stripComments(text))) out.push(`«${key}»: ${fn} kaller ikke assertNotArchived (eller deleteRequiresArchivedError)`);
    }
  }
  return out;
}

// Gjenopprettingene må virke på et arkivert element: de skal ALDRI kalle vakta (da ville ingenting kunne gjenopprettes). Det
// samme gjelder skriveren gjenopprettingen med kurset bruker.
const MUST_NOT_GUARD = [
  "modules/course/courseArchive.ts#restoreCourse",
  "modules/course/sectionCommands.ts#restoreSection",
  "modules/course/sectionCommands.ts#restoreSectionWithCourse",
  "modules/adminContent/adminContentCommands.ts#restoreModule",
  "modules/adminContent/adminContentCommands.ts#restoreModuleWithCourse",
];

let program;
let files;
let found;

beforeAll(() => {
  files = walk(SRC);
  program = ts.createProgram(files, compilerOptions());
  found = collectWrites(program, files);
}, 120_000);

const VIRTUAL = join(SRC, "__archived_guard_probe__.ts");
const VIRTUAL_TEXT = `
import { runContentWrite, type ContentWriteTx } from "./db/contentLock.js";
import { assertNotArchived } from "./modules/content/archivedGuard.js";
export async function probeOpens() { await runContentWrite(async (tx) => tx.courseSection.update({ where: { id: "x" }, data: { title: "y" } })); }
export async function probeTakesTx(tx: ContentWriteTx) { await tx.moduleVersion.create({ data: {} as never }); }
export async function probeGuarded(tx: ContentWriteTx) {
  await assertNotArchived(tx, { type: "COURSE", id: "x" });
  await tx.courseItem.deleteMany({ where: { courseId: "x" } });
}
export async function probeUnguarded(tx: ContentWriteTx) {
  // assertNotArchived(tx, …) i en kommentar teller ikke.
  await tx.course.update({ where: { id: "x" }, data: {} });
}
`;

describe("#1151: hvert skrivested til et kurs, en modul eller en seksjon har vakt eller et begrunnet unntak", () => {
  it("skrivestedene i src/ er de som står i EXPECTED, med vakta der den skal være", () => {
    expect(violations(found, EXPECTED), "Se toppen av fila.").toEqual([]);
  });

  it("gjenopprettingene kaller ikke vakta (de skal virke på et arkivert element)", () => {
    for (const fn of MUST_NOT_GUARD) {
      const text = found.functions.get(fn);
      expect(text, fn).toBeTruthy();
      expect(GUARD_CALL.test(stripComments(text)), fn).toBe(false);
    }
  });

  it("KONTROLLCASE: vakta ser skrivestedene i alle tre typene, også i skriverne som tar imot en transaksjon", () => {
    const owners = new Set([...found.counts.keys()].map((key) => OWNER.get(key.split(" ")[1].split(".")[0])));
    expect([...owners].sort()).toEqual(["COURSE", "MODULE", "SECTION"]);
    for (const key of [
      "modules/adminContent/contentImportService.ts#appendInactiveSectionVersion courseSectionVersion.create",
      "modules/adminContent/contentImportService.ts#persistStagedSection sectionAsset.create",
      "modules/adminContent/moduleVersioning.ts#numberModuleHistory moduleVersion.update",
      "modules/course/courseCommands.ts#writeCourseItems courseItem.createMany",
    ]) expect(found.counts.has(key), key).toBe(true);
  });

  it("KONTROLLCASE: en ny skriver er rød, en `by` uten vakt er rød, og et antall som endrer seg er rødt", () => {
    const host = ts.createCompilerHost(compilerOptions());
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, ...rest) =>
      norm(fileName) === norm(VIRTUAL) ? ts.createSourceFile(fileName, VIRTUAL_TEXT, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => norm(fileName) === norm(VIRTUAL) || fileExists(fileName);
    const probe = collectWrites(ts.createProgram([VIRTUAL], compilerOptions(), host, program), [VIRTUAL]);
    const file = rel(VIRTUAL);
    expect([...probe.counts.keys()].sort()).toEqual([
      `${file}#probeGuarded courseItem.deleteMany`,
      `${file}#probeOpens courseSection.update`,
      `${file}#probeTakesTx moduleVersion.create`,
      `${file}#probeUnguarded course.update`,
    ]);
    // Ingen i lista: alle fire er nye skrivere.
    expect(violations(probe, new Map()).filter((v) => v.startsWith("NY SKRIVER"))).toHaveLength(4);
    // I lista: vakta i `probeGuarded` godtas, den i en kommentar i `probeUnguarded` gjør ikke det, og et feil antall er rødt.
    const listed = new Map([
      [`${file}#probeGuarded courseItem.deleteMany`, [1, by(`${file}#probeGuarded`)]],
      [`${file}#probeUnguarded course.update`, [1, by(`${file}#probeUnguarded`)]],
      [`${file}#probeOpens courseSection.update`, [2, unntak("probe")]],
      [`${file}#probeTakesTx moduleVersion.create`, [1, unntak("probe")]],
    ]);
    const out = violations(probe, listed);
    expect(out.some((v) => v.includes("probeUnguarded kaller ikke assertNotArchived")), out.join("\n")).toBe(true);
    expect(out.some((v) => v.includes("probeOpens courseSection.update»: 1 skrivinger, ventet 2")), out.join("\n")).toBe(true);
    expect(out).toHaveLength(2);
  }, 120_000);
});
