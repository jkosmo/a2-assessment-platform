import { readFileSync } from "node:fs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { ARCHIVED_CONTENT_RETENTION_FLOOR_KEY } from "../src/config/retention.js";
import { parseRetentionFloor } from "../src/modules/content/retentionDeadline.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";
import { recordFixturePass } from "./support/modulePassFixture.js";

// #1152 skive 4b (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Hva forfatteren ser» og «Etter gjennomlesingen» punkt 7–9):
// FORFATTEREN SER DATOEN.
//
//   1. Migreringen: tre indekser og overgangsraden, ISO 8601 i UTC; kjørt på nytt står raden urørt.
//   2. KJERNEN: lista og «Slett» sier det samme. For hver fikstur: sier lista «slettes», sletter «Slett»; sier den «beholdes: X»,
//      svarer «Slett» X. Slettingene gjøres i jobbens rekkefølge (kurs først), så et element i et kurs som selv slettes, er fritt
//      når det er dets tur.
//   3. Fristen: seks kalendermåneder etter det seneste av `archivedAt` og overgangstidspunktet, norsk kalender, siste dag i måneden.
//   4. Mangler overgangsraden: ingen dato, ingen krasj.
//
// Gjennom rutene (supertest). Det ingen rute kan lage, skrives direkte og er merket: flyttede arkiveringsdatoer, et bestått, en
// lesing etter arkiveringen, kursbevis, sertifisering uten innlevering, et utkast som nevner et arkivert element, og et arkivert
// element i et aktivt kurs.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator for hver fikstur: admin-API-et slipper bare 120 kall i minuttet per bruker, og denne fila lager mange.
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
function nextAdmin() {
  adminSeq += 1;
  ADMIN["x-user-id"] = `ret-1152-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `ret.1152.admin.${RUN}.${adminSeq}@x.test`;
  ADMIN["x-forwarded-for"] = `10.154.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
}
nextAdmin();
let seq = 0;
const tag = (name: string) => `1152r ${name} ${RUN}-${seq++}`;

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 600);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const get = (path: string) => request(app).get(path).set(ADMIN);
const del = (path: string) => request(app).delete(path).set(ADMIN);
const S = (id: string, action = "") => `${C}/sections/${id}${action}`;
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;
const K = (id: string, action = "") => `${C}/courses/${id}${action}`;

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

// ── Overgangsraden: testene setter den, og setter den tilbake ──────────────────────────────────────────────────────────────

const FLOOR_KEY = ARCHIVED_CONTENT_RETENTION_FLOOR_KEY;
let originalFloor: { value: string; updatedBy: string | null } | null = null;

async function setFloor(value: string | null) {
  if (value === null) {
    await prisma.platformConfig.deleteMany({ where: { key: FLOOR_KEY } });
    return;
  }
  await prisma.platformConfig.upsert({ where: { key: FLOOR_KEY }, create: { key: FLOOR_KEY, value }, update: { value } });
}

beforeAll(async () => {
  originalFloor = await prisma.platformConfig.findUnique({ where: { key: FLOOR_KEY }, select: { value: true, updatedBy: true } });
});

afterAll(async () => {
  // Raden slik migreringen skrev den: de andre testfilene (og en ny kjøring av denne) skal se det samme.
  if (originalFloor) {
    await prisma.platformConfig.upsert({
      where: { key: FLOOR_KEY },
      create: { key: FLOOR_KEY, value: originalFloor.value, updatedBy: originalFloor.updatedBy },
      update: { value: originalFloor.value, updatedBy: originalFloor.updatedBy },
    });
  }
  await prisma.$disconnect();
});

// ── Fiksturer ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** En publisert seksjon. */
async function apiSection(name: string) {
  nextAdmin();
  const created = await ok(post(`${C}/sections`, { title: L(tag(name)), bodyMarkdown: L("Tekst.") }), "seksjon");
  const id = created.section.id as string;
  await ok(post(S(id, "/publish")), "publiser seksjon");
  return id;
}

