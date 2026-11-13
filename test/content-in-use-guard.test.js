import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#1149): «hvilke kurs bruker dette elementet?» svares ETT sted.
//
// Produkteier 13.11.2026 (doc/DECISIONS.md → «Arkiverte kurs teller ikke som bruk»):
//   - «Brukt i kurs», kursfilteret, tematallet, avpublisering og arkivering: bare AKTIVE kurs teller.
//   - Sletting: ALLE kurs teller, også arkiverte (`CourseItem` → modul/seksjon er `onDelete: Restrict`).
//
// De to svarene bor i `modules/course/contentLifecycle.ts`, med hvert sitt navn
// (`findActiveCoursesContaining…` og `findAllCoursesContaining…`). Før #1149 hadde flere av dem som
// spurte, sin egen spørring: modulbiblioteket en telling på relasjonen (`_count.courseItems`), importen en
// `courseItem.count`, seksjonslista en `courseItem.findMany`. Ingen av dem kunne vite om regelen.
//
// Vakta har tre deler:
//   1. Hver fil utenom contentLifecycle.ts som leser koblingen mellom kurs og element, står i LESERE
//      med en grunn og et antall. En ny leser (eller en til i en fil som står der) gjør vakta rød.
//      Svarer den på «er dette i bruk», skal den kalle contentLifecycle.ts i stedet.
//   2. De to svarene har hvert sitt navn, og det finnes ingen funksjon uten «Active» eller «All».
//   3. Handlingene spør om riktig svar: avpubliser og arkiver om aktive, slett om alle.
//
// #1150 skive 2a-2 (nederst): hvert sted som arkiverer en modul eller seksjon, også flere på én gang, går gjennom regelen
// «brukes andre steder»; unntakene står per metode med kallerne sine; bare kursarkiveringen setter merkene
// (`archivedWithCourseId`, `activeVersionIdBeforeArchive`), og hver gjenoppretting og annen arkivering nullstiller dem.
//
// Vakta leser `src/`. Klienten viser det tjeneren sender (`courses`, `courseCount`), og spør ikke selv.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const OWNER = "modules/course/contentLifecycle.ts";

// Formene en lesning av «kurs ↔ element» kan ha:
const READ_PATTERNS = [
  // koblingstabellen direkte
  /\.courseItem\s*\.\s*(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|groupBy|aggregate)\b/g,
  // relasjonen fra modul eller seksjon: `courseItems: { some … }`, `_count: { select: { courseItems: true } }`, `m._count.courseItems`.
  // (`[...courseItems]` og `courseItems.map(…)` er en lokal variabel, ikke relasjonen.)
  /\bcourseItems\s*:|(?<=[\w)\]])\.courseItems\b/g,
  // kurs valgt ut fra elementene sine: `course.findMany({ where: { items: { some: { moduleId } } } })`
  /\bitems\s*:\s*\{\s*(some|none|every)\b/g,
  // rå SQL mot tabellen
  /\b(FROM|JOIN)\s+"CourseItem"/gi,
];

/**
 * Kjente lesere utenfor contentLifecycle.ts. Hver MÅ ha en grunn til at den ikke går gjennom
 * `findActiveCoursesContaining…` / `findAllCoursesContaining…`, og antallet lesninger i fila.
 */