/** En publisert modul med kriterier, ledetekst, flervalg og en nummerert versjon. */
async function apiModule(name: string) {
  nextAdmin();
  const module = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("Beskrivelse"), certificationLevel: "basic" }), "modul");
  const moduleId = module.module.id as string;
  const base = M(moduleId);
  const rubric = await ok(post(`${base}/rubric-versions`, { criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } }), "kriterier");
  const prompt = await ok(post(`${base}/prompt-template-versions`, { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }), "ledetekst");
  const mcq = await ok(post(`${base}/mcq-set-versions`, { title: L("MCQ"), questions: [{ stem: L("1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("M") }] }), "flervalg");
  const version = await ok(post(`${base}/module-versions`, {
    taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"),
    rubricVersionId: rubric.rubricVersion.id, promptTemplateVersionId: prompt.promptTemplateVersion.id, mcqSetVersionId: mcq.mcqSetVersion.id,
  }), "modulversjon");
  await ok(post(`${base}/module-versions/${version.moduleVersion.id}/publish`), "publiser modul");
  return moduleId;
}

type Item = { type: "MODULE"; moduleId: string } | { type: "SECTION"; sectionId: string };

async function apiCourse(name: string, items: Item[]) {
  nextAdmin();
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const id = created.course.id as string;
  const r = await request(app).put(K(id, "/items")).set(ADMIN).send(await withRevision(id, { items }));
  expect(r.status, show(r)).toBe(204);
  return id;
}

async function archiveCourse(courseId: string) {
  nextAdmin();
  const { response } = await archiveCourseConfirmed(courseId, ADMIN);
  expect(response.status, show(response)).toBe(200);
}

async function archivedModule(name: string) {
  const id = await apiModule(name);
  await ok(post(M(id, "/archive")), "arkiver modul");
  return id;
}

async function archivedSection(name: string) {
  const id = await apiSection(name);
  await ok(post(S(id, "/archive")), "arkiver seksjon");
  return id;
}

async function user(name: string) {
  const id = `ret-1152-${name}-${RUN}-${seq++}`;
  await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@x.test`, name, externalId: id } });
  return id;
}

const publishedVersion = (moduleId: string) =>
  prisma.moduleVersion.findFirstOrThrow({ where: { moduleId, publishedAt: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true } });

/** En besvarelse med status. Direkte: vurderingen i køen. */
async function submission(userId: string, moduleId: string, status: "SUBMITTED" | "COMPLETED") {
  const version = await publishedVersion(moduleId);
  return prisma.submission.create({ data: { userId, moduleId, moduleVersionId: version.id, deliveryType: "text", submissionStatus: status }, select: { id: true, moduleVersionId: true } });
}

/** Bestått, slik vedtakssporet skriver det. Direkte: vedtakssporet. */
async function pass(userId: string, moduleId: string) {
  const made = await submission(userId, moduleId, "COMPLETED");
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: made.id, moduleVersionId: made.moduleVersionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
      passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1152 4b.",
    },
    select: { id: true },
  });
  await recordFixturePass({ userId, moduleId, moduleVersionId: made.moduleVersionId, submissionId: made.id, decisionId: decision.id });
  return decision.id;
}

/** Arkiveringsdatoen flyttet (fiksturen for fristen). Direkte: ingen rute arkiverer bakover i tid. */
const setArchivedAt = {
  course: (id: string, at: string) => prisma.course.update({ where: { id }, data: { archivedAt: new Date(at) } }),
  module: (id: string, at: string) => prisma.module.update({ where: { id }, data: { archivedAt: new Date(at) } }),
  section: (id: string, at: string) => prisma.courseSection.update({ where: { id }, data: { archivedAt: new Date(at) } }),
};

type Retention = { deletesAt: string } | { kept: { code: string; details: Record<string, unknown> | null } } | { unknown: true } | undefined;
type Kind = "course" | "module" | "section";
const timings: Array<{ list: string; ms: number; archivedRows: number }> = [];

/** De tre listene, hver lest én gang, med `retention` per id. */
async function readLists() {
  nextAdmin();
  const answers = { course: new Map<string, Retention>(), module: new Map<string, Retention>(), section: new Map<string, Retention>() };
  const keys = { course: new Set<string>(), module: new Set<string>(), section: new Set<string>() };
  for (const [kind, path, field] of [["course", `${C}/courses`, "courses"], ["module", `${C}/modules/library`, "modules"], ["section", `${C}/sections`, "sections"]] as const) {
    const started = Date.now();
    const response = await get(path);
    const ms = Date.now() - started;
    expect(response.status, `${path}: ${show(response)}`).toBe(200);
    const rows = response.body[field] as Array<{ id: string; archivedAt: string | null; retention?: Retention }>;
    timings.push({ list: path, ms, archivedRows: rows.filter((row) => row.archivedAt).length });
    for (const row of rows) {
      answers[kind].set(row.id, row.retention);
      if ("retention" in row) keys[kind].add(row.id);
      // Bare arkiverte rader har feltet.
      expect("retention" in row, `${kind} ${row.id}: retention bare på arkiverte`).toBe(row.archivedAt !== null);
    }
  }
  return { answers, keys };
}

const deletePath = (kind: Kind, id: string) => (kind === "course" ? K(id) : kind === "module" ? M(id) : S(id));

// ── 1. Migreringen ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const MIGRATION = new URL("../prisma/migrations/20261114120000_archived_content_retention/migration.sql", import.meta.url);

describe("#1152 4b: migreringen", () => {
  it("har skrevet overgangsraden på en fersk database, i ISO 8601 UTC, og lagt indeksene", async () => {
    expect(originalFloor, "raden fra migreringen").not.toBeNull();
    expect(originalFloor!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const floor = parseRetentionFloor(originalFloor!.value);
    expect(floor).not.toBeNull();
    // Migreringstidspunktet: databasen ble nullstilt og migrert før denne kjøringen, ikke i fremtiden.
    expect(floor!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(floor!.getTime()).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000);

    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('Course_archivedAt_idx', 'Module_archivedAt_idx', 'CourseSection_archivedAt_idx') ORDER BY indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual(["CourseSection_archivedAt_idx", "Course_archivedAt_idx", "Module_archivedAt_idx"]);
  });

  it("kjørt på nytt står raden urørt (ON CONFLICT DO NOTHING); uten rad lages den, med `updatedAt`", async () => {
    const sql = readFileSync(MIGRATION, "utf8");
    // Hele setningen, hva enn konflikten gjør: testen skal måle at raden står urørt, ikke hvordan setningen er skrevet.
    const insert = /INSERT INTO "PlatformConfig"[\s\S]*?;/.exec(sql)?.[0];
    expect(insert, "INSERT-setningen i migreringen").toBeTruthy();
    expect(insert).toContain(`'${FLOOR_KEY}'`);

    await setFloor("2000-01-01T00:00:00.000Z");
    await prisma.$executeRawUnsafe(insert!);
    expect((await prisma.platformConfig.findUniqueOrThrow({ where: { key: FLOOR_KEY } })).value).toBe("2000-01-01T00:00:00.000Z");

    await setFloor(null);
    const before = Date.now();
    await prisma.$executeRawUnsafe(insert!);
    const row = await prisma.platformConfig.findUniqueOrThrow({ where: { key: FLOOR_KEY } });
    const written = parseRetentionFloor(row.value);
    expect(written, row.value).not.toBeNull();
    expect(Math.abs(written!.getTime() - before)).toBeLessThan(60_000);
    expect(Math.abs(row.updatedAt.getTime() - written!.getTime())).toBeLessThan(5_000);
  });
});

// ── 2. Lista og «Slett» sier det samme ─────────────────────────────────────────────────────────────────────────────────────

type Expected = { deletesAt: string } | { kept: string };
type Fixture = { label: string; kind: Kind; id: string; expected: Expected; details?: Record<string, unknown> };

describe("#1152 4b: lista over arkiverte og «Slett» sier det samme", () => {
  it("hver grunn med sin kode, datoen der det kan slettes, og den seneste datoen for et element i et kurs som selv slettes", async () => {
    // Fristen regnes fra et kjent overgangstidspunkt, og arkiveringsdatoene er flyttet: datoene er faste.
    await setFloor("2026-01-01T00:00:00.000Z");
    const fixtures: Fixture[] = [];
    const add = (label: string, kind: Kind, id: string, expected: Expected, details?: Record<string, unknown>) => fixtures.push({ label, kind, id, expected, details });

    // C1: kan slettes. Arkivert 31. august (måneden etter har 28 dager): 28.02.2027. Har tre elementer som fulgte med inn.
    const m6 = await apiModule("C1 modul senere");
    const m8 = await apiModule("C1 modul med besvarelse");
    const s5 = await apiSection("C1 seksjon tidligere");
    const c1 = await apiCourse("C1 slettes", [{ type: "MODULE", moduleId: m6 }, { type: "MODULE", moduleId: m8 }, { type: "SECTION", sectionId: s5 }]);
    // S6 deles av C1 og C2. Den blir stående da C1 arkiveres (C2 er aktivt), og følger C2 inn i arkivet.
    const s6 = await apiSection("delt C1 og C2");
    const m5 = await apiModule("C2 modul");
    const c2 = await apiCourse("C2 kursbevis", [{ type: "MODULE", moduleId: m5 }, { type: "SECTION", sectionId: s6 }]);
    const putC1 = await request(app).put(K(c1, "/items")).set(ADMIN).send(await withRevision(c1, {
      items: [{ type: "MODULE", moduleId: m6 }, { type: "MODULE", moduleId: m8 }, { type: "SECTION", sectionId: s5 }, { type: "SECTION", sectionId: s6 }],
    }));
    expect(putC1.status, show(putC1)).toBe(204);
    await archiveCourse(c1);
    await archiveCourse(c2);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: s6 }, select: { archivedWithCourseId: true } })).archivedWithCourseId).toBe(c2);
    await setArchivedAt.course(c1, "2026-08-31T10:00:00.000Z");
    // Modulen ble arkivert senere enn kurset (for hånd etter en gjenoppretting, eller med et annet kurs): dens egen dato er senere.
    await setArchivedAt.module(m6, "2026-09-15T10:00:00.000Z");
    // Seksjonen ble arkivert tidligere: kursets dato er senere.
    await setArchivedAt.section(s5, "2026-07-01T10:00:00.000Z");
    // En ferdig vurdert besvarelse på M8, uten bestått: kurset kan slettes, men modulen har historikk.
    await submission(await user("C1 besvarelse"), m8, "COMPLETED");
    add("C1: kurs uten historikk", "course", c1, { deletesAt: "2027-02-28" });
    add("M6: i C1, arkivert etter kurset → sin egen dato", "module", m6, { deletesAt: "2027-03-15" });
    add("S5: i C1, arkivert før kurset → kursets dato", "section", s5, { deletesAt: "2027-02-28" });
    add("M8: i C1, med besvarelse → beholdes når kurset er borte", "module", m8, { kept: "module_has_submissions" }, { count: 1 });

    // C2: kursbevis. M5 og S6 ligger i et kurs som beholdes; S6 også i C1, som slettes.
    const s2 = await archivedSection("i et kursbevis");
    const certified = await user("C2 bevis");
    await prisma.courseCompletion.create({ data: { userId: certified, courseId: c2, moduleSnapshotJson: "[]", sectionSnapshotJson: JSON.stringify([s2]) } });
    add("C2: kursbevis", "course", c2, { kept: "course_has_completions" }, { count: 1 });
    add("M5: i C2 (beholdes)", "module", m5, { kept: "content_in_archived_course" });
    add("S6: i C1 (slettes) og C2 (beholdes)", "section", s6, { kept: "content_in_archived_course" });
    add("S2: i et utstedt kursbevis", "section", s2, { kept: "content_in_issued_certificate" }, { count: 1 });

    // C3: en deltaker har fullført kravet uten kursbevis (etter arkiveringen).
    const mc3 = await apiModule("C3 modul");
    const s4 = await apiSection("C3 seksjon");
    const c3 = await apiCourse("C3 fullført", [{ type: "MODULE", moduleId: mc3 }, { type: "SECTION", sectionId: s4 }]);
    await archiveCourse(c3);
    const done = await user("C3 ferdig");
    await pass(done, mc3);
    await prisma.courseSectionRead.create({ data: { userId: done, courseId: c3, sectionId: s4, readAt: new Date() } });
    add("C3: fullført uten kursbevis", "course", c3, { kept: "course_has_completed_without_certificate" }, { count: 1 });
    add("MC3: i C3 (beholdes)", "module", mc3, { kept: "content_in_archived_course" });
    add("S4: i C3 (beholdes)", "section", s4, { kept: "content_in_archived_course" });

    // C4: en besvarelse venter på vurdering.
    const mc4 = await apiModule("C4 modul");
    const c4 = await apiCourse("C4 venter", [{ type: "MODULE", moduleId: mc4 }]);
    await archiveCourse(c4);
    await submission(await user("C4 venter"), mc4, "SUBMITTED");
    add("C4: venter på vurdering", "course", c4, { kept: "course_has_pending_reviews" }, { count: 1 });
    add("MC4: i C4 (beholdes)", "module", mc4, { kept: "content_in_archived_course" });

    // Frittstående arkiverte elementer.
    const m1 = await archivedModule("frittstående");
    // Natta sommertida slutter: 22:30 UTC 24. oktober er 00:30 norsk tid 25. oktober.
    await setArchivedAt.module(m1, "2026-10-24T22:30:00.000Z");
    add("M1: frittstående, arkivert natt til 25.10 norsk tid", "module", m1, { deletesAt: "2027-04-25" });
    const s1 = await archivedSection("frittstående");
    await setArchivedAt.section(s1, "2026-08-31T10:00:00.000Z");
    add("S1: frittstående, 31. august", "section", s1, { deletesAt: "2027-02-28" });

    const m2 = await archivedModule("med besvarelse");
    await submission(await user("M2"), m2, "COMPLETED");
    add("M2: besvarelse", "module", m2, { kept: "module_has_submissions" }, { count: 1 });

    // Sertifisering uten innlevering på modulen: vedtaket på en hjelpemodul. Direkte: ingen rute lager det.
    const m3 = await archivedModule("med sertifisering");
    const helper = await apiModule("hjelpemodul");
    const certUser = await user("M3");
    const decisionId = await pass(certUser, helper);
    await prisma.certificationStatus.create({ data: { userId: certUser, moduleId: m3, latestDecisionId: decisionId, status: "ACTIVE" } });
    add("M3: sertifisering", "module", m3, { kept: "module_has_certification" }, { count: 1 });

    // Et lagret utkast til et aktivt kurs nevner en arkivert modul og seksjon. Direkte: ingen rute lagrer det.
    const m4 = await archivedModule("i utkast");
    const s3 = await archivedSection("i utkast");
    const withDraft = await apiCourse("med utkast", [{ type: "SECTION", sectionId: await apiSection("i kurset med utkastet") }]);
    await prisma.courseDraft.create({
      data: { courseId: withDraft, payloadText: JSON.stringify({ items: [{ type: "MODULE", moduleId: m4 }, { type: "SECTION", sectionId: s3 }] }), baseRevision: 0, source: "form" },
    });
    add("M4: i et kursutkast", "module", m4, { kept: "delete_blocked_by_course_draft" });
    add("S3: i et kursutkast", "section", s3, { kept: "delete_blocked_by_course_draft" });

    // Et arkivert element i et aktivt kurs (sjeldent; arkiveringen nekter det). Direkte.
    const m7 = await apiModule("i aktivt kurs");
    await apiCourse("aktivt", [{ type: "MODULE", moduleId: m7 }]);
    await setArchivedAt.module(m7, "2026-10-01T10:00:00.000Z");
    add("M7: arkivert, men i et aktivt kurs", "module", m7, { kept: "module_in_use" });

    // ── Lista ──
    const { answers } = await readLists();
    for (const fixture of fixtures) {
      const answer = answers[fixture.kind].get(fixture.id);
      if ("deletesAt" in fixture.expected) {
        expect(answer, fixture.label).toEqual({ deletesAt: fixture.expected.deletesAt });
      } else {
        expect(answer && "kept" in answer ? answer.kept.code : answer, fixture.label).toBe(fixture.expected.kept);
        if (fixture.details) expect(answer && "kept" in answer ? answer.kept.details : null, fixture.label).toMatchObject(fixture.details);
      }
    }

    // ── «Slett», i jobbens rekkefølge: kurs først, så moduler og seksjoner. Svaret skal være det lista sa. ──
    const order: Kind[] = ["course", "module", "section"];
    for (const kind of order) {
      for (const fixture of fixtures.filter((f) => f.kind === kind)) {
        nextAdmin();
        const answer = answers[kind].get(fixture.id);
        const response = await del(deletePath(kind, fixture.id));
        if (answer && "deletesAt" in answer) {
          expect(response.status, `${fixture.label}: lista sa «slettes ${answer.deletesAt}», «Slett» svarte ${show(response)}`).toBeLessThan(300);
        } else {
          expect(response.status, `${fixture.label}: lista sa ${JSON.stringify(answer)}`).toBeGreaterThanOrEqual(400);
          expect(response.body.error, `${fixture.label}: lista sa ${JSON.stringify(answer)}, «Slett» svarte ${show(response)}`).toBe(answer && "kept" in answer ? answer.kept.code : "?");
        }
      }
    }
    // Det som skulle slettes, er borte; resten står.
    for (const fixture of fixtures) {
      const exists = fixture.kind === "course"
        ? await prisma.course.count({ where: { id: fixture.id } })
        : fixture.kind === "module" ? await prisma.module.count({ where: { id: fixture.id } }) : await prisma.courseSection.count({ where: { id: fixture.id } });
      expect(exists, fixture.label).toBe("deletesAt" in fixture.expected ? 0 : 1);
    }
  });

  it("KONTROLL i motsatt rekkefølge: et element i et kurs som slettes, holdes igjen av kurset til kurset er borte", async () => {
    await setFloor("2026-01-01T00:00:00.000Z");
    const module = await apiModule("venter på kurset");
    const course = await apiCourse("slettes først", [{ type: "MODULE", moduleId: module }]);
    await archiveCourse(course);
    const { answers } = await readLists();
    expect(answers.module.get(module)).toHaveProperty("deletesAt");
    // Før kurset er slettet: kurset holder modulen igjen. Lista viser likevel datoen, fordi jobben sletter kurset først.
    nextAdmin();
    const early = await del(M(module));
    expect(early.body.error, show(early)).toBe("content_in_archived_course");
    expect((await del(K(course))).status).toBe(204);
    expect((await del(M(module))).status).toBe(200);
  });
});

// ── 3. Fristen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152 4b: fristen regnes fra det seneste av arkiveringen og overgangstidspunktet", () => {
  it("overgangstidspunktet etter arkiveringen: datoen regnes fra overgangen; før arkiveringen: fra arkiveringen", async () => {
    const module = await archivedModule("frist");
    await setArchivedAt.module(module, "2026-08-31T10:00:00.000Z");

    await setFloor("2026-12-01T00:00:00.000Z");
    expect((await readLists()).answers.module.get(module)).toEqual({ deletesAt: "2027-06-01" });

    await setFloor("2026-03-01T00:00:00.000Z");
    expect((await readLists()).answers.module.get(module)).toEqual({ deletesAt: "2027-02-28" });
  });
});

// ── 4. Overgangsraden mangler ──────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152 4b: uten overgangsrad er svaret «ukjent», aldri en dato", () => {
  for (const [label, value] of [["raden mangler", null], ["raden kan ikke leses", "14.11.2026"], ["tidspunkt uten tidssone", "2026-11-14T12:00:00"]] as const) {
    it(`${label}: alle tre listene svarer 200, arkiverte rader har { unknown: true }, og «Slett» virker som før`, async () => {
      const module = await archivedModule(`ukjent ${label}`);
      const section = await archivedSection(`ukjent ${label}`);
      const course = await apiCourse(`ukjent ${label}`, []);
      await archiveCourse(course);
      await setFloor(value);
      try {
        const { answers } = await readLists();
        expect(answers.module.get(module)).toEqual({ unknown: true });
        expect(answers.section.get(section)).toEqual({ unknown: true });
        expect(answers.course.get(course)).toEqual({ unknown: true });
        // Ingen dato noe sted.
        for (const map of Object.values(answers)) for (const answer of map.values()) if (answer) expect(answer).not.toHaveProperty("deletesAt");
        // «Slett» med knappen leser ikke fristen.
        nextAdmin();
        expect((await del(K(course))).status).toBe(204);
      } finally {
        await setFloor("2026-01-01T00:00:00.000Z");
      }
      // KONTROLL: med raden tilbake har de en dato.
      expect((await readLists()).answers.module.get(module)).toHaveProperty("deletesAt");
    });
  }
});

describe("#1152 4b: tiden listene bruker", () => {
  it("skrives ut (tallene i rapporten for skiven)", () => {
    // Ingen grense her: databasen i testkjøringen har alt de andre testfilene har lagt igjen. Tallene leses fra loggen.
    console.log(`[1152 4b] listetider: ${JSON.stringify(timings)}`);
    expect(timings.length).toBeGreaterThan(0);
  });
});