const LESERE = {
  "modules/adminContent/adminContentCommands.ts": {
    count: 5,
    reason:
      "Masseryddingen av upubliserte moduler (listUnpublishedPurgeCandidates, purgeUnpublishedModules). Den SLETTER, "
      + "så alle kurs teller, også arkiverte: CourseItem → modul er onDelete: Restrict. Tellingen på relasjonen er riktig svar her.",
  },
  "modules/adminContent/adminContentRepository.ts": {
    count: 1,
    reason: "listPurgeCandidates: tellingen masseryddingen over bruker. Alle kurs, med vilje (sletting).",
  },
  "modules/adminContent/moduleVersioning.ts": {
    count: 2,
    reason:
      "#934: findModulePlacements (hvilke kurs en ny modulversjon gjelder i — også arkiverte og avpubliserte, med vilje) og "
      + "syncModuleRequirements (modulene i ETT kurs). Ikke «er modulen i bruk».",
  },
  "modules/course/courseAssignmentNotice.ts": {
    count: 1,
    reason:
      "Rå SQL: har deltakeren levert på en modul i DETTE kurset (kurset er alt valgt som publisert og ikke arkivert). "
      + "Deltakersiden, ikke «hvilke kurs bruker elementet».",
  },
  "modules/course/courseCommands.ts": {
    count: 1,
    reason: "setCourseModules leser seksjonsradene i ETT kurs for å bevare dem gjennom en omskriving. Kursets eget innhold.",
  },
  "modules/course/courseRepository.ts": {
    count: 7,
    reason:
      "Dørene til kursets eget innhold (test/course-items-accessor-guard.test.js) og findPublishedCoursesContainingModule: "
      + "hvilke PUBLISERTE, ikke-arkiverte kurs som skal vurderes for kursbevis etter et vedtak. Deltakersiden.",
  },
  "modules/course/courseVersioning.ts": {
    count: 2,
    reason:
      "#934: findAffectedCourses og applyMinorVersionToCoursesContaining — hvilke kurs som får ny versjon når et element går live. "
      + "Også arkiverte og avpubliserte kurs som har vært ute, med vilje: de har kursbevis, og skal ha riktig versjon når de gjenopprettes.",
  },
  "modules/course/enrollmentService.ts": {
    count: 4,
    reason:
      "Deltakerens tilgang: hvilke publiserte, ikke-arkiverte kurs med modulen eller seksjonen deltakeren kan se, og om "
      + "deltakeren har begynt på ETT kurs. Filtrerer selv på publisert og ikke arkivert.",
  },
  "modules/discussion/discussionService.ts": {
    count: 2,
    reason: "Sjekker at et kurselement hører til DETTE kurset før en diskusjonstråd leses eller skrives.",
  },
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const files = walk(SRC).map((file) => ({ rel: relative(SRC, file).replace(/\\/g, "/"), text: withoutComments(readFileSync(file, "utf8")) }));
const textOf = (rel) => files.find((f) => f.rel === rel)?.text ?? "";

/** Antall lesninger av «kurs ↔ element» i en tekst. */
function countReads(text) {
  return READ_PATTERNS.reduce((sum, pattern) => sum + [...text.matchAll(pattern)].length, 0);
}

/** Toppnivå-funksjoner: navn og kropp fram til neste toppnivå-funksjon. Samme deling som course-archive-entry-guard. */
function topLevelFunctions(text) {
  const starts = [...text.matchAll(/^(?:export )?(?:async )?function (\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index }));
  return new Map(starts.map((s, i) => [s.name, text.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : text.length)]));
}

/**
 * Toppnivå-funksjonene, og for skriverne (`create…Writer`, et objekt med metoder) hver metode for seg, som «funksjon.metode».
 * QA-porten for 2a-1: unntaket gjaldt før hele `createAdminContentWriter`, så en ny metode som arkiverer, slapp gjennom.
 */
function functionsWithMethods(rel, text) {
  const out = new Map();
  for (const [name, body] of topLevelFunctions(text)) {
    if (!/^create\w*Writer$/.test(name)) {
      out.set(name, body);
      continue;
    }
    const starts = [...body.matchAll(/^ {4}(?:async )?(\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index }));
    if (starts.length === 0) out.set(name, body);
    starts.forEach((s, i) => out.set(`${name}.${s.name}`, body.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : body.length)));
  }
  return out;
}

const ARCHIVE_PATTERNS = [
  /\.archive\w*(Module|Section)\w*\(/,
  /\b(module|courseSection)\s*\.\s*(update|updateMany|upsert)\(\s*\{[^;]{0,400}?\barchivedAt\s*:(?!\s*null\b)/,
];
// Regelen «brukes andre steder», direkte, gjennom vaktene for arkivering for hånd, eller gjennom analysen av kursarkiveringen
// (som spør regelen med transaksjonen, sjekket i testen under).
const GOES_THROUGH_RULE = /\bfindActiveUsesOfItems\(|\bassert(Module|Section)NotInActiveCourse\([^)]*"arkiveres"|\banalyzeCourseArchive(ForWrite)?\(/;
// Skrivere som arkiverer uten å spørre selv. Kallerne må stå her, og de må spørre.
const ARCHIVE_EXEMPT = {
  "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.archiveModule": {
    why: "skriveren bak «Arkiver» i biblioteket og importens arkivering; kallerne spør regelen",
    callers: ["modules/adminContent/adminContentCommands.ts:archiveModule", "modules/adminContent/contentImportService.ts:importCourseFromEnvelope"],
  },
  "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.archiveModuleWithCourse": {
    why: "skriveren som setter merket fra kursarkiveringen; kalles bare av kommandoen under",
    callers: ["modules/adminContent/adminContentCommands.ts:archiveModuleWithCourse"],
  },
  "modules/adminContent/adminContentCommands.ts:archiveModuleWithCourse": {
    why: "modulen følger kurset inn i arkivet; kursarkiveringen har spurt regelen gjennom analysen, med transaksjonen",
    callers: ["modules/course/courseArchive.ts:archiveCourse"],
  },
  "modules/course/sectionCommands.ts:archiveSectionWithCourse": {
    why: "seksjonen følger kurset inn i arkivet; kursarkiveringen har spurt regelen gjennom analysen, med transaksjonen",
    callers: ["modules/course/courseArchive.ts:archiveCourse"],
  },
};

function archivingFunctions() {
  const found = [];
  for (const file of files) {
    for (const [name, body] of functionsWithMethods(file.rel, file.text)) {
      if (ARCHIVE_PATTERNS.some((pattern) => pattern.test(body))) found.push({ where: `${file.rel}:${name}`, body });
    }
  }
  return found;
}

// #1150 skive 2a-2: merkene fra kursarkiveringen (`archivedWithCourseId`, `activeVersionIdBeforeArchive`). Bare disse to setter dem
// til noe annet enn null:
const MARK_SETTERS = [
  "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.archiveModuleWithCourse",
  "modules/course/sectionCommands.ts:archiveSectionWithCourse",
];

/** Indeksen der den balanserte blokken som starter på `start`, slutter. */
function closingIndex(text, start) {
  const open = text[start];
  const close = { "(": ")", "{": "}" }[open];
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** Skrivingene til modul og seksjon i en fil, med det `data` setter: merket, og om det er en gjenoppretting. */
function markWritesIn(rel, text) {
  const out = [];
  for (const [fn, body] of functionsWithMethods(rel, text)) {
    for (const match of body.matchAll(/\b(module|courseSection)\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/g)) {
      const open = match.index + match[0].length - 1;
      const args = body.slice(open, closingIndex(body, open) + 1);
      const data = [...args.matchAll(/\b(data|create|update)\s*:\s*\{/g)].map((m) => {
        const at = m.index + m[0].length - 1;
        return args.slice(at, closingIndex(args, at) + 1);
      }).join(" ");
      out.push({
        rel,
        fn,
        setsMark: /\b(archivedWithCourseId|activeVersionIdBeforeArchive)\s*:(?!\s*null\b)/.test(data),
        restores: /\barchivedAt\s*:\s*null\b/.test(data),
        archives: /\barchivedAt\s*:(?!\s*null\b)/.test(data),
        clearsCourse: /\barchivedWithCourseId\s*:\s*null\b/.test(data),
        clearsVersion: /\bactiveVersionIdBeforeArchive\s*:\s*null\b/.test(data),
      });
    }
  }
  return out;
}

function markWrites() {
  return files.flatMap((file) => markWritesIn(file.rel, file.text));
}

describe("#1149: «hvilke kurs bruker dette elementet» svares i contentLifecycle.ts", () => {
  it("KONTROLL: mønstrene treffer formene spørsmålet har vært stilt i, og ikke en lokal variabel", () => {
    // De fire spørringene som fantes før #1149, og rå SQL. Treffer ikke mønstrene disse, måler vakta ingenting.
    expect(countReads("await tx.courseItem.count({ where: { sectionId: replaced.oldId } });")).toBe(1);
    expect(countReads("return client.courseItem\n  .findMany({ where: { moduleId } });")).toBe(1);
    expect(countReads("_count: { select: { courseItems: true } },")).toBe(1);
    expect(countReads("courseCount: module._count.courseItems,")).toBe(1);
    expect(countReads("where: { module: { courseItems: { some: { courseId } } } }")).toBe(1);
    expect(countReads("reader.course.findMany({ where: { items: { some: itemWhere } } })")).toBe(1);
    expect(countReads('JOIN "CourseItem" ci ON ci."moduleId" = s."moduleId"')).toBe(1);
    // En lokal variabel med samme navn er ikke en lesning.
    expect(countReads("const courseItems = await repo.findAllCourseItems(courseId);\n[...courseItems].sort();\ncourseItems.map((i) => i.id);")).toBe(0);
    // Skriving er ikke en lesning.
    expect(countReads("await tx.courseItem.deleteMany({ where: { courseId } });")).toBe(0);
  });

  it("KONTROLL: vakta finner eierfila, og eierfila leser faktisk koblingen", () => {
    expect(textOf(OWNER), `${OWNER} mangler — leter vakta riktig sted?`).not.toBe("");
    expect(countReads(textOf(OWNER))).toBeGreaterThanOrEqual(2);
  });

  it("ingen leser koblingen mellom kurs og element utenom contentLifecycle.ts uten å stå i LESERE", () => {
    const problems = [];
    for (const file of files) {
      if (file.rel === OWNER) continue;
      const found = countReads(file.text);
      const expected = LESERE[file.rel]?.count ?? 0;
      if (found === expected) continue;
      problems.push(
        `${file.rel}: ${found} lesninger av koblingen mellom kurs og element, ventet ${expected}.\n`
          + "    Svarer den nye lesningen på «hvilke kurs bruker dette elementet» (i bruk, brukt i kurs, kan arkiveres/slettes)?\n"
          + `    Da skal den kalle findActiveCoursesContaining…/findAllCoursesContaining… i ${OWNER}.\n`
          + "    Gjør den ikke det, før den opp i LESERE i test/content-in-use-guard.test.js med en grunn og riktig antall.",
      );
    }
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });

  it("LESERE er ikke foreldet, og hver oppføring har en grunn", () => {
    for (const [rel, entry] of Object.entries(LESERE)) {
      expect(textOf(rel), `LESERE peker på en fil som ikke finnes: ${rel}`).not.toBe("");
      expect(entry.count, `LESERE: ${rel} har antall 0 — ta oppføringen ut`).toBeGreaterThan(0);
      expect(entry.reason.trim().length, `LESERE uten grunn: ${rel}`).toBeGreaterThan(40);
    }
  });

  it("de to svarene har hvert sitt navn, og det finnes ingen funksjon uten «Active» eller «All»", () => {
    const owner = textOf(OWNER);
    for (const name of [
      "findActiveCoursesContainingModule",
      "findActiveCoursesContainingSection",
      "findAllCoursesContainingModule",
      "findAllCoursesContainingSection",
      "findActiveCoursesForModules",
      "findActiveCoursesForSections",
    ]) {
      expect(owner, `${name} mangler i ${OWNER}`).toMatch(new RegExp(`export function ${name}\\(`));
    }
    // Den ene spørringen tar valget som et påkrevd argument, og hvert kall sier det med en bokstavelig verdi.
    expect(owner).toMatch(/async function coursesContaining\(itemWhere: ItemRef, scope: "active" \| "all", reader: LifecycleReader\)/);
    const calls = [...owner.matchAll(/\bcoursesContaining\(([^)]*)\)/g)].map((m) => m[1]).filter((args) => !args.startsWith("itemWhere"));
    expect(calls).toHaveLength(4);
    expect(calls.filter((args) => /, "active", reader$/.test(args))).toHaveLength(2);
    expect(calls.filter((args) => /, "all", reader$/.test(args))).toHaveLength(2);

    // Navnene fra før #1149 sa ikke hvilket svar de ga. De skal ikke komme tilbake, i noen fil.
    const ambiguous = /\b(findCoursesContaining(Module|Section)|findCoursesForSections|findCoursesForModules|assertModuleNotInAnyCourse|countModuleCourses)\b/;
    const offenders = files.filter((f) => ambiguous.test(f.text)).map((f) => f.rel);
    expect(offenders, `Et navn som ikke sier om arkiverte kurs teller:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("avpubliser og arkiver spør om AKTIVE kurs, slett spør om ALLE", () => {
    const sections = topLevelFunctions(textOf("modules/course/sectionCommands.ts"));
    const modules = topLevelFunctions(textOf("modules/adminContent/adminContentCommands.ts"));
    const ACTIVE = /\bassert(Module|Section)NotInActiveCourse\(|\bfindActiveCoursesContaining/;
    const ALL = /\bassertSectionNotInAnyCourse\(|\bdescribeModuleDeleteBlock\(|\bfindAllCoursesContaining/;

    const owner = topLevelFunctions(textOf(OWNER));

    const expectations = [
      // Vaktene selv: navnet lover et svar, og kroppen må spørre om det samme.
      [owner, "assertModuleNotInActiveCourse", "findActiveCoursesContainingModule(moduleId, reader)", /\bfindAllCoursesContaining/],
      [owner, "assertSectionNotInActiveCourse", "findActiveCoursesContainingSection(sectionId, reader)", /\bfindAllCoursesContaining/],
      [owner, "describeModuleDeleteBlock", "findAllCoursesContainingModule(moduleId, reader)", /\bfindActiveCoursesContaining/],
      [owner, "assertSectionNotInAnyCourse", "findAllCoursesContainingSection(sectionId, reader)", /\bfindActiveCoursesContaining/],
      // Handlingene:
      [sections, "unpublishSection", 'assertSectionNotInActiveCourse(sectionId, "avpubliseres", tx)', ALL],
      [sections, "archiveSection", 'assertSectionNotInActiveCourse(sectionId, "arkiveres", tx)', ALL],
      [sections, "deleteSection", "assertSectionNotInAnyCourse(sectionId, tx)", ACTIVE],
      [modules, "unpublishModule", 'assertModuleNotInActiveCourse(moduleId, "avpubliseres", tx)', ALL],
      [modules, "archiveModule", 'assertModuleNotInActiveCourse(moduleId, "arkiveres", tx)', ALL],
      [modules, "deleteModule", "describeModuleDeleteBlock(moduleId, tx)", ACTIVE],
    ];
    for (const [fns, name, mustCall, mustNotMatch] of expectations) {
      const body = fns.get(name);
      expect(body, `fant ikke ${name}() — er den flyttet?`).toBeTruthy();
      // Med `tx`: sjekken gjøres på transaksjonen som holder innholdslåsen (#934 skive 4a).
      expect(body, `${name}() skal kalle ${mustCall}`).toContain(mustCall);
      expect(mustNotMatch.test(body), `${name}() spør om feil svar (${mustNotMatch})`).toBe(false);
    }
  });

  it("#1150: vaktene for arkivering spør regelen «brukes andre steder»; avpublisering spør bare kursene", () => {
    const owner = topLevelFunctions(textOf(OWNER));
    for (const [name, key] of [["assertModuleNotInActiveCourse", "modules"], ["assertSectionNotInActiveCourse", "sections"]]) {
      const body = owner.get(name);
      expect(body, `fant ikke ${name}()`).toBeTruthy();
      // Grenen for «arkiveres» går til regelen (med transaksjonen), og grenen for «avpubliseres» til kursene alene.
      expect(body).toMatch(new RegExp(`if \\(verb === "arkiveres"\\) \\{\\s*const uses = \\(await findActiveUsesOfItems\\([^;]*, reader\\)\\)\\.${key}\\.get`));
    }
    // Regelen leser kursene OG utkastene, med samme «ikke arkivert» som kursene, og utenom kurset som spør.
    const rule = owner.get("findActiveUsesOfItems");
    expect(rule, "fant ikke findActiveUsesOfItems()").toBeTruthy();
    expect(rule).toContain("findCourseDraftItemLists(reader, { course: activeCourseWhere, excludeCourseId: options.excludeCourseId })");
    expect(rule).toContain('activeCoursesByItem("moduleId", moduleIds, locale, { excludeCourseId: options.excludeCourseId, reader })');
    expect(rule).toContain('activeCoursesByItem("sectionId", sectionIds, locale, { excludeCourseId: options.excludeCourseId, reader })');
  });

  it("#1150: hvert sted som arkiverer en modul eller seksjon, går gjennom regelen «brukes andre steder»", () => {
    // Formene en arkivering av en modul eller seksjon har: et kall til en skriver som heter archive…Module…/archive…Section…
    // (`archiveModule`, `archiveModules`, `archiveModuleWithCourse` …), eller en `update`/`updateMany`/`upsert` som setter
    // `archivedAt` til noe annet enn null. Vakta finner dem selv; en ny vei inn blir rød den dagen den skrives.
    // QA-porten for 2a-1: før så vakta bare `.archiveModule(` og en `update`, ikke en skriver som arkiverer FLERE.
    const ARCHIVES = ARCHIVE_PATTERNS;
    const found = archivingFunctions();
    const where = found.map((f) => f.where);

    // KONTROLL: veiene inn som finnes i dag (biblioteket, seksjonslista, importen, kursarkiveringen) og skriverne.
    expect(where).toEqual(expect.arrayContaining([
      "modules/adminContent/adminContentCommands.ts:archiveModule",
      "modules/adminContent/adminContentCommands.ts:archiveModuleWithCourse",
      "modules/course/sectionCommands.ts:archiveSection",
      "modules/course/sectionCommands.ts:archiveSectionWithCourse",
      "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.archiveModule",
      "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.archiveModuleWithCourse",
    ]));
    expect(where.some((w) => w.startsWith("modules/adminContent/contentImportService.ts:")), where.join("\n")).toBe(true);
    // KONTROLL: skriveren deles opp per metode. `restoreModule` arkiverer ikke, og står derfor ikke i lista.
    expect(where).not.toContain("modules/adminContent/adminContentRepository.ts:createAdminContentWriter");
    expect(where).not.toContain("modules/adminContent/adminContentRepository.ts:createAdminContentWriter.restoreModule");
    // KONTROLL: gjenoppretting (archivedAt: null) er ikke en arkivering; en arkivering av én eller flere er det.
    expect(ARCHIVES.some((p) => p.test("tx.courseSection.update({ where: { id }, data: { archivedAt: null } })"))).toBe(false);
    expect(ARCHIVES.some((p) => p.test("tx.courseSection.update({ where: { id }, data: { archivedAt: new Date() } })"))).toBe(true);
    expect(ARCHIVES.some((p) => p.test("await tx.module.updateMany({ where: { id: { in: ids } }, data: { archivedAt: now } });"))).toBe(true);
    expect(ARCHIVES.some((p) => p.test("await writer.archiveModules(ids, now);"))).toBe(true);
    expect(ARCHIVES.some((p) => p.test("await writer.archiveSectionsWithCourse(ids, courseId, now);"))).toBe(true);
    expect(ARCHIVES.some((p) => p.test("await tx.course.update({ where: { id }, data: { archivedAt: now } });"))).toBe(false);

    const problems = found
      .filter((f) => !(f.where in ARCHIVE_EXEMPT))
      .filter((f) => !GOES_THROUGH_RULE.test(f.body))
      .map((f) => `${f.where} arkiverer en modul eller seksjon uten å spørre findActiveUsesOfItems (eller assert…NotInActiveCourse med «arkiveres», eller analyzeCourseArchive…).`);
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
    expect(Object.keys(ARCHIVE_EXEMPT).filter((k) => !where.includes(k)), "ARCHIVE_EXEMPT peker på noe som ikke arkiverer lenger").toEqual([]);
  });

  it("#1150: skriverne som er unntatt, kalles bare fra de oppførte stedene, og de går gjennom regelen", () => {
    // Unntak per metode og per funksjon, ikke for hele `createAdminContentWriter` (QA-porten for 2a-1). Hver har en liste over
    // hvem som får kalle den; vakta finner kallerne selv og krever nøyaktig den lista.
    for (const [key, entry] of Object.entries(ARCHIVE_EXEMPT)) {
      expect(entry.why.length, `${key} uten grunn`).toBeGreaterThan(20);
      const name = key.split(/[:.]/).pop();
      const isMethod = key.includes("createAdminContentWriter.");
      const pattern = isMethod ? new RegExp(`\\.${name}\\(`, "g") : new RegExp(`(?<![.\\w])${name}\\(`, "g");
      const callers = [];
      for (const file of files) {
        for (const [fn, body] of functionsWithMethods(file.rel, file.text)) {
          if (`${file.rel}:${fn}` === key) continue;
          // Definisjonen er ikke et kall: `function navn(` og en metode `async navn(…) {` i en skriver.
          const bodyWithoutDecl = body
            .replace(new RegExp(`function ${name}\\s*\\(`), "")
            .replace(new RegExp(`^\\s*(?:async\\s+)?${name}\\s*\\([^\\n]*\\{\\s*$`, "gm"), "");
          if (pattern.test(bodyWithoutDecl)) callers.push(`${file.rel}:${fn}`);
          pattern.lastIndex = 0;
        }
      }
      expect(callers.sort(), `${key} kalles fra steder som ikke står i lista`).toEqual([...entry.callers].sort());
      for (const caller of entry.callers) {
        if (caller in ARCHIVE_EXEMPT) continue;
        const [rel, fn] = caller.split(":");
        const body = functionsWithMethods(rel, textOf(rel)).get(fn);
        expect(body, `fant ikke ${caller}`).toBeTruthy();
        expect(GOES_THROUGH_RULE.test(body), `${caller} kaller ${key} uten å gå gjennom regelen «brukes andre steder»`).toBe(true);
      }
    }
    // Og analysen kursarkiveringen går gjennom, spør regelen (med transaksjonen).
    expect(topLevelFunctions(textOf("modules/course/courseArchivePreview.ts")).get("analyzeCourseArchiveForWrite"))
      .toContain("findActiveUsesOfItems({ moduleIds: idsOf(\"MODULE\"), sectionIds: idsOf(\"SECTION\") }, { excludeCourseId: courseId, locale }, reader)");
  });

  it("#1150: bare kursarkiveringen setter merkene; alle gjenopprettinger nullstiller dem", () => {
    const writes = markWrites();
    const where = (w) => `${w.rel}:${w.fn}`;
    // KONTROLL: vakta ser skriverne som setter merkene, og gjenopprettingene.
    const setters = writes.filter((w) => w.setsMark).map(where).sort();
    expect(setters).toEqual([...MARK_SETTERS].sort());
    const restores = writes.filter((w) => w.restores).map(where);
    expect(restores).toEqual(expect.arrayContaining([
      "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.restoreModule",
      "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.restoreModuleWithCourse",
      "modules/course/sectionCommands.ts:restoreSection",
      "modules/course/sectionCommands.ts:restoreSectionWithCourse",
    ]));
    // Hver gjenoppretting (archivedAt: null på en modul eller seksjon) nullstiller begge merkene i samme skriving.
    const missing = writes.filter((w) => w.restores && !(w.clearsCourse && w.clearsVersion)).map(where);
    expect(missing, "En gjenoppretting som lar merket fra kursarkiveringen stå").toEqual([]);
    // Og hver annen arkivering (for hånd, importen) nullstiller dem: et merke som gammel kode lot stå, skal ikke få kurset til å
    // ta elementet tilbake. Bare de to skriverne over setter dem.
    const archives = writes.filter((w) => w.archives).map(where);
    expect(archives).toEqual(expect.arrayContaining([
      "modules/adminContent/adminContentRepository.ts:createAdminContentWriter.archiveModule",
      "modules/course/sectionCommands.ts:archiveSection",
      "modules/adminContent/contentImportService.ts:importCourseFromEnvelope",
    ]));
    const leaves = writes.filter((w) => w.archives && !w.setsMark && !(w.clearsCourse && w.clearsVersion)).map(where);
    expect(leaves, "En arkivering som lar et gammelt merke stå").toEqual([]);
    // Ingen rå SQL rører kolonnene.
    const raw = files.filter((f) => /\$(executeRaw|queryRaw)[\s\S]{0,300}"(archivedWithCourseId|activeVersionIdBeforeArchive)"/.test(f.text)).map((f) => f.rel);
    expect(raw).toEqual([]);

    // KONTROLLCASE: en ny skriver som setter merket, og en gjenoppretting som glemmer det, blir begge funnet.
    const probe = markWritesIn("modules/probe.ts", [
      "export async function probeSet(tx) {",
      "  await tx.module.update({ where: { id }, data: { archivedAt: now, archivedWithCourseId: courseId } });",
      "}",
      "export async function probeRestore(tx) {",
      "  await tx.courseSection.updateMany({ where: { id: { in: ids } }, data: { archivedAt: null, archivedWithCourseId: null } });",
      "}",
      "export async function probeClear(tx) {",
      "  await tx.module.updateMany({ where: { archivedWithCourseId: courseId }, data: { archivedWithCourseId: null, activeVersionIdBeforeArchive: null } });",
      "}",
    ].join("\n"));
    expect(probe.map((w) => [w.fn, w.setsMark, w.restores, w.clearsCourse && w.clearsVersion])).toEqual([
      ["probeSet", true, false, false],
      ["probeRestore", false, true, false],
      ["probeClear", false, false, true],
    ]);
  });

  it("#1150: regelen «brukes andre steder» har bare de kjente brukerne, og de bruker ikke svaret uten utkastene", () => {
    const users = files.filter((f) => f.rel !== OWNER && /\bfindActiveUsesOfItems\(/.test(f.text)).map((f) => f.rel).sort();
    expect(users, "En ny bruker av regelen: før den opp her med vilje").toEqual([
      "modules/adminContent/contentImportService.ts",
      "modules/course/courseArchivePreview.ts",
    ]);
    // Importen og forhåndsvisningen spør regelen, ikke kursene alene (som ikke ser utkastene).
    for (const rel of users) {
      expect(/\bfindActiveCoursesContaining(Module|Section)\(/.test(textOf(rel)), `${rel} spør kursene uten utkastene`).toBe(false);
    }
    // Ruta for forhåndsvisningen går gjennom analysen, og analysen gjennom regelen og tellingen.
    expect(textOf("routes/adminCourses.ts")).toMatch(/adminCoursesRouter\.get\("\/:courseId\/archive-preview", requireContentOwnership\("COURSE", "courseId"\), async[\s\S]{0,200}?analyzeCourseArchive\(/);
    const preview = textOf("modules/course/courseArchivePreview.ts");
    expect(preview).toContain("findCourseInProgressParticipants(courseId, reader)");
    expect(preview).toContain("countCoursePendingReviews(inProgress, reader)");
  });

  it("#1150: utkastene leses for «i bruk» bare gjennom regelen", () => {
    // Elementlistene i utkastene (courseDraft.ts) hentes bare av regelen. Alt annet som spør «er dette i bruk», spør den.
    // At ingen andre filer leser CourseDraft i det hele tatt, passer test/course-draft-guard.test.js på.
    const callers = files.filter((f) => /\bfindCourseDraftItemLists\(/.test(f.text)).map((f) => f.rel).sort();
    expect(callers).toEqual(["modules/course/contentLifecycle.ts", "modules/course/courseDraft.ts"]);
    const owner = topLevelFunctions(textOf(OWNER));
    const inOwner = [...owner].filter(([, body]) => /\bfindCourseDraftItemLists\(/.test(body)).map(([name]) => name);
    expect(inOwner).toEqual(["findActiveUsesOfItems"]);
  });

  it("#1150: G3, kurslista og forhåndsvisningen teller deltakere midt i kurset med samme funksjon", () => {
    const owner = topLevelFunctions(textOf(OWNER));
    expect(owner.get("countCourseInProgressParticipants")).toContain("findCourseInProgressParticipants(courseId, reader)");
    // #1150 skive 2a-2: G3 er en bekreftelse. Arkiveringen tar tallet fra analysen den alt har regnet på transaksjonen (samme
    // utregning som forhåndsvisningen), og kaster G3-feilen med det når forfatteren ikke har bekreftet.
    const archive = topLevelFunctions(textOf("modules/course/courseArchive.ts"));
    expect(archive.get("archiveCourse")).toContain("await analyzeCourseArchiveForWrite(courseId, actor, options.locale ?? \"nb\", tx)");
    expect(archive.get("assertArchiveConfirmed")).toContain("courseHasActiveParticipantsError(preview.inProgressCount)");
    expect(topLevelFunctions(textOf("modules/course/courseArchivePreview.ts")).get("analyzeCourseArchiveForWrite")).toContain("findCourseInProgressParticipants(courseId, reader)");
    // Ingen andre steder teller selv: den gamle formen (lesinger, innleveringer og bevis, uten «Mine kurs»-regelen) er borte.
    const counting = files.filter((f) => /\b(countCourseInProgressParticipants|findCourseInProgressParticipants)\(/.test(f.text)).map((f) => f.rel).sort();
    expect(counting).toEqual([OWNER, "modules/course/courseArchivePreview.ts", "routes/adminCourses.ts"].sort());
  });

  it("svaret «alle kurs» brukes bare av slettingene", () => {
    // Sletting av en seksjon, sletting av en modul (kommandoen og ruta), og kaskadeslettingens «delt med andre kurs».
    const ALLOWED = {
      assertSectionNotInAnyCourse: ["modules/course/sectionCommands.ts"],
      describeModuleDeleteBlock: ["modules/adminContent/adminContentCommands.ts", "routes/adminContent.ts"],
      findAllCoursesContainingModule: ["modules/course/courseCascadeDeleteService.ts"],
      findAllCoursesContainingSection: ["modules/course/courseCascadeDeleteService.ts"],
    };
    for (const [name, allowed] of Object.entries(ALLOWED)) {
      const users = files.filter((f) => f.rel !== OWNER && new RegExp(`\\b${name}\\b`).test(f.text)).map((f) => f.rel).sort();
      expect(users, `${name} gir svaret «alle kurs, også arkiverte». Det er bare for sletting`).toEqual([...allowed].sort());
    }
  });
});
