import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { ARCHIVED_CONTENT_PURGE_ENABLED_KEY, ARCHIVED_CONTENT_RETENTION_FLOOR_KEY } from "../src/config/retention.js";
import { ArchivedContentRetentionMonitor } from "../src/modules/content/ArchivedContentRetentionMonitor.js";
import { deleteUnderLock, previewArchivedRetention, runArchivedRetentionRound, type RetentionRoundOptions } from "../src/modules/content/archivedRetentionJob.js";
import { evaluateWorkerHealth } from "../src/observability/workerHealth.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1152 skive 4c (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Byggenotat for 4c» og gjennomlesingene): SLETTEJOBBEN.
//
// Jobben vet bare NÅR; vaktene i «Slett» avgjør OM. Testene flytter klokka (natt, norsk tid, mer enn seks måneder fram) og setter
// overgangsraden til en fast dato (lagt tilbake etterpå). Runden avgrenses til testens egne id-er (`onlyIds`): testdatabasen er delt,
// og uten avgrensningen ville runden slettet det andre testfiler har lagt igjen. Filene kjører én om gangen (fileParallelism: false).
//
// Det ingen rute kan lage, skrives direkte og er merket: `archivedAt` flyttet bakover (fristen), et kursbevis, en levert besvarelse.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `ret-4c-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `ret.4c.admin.${RUN}.${adminSeq}@x.test`;
  ADMIN["x-forwarded-for"] = `10.152.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
});
let seq = 0;
const tag = (name: string) => `4c ${name} ${RUN}-${seq++}`;

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 600);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

// ── Klokka og overgangsraden ───────────────────────────────────────────────────────────────────────────────────────────────

const FLOOR = "2026-01-01T00:00:00.000Z";
/** Arkivert her: fristen er 2026-07-01 (seks måneder, norsk kalender). */
const ARCHIVED_AT = new Date("2026-01-01T12:00:00.000Z");
/** 03:00 norsk tid (sommertid, UTC+2) 10. juli 2026: i vinduet, etter fristen. */
const NIGHT = new Date("2026-07-10T01:00:00.000Z");
/** 12:00 norsk tid samme dag: utenfor vinduet. */
const NOON = new Date("2026-07-10T10:00:00.000Z");

let originalFloor: { value: string; updatedBy: string | null } | null = null;
let originalStop: { value: string; updatedBy: string | null } | null = null;
beforeAll(async () => {
  originalFloor = await prisma.platformConfig.findUnique({ where: { key: ARCHIVED_CONTENT_RETENTION_FLOOR_KEY }, select: { value: true, updatedBy: true } });
  originalStop = await prisma.platformConfig.findUnique({ where: { key: ARCHIVED_CONTENT_PURGE_ENABLED_KEY }, select: { value: true, updatedBy: true } });
  await setFloor(FLOOR);
  await prisma.platformConfig.deleteMany({ where: { key: ARCHIVED_CONTENT_PURGE_ENABLED_KEY } });
});
afterAll(async () => {
  for (const [key, original] of [[ARCHIVED_CONTENT_RETENTION_FLOOR_KEY, originalFloor], [ARCHIVED_CONTENT_PURGE_ENABLED_KEY, originalStop]] as const) {
    if (original) await prisma.platformConfig.upsert({ where: { key }, create: { key, ...original }, update: original });
    else await prisma.platformConfig.deleteMany({ where: { key } });
  }
  await prisma.$disconnect();
});

async function setFloor(value: string | null) {
  if (value === null) await prisma.platformConfig.deleteMany({ where: { key: ARCHIVED_CONTENT_RETENTION_FLOOR_KEY } });
  else await prisma.platformConfig.upsert({ where: { key: ARCHIVED_CONTENT_RETENTION_FLOOR_KEY }, create: { key: ARCHIVED_CONTENT_RETENTION_FLOOR_KEY, value }, update: { value } });
}

const round = (ids: string[], options: RetentionRoundOptions = {}) =>
  runArchivedRetentionRound({ clock: () => NIGHT, onlyIds: new Set(ids), ...options });

// ── Fiksturer ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function apiSection(name: string) {
  const created = await ok(post(`${C}/sections`, { title: L(tag(name)), bodyMarkdown: L("Tekst.") }), "seksjon");
  const id = created.section.id as string;
  await ok(post(`${C}/sections/${id}/publish`), "publiser seksjon");
  return id;
}

async function apiModule(name: string) {
  const module = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("Beskrivelse"), certificationLevel: "basic" }), "modul");
  const moduleId = module.module.id as string;
  const base = `${C}/modules/${moduleId}`;
  const mcq = await ok(post(`${base}/mcq-set-versions`, { title: L("MCQ"), questions: [{ stem: L("1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("M") }] }), "flervalg");
  const version = await ok(post(`${base}/module-versions`, { assessmentMode: "MCQ_ONLY", mcqSetVersionId: mcq.mcqSetVersion.id, assessmentPolicy: { passRules: { mcqMinPercent: 60 } } }), "modulversjon");
  await ok(post(`${base}/module-versions/${version.moduleVersion.id}/publish`), "publiser modul");
  return { moduleId, versionId: version.moduleVersion.id as string };
}

/** Et arkivert kurs med en eksklusiv modul og seksjon (begge fulgte med), alt arkivert 1. januar 2026. */
async function archivedCourse(name: string) {
  const module = await apiModule(`${name} modul`);
  const section = await apiSection(`${name} seksjon`);
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const course = created.course.id as string;
  const r = await request(app).put(`${C}/courses/${course}/items`).set(ADMIN)
    .send(await withRevision(course, { items: [{ type: "MODULE", moduleId: module.moduleId }, { type: "SECTION", sectionId: section }] }));
  expect(r.status, show(r)).toBe(204);
  const { response } = await archiveCourseConfirmed(course, ADMIN);
  expect(response.status, show(response)).toBe(200);
  await backdate(course, module.moduleId, section);
  return { course, module: module.moduleId, moduleVersion: module.versionId, section, ids: [course, module.moduleId, section] };
}

/** Direkte: arkiveringen flyttet til 1. januar 2026, så fristen er nådd natten testene bruker. */
async function backdate(course: string, module: string, section: string, at: Date = ARCHIVED_AT) {
  await prisma.course.update({ where: { id: course }, data: { archivedAt: at } });
  await prisma.module.update({ where: { id: module }, data: { archivedAt: at } });
  await prisma.courseSection.update({ where: { id: section }, data: { archivedAt: at } });
}

const exists = async (x: { course: string; module: string; section: string }) => ({
  course: await prisma.course.count({ where: { id: x.course } }),
  module: await prisma.module.count({ where: { id: x.module } }),
  section: await prisma.courseSection.count({ where: { id: x.section } }),
});

async function user(name: string) {
  const id = `ret-4c-${name}-${RUN}-${seq++}`;
  await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@x.test`, name, externalId: id } });
  return id;
}

const auditFor = (entityId: string, action: string) =>
  prisma.auditEvent.findMany({ where: { entityId, action }, select: { metadataJson: true } }).then((rows) => rows.map((r) => JSON.parse(r.metadataJson) as Record<string, unknown>));

// ── 1. Sletting ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152 4c: jobben sletter det arkiverte som har passert fristen, med de samme vaktene som «Slett»", () => {
  it("kurset først, så modulen og seksjonen som bare var i det, i samme runde; én hendelse hver, med source og archivedAt", async () => {
    const x = await archivedCourse("slettes");
    const summary = await round(x.ids);
    expect(summary.skipped).toBeUndefined();
    expect(summary.deleted).toEqual({ COURSE: 1, MODULE: 1, SECTION: 1 });
    expect(summary.failed).toEqual([]);
    expect(await exists(x)).toEqual({ course: 0, module: 0, section: 0 });

    for (const [id, action] of [[x.course, "course_deleted"], [x.module, "module_deleted"], [x.section, "section_deleted"]] as const) {
      const events = await auditFor(id, action);
      expect(events, `${action}`).toHaveLength(1);
      expect(events[0]).toMatchObject({ source: "retention", archivedAt: ARCHIVED_AT.toISOString() });
    }
    expect((await auditFor(x.course, "course_deleted"))[0]?.title, "kurset har navnet sitt i hendelsen").toBeTruthy();
  });

  it("KONTROLL: før fristen (arkivert for to måneder siden, sett fra natten) velges ingenting", async () => {
    const x = await archivedCourse("for tidlig");
    await backdate(x.course, x.module, x.section, new Date("2026-05-10T12:00:00.000Z"));
    const summary = await round(x.ids);
    expect(summary.candidates).toBe(0);
    expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });
  });

  it("utenfor vinduet (kl. 12): ingenting, og sammendraget sier hvorfor", async () => {
    const x = await archivedCourse("middag");
    const summary = await round(x.ids, { clock: () => NOON });
    expect(summary.skipped).toBe("outside_window");
    expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });
  });

  it("budsjettet brukt opp: ingenting slettes, og sammendraget sier hvorfor; neste runde tar det", async () => {
    const x = await archivedCourse("budsjett");
    const first = await round(x.ids, { budgetMs: 0 });
    expect(first.stoppedBy).toBe("budget");
    expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });
    const second = await round(x.ids);
    expect(second.deleted).toEqual({ COURSE: 1, MODULE: 1, SECTION: 1 });
  });

  it("gjenopprettet og arkivert på nytt etter at kandidatene ble valgt: under låsen er fristen ikke nådd, og ingenting slettes", async () => {
    const x = await archivedCourse("arkivert på nytt");
    // Kandidaten ble valgt med arkiveringen 1. januar; så ble kurset arkivert på nytt i går (sett fra natten).
    await prisma.course.update({ where: { id: x.course }, data: { archivedAt: new Date("2026-07-09T12:00:00.000Z") } });
    expect(await deleteUnderLock("COURSE", x.course, NIGHT, "2026-07-10")).toEqual({ outcome: "not_due" });
    expect(await prisma.course.count({ where: { id: x.course } })).toBe(1);
    // KONTROLL: med den gamle arkiveringen slettes det.
    await prisma.course.update({ where: { id: x.course }, data: { archivedAt: ARCHIVED_AT } });
    expect(await deleteUnderLock("COURSE", x.course, NIGHT, "2026-07-10")).toEqual({ outcome: "deleted", blobPaths: [] });
    // Og en gang til: borte, ingen feil (to workere under en utrulling).
    expect(await deleteUnderLock("COURSE", x.course, NIGHT, "2026-07-10")).toEqual({ outcome: "gone" });
  });
});

// ── 2. Beholdes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152 4c: det vaktene holder igjen, står; «beholdes» skrives én gang", () => {
  it("kurs med kursbevis: beholdes; modulen og seksjonen i det holdes av kurset; én retention_kept for kurset, også etter to runder", async () => {
    const x = await archivedCourse("kursbevis");
    const course = await prisma.course.findUniqueOrThrow({ where: { id: x.course }, select: { versionMajor: true } });
    await prisma.courseCompletion.create({ data: { userId: await user("bevis"), courseId: x.course, versionMajor: course.versionMajor, moduleSnapshotJson: "[]" } });
    const before = { completions: await prisma.courseCompletion.count({ where: { courseId: x.course } }) };

    const first = await round(x.ids);
    expect(first.deleted).toEqual({ COURSE: 0, MODULE: 0, SECTION: 0 });
    expect(first.kept).toBe(3);
    const second = await round(x.ids); // ny natt-hukommelse: vurderes på nytt, men skriver ikke på nytt
    expect(second.kept).toBe(3);

    expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });
    expect(await prisma.courseCompletion.count({ where: { courseId: x.course } })).toBe(before.completions);
    const keptCourse = await auditFor(x.course, "retention_kept");
    expect(keptCourse).toHaveLength(1);
    expect(keptCourse[0]).toMatchObject({ kind: "COURSE", code: "course_has_completions", source: "retention" });
    expect(await auditFor(x.module, "retention_kept")).toEqual([expect.objectContaining({ code: "content_in_archived_course" })]);
  });

  it("samme natt huskes et kurs som beholdes (ingen ny vurdering); et element som holdes av et kurs, huskes ikke", async () => {
    const x = await archivedCourse("huskes");
    const course = await prisma.course.findUniqueOrThrow({ where: { id: x.course }, select: { versionMajor: true } });
    await prisma.courseCompletion.create({ data: { userId: await user("huskes"), courseId: x.course, versionMajor: course.versionMajor, moduleSnapshotJson: "[]" } });
    const keptTonight = new Map<string, string>();
    await round(x.ids, { keptTonight });
    expect(keptTonight.get(`COURSE:${x.course}`)).toBe("2026-07-10");
    expect(keptTonight.has(`MODULE:${x.module}`)).toBe(false);
    const second = await round(x.ids, { keptTonight });
    expect(second.kept, "kurset vurderes ikke på nytt i natt; modulen og seksjonen gjør").toBe(2);
  });

  it("en modul med en levert besvarelse: kurset slettes, modulen beholdes (module_has_submissions), besvarelsen står", async () => {
    const x = await archivedCourse("besvarelse");
    const submission = await prisma.submission.create({
      data: { userId: await user("levert"), moduleId: x.module, moduleVersionId: x.moduleVersion, deliveryType: "text", submissionStatus: "COMPLETED", submittedAt: ARCHIVED_AT },
      select: { id: true },
    });
    const summary = await round(x.ids);
    expect(summary.deleted).toEqual({ COURSE: 1, MODULE: 0, SECTION: 1 });
    expect(await prisma.submission.count({ where: { id: submission.id } })).toBe(1);
    expect(await auditFor(x.module, "retention_kept")).toEqual([expect.objectContaining({ code: "module_has_submissions" })]);
  });
});

// ── 3. Nødstoppen og overgangsraden ────────────────────────────────────────────────────────────────────────────────────────

describe("#1152 4c: nødstoppen og overgangsraden", () => {
  it("nødstoppen gjennom ruta (administrator): av → runden sletter ingenting; på → den gjør det; begge i revisjonsloggen", async () => {
    const x = await archivedCourse("nødstopp");
    const since = new Date();
    const off = await request(app).put("/api/admin/platform/archived-content-purge").set(ADMIN).send({ enabled: false });
    expect(off.status, show(off)).toBe(200);
    expect((await request(app).get("/api/admin/platform/archived-content-purge").set(ADMIN)).body).toEqual({ enabled: false });
    const stopped = await round(x.ids);
    expect(stopped.skipped).toBe("stopped");
    expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });

    const on = await request(app).put("/api/admin/platform/archived-content-purge").set(ADMIN).send({ enabled: true });
    expect(on.status, show(on)).toBe(200);
    expect((await round(x.ids)).deleted.COURSE).toBe(1);
    const toggles = await prisma.auditEvent.findMany({ where: { action: "archived_content_purge_toggled", timestamp: { gte: since } }, orderBy: { chainSeq: "asc" }, select: { metadataJson: true } });
    expect(toggles.map((t) => JSON.parse(t.metadataJson))).toEqual([{ enabled: false }, { enabled: true }]);
  });

  it("nødstoppen satt midt i en runde: ingenting mer slettes fra neste element (QA 2.175.0)", async () => {
    const x = await archivedCourse("stopp midt i");
    // Rundens første lesing av raden (ved start) er ekte; fra den neste svarer databasen «false», som om administratoren nettopp trykket.
    const original = prisma.platformConfig.findUnique.bind(prisma.platformConfig);
    let reads = 0;
    const spy = vi.spyOn(prisma.platformConfig, "findUnique").mockImplementation(((args: Parameters<typeof original>[0]) => {
      if ((args as { where?: { key?: string } })?.where?.key === ARCHIVED_CONTENT_PURGE_ENABLED_KEY) {
        reads += 1;
        if (reads > 1) return Promise.resolve({ value: "false" }) as never;
      }
      return original(args);
    }) as never);
    try {
      const summary = await round(x.ids);
      expect(summary.stoppedBy).toBe("purge_disabled");
      expect(summary.deleted).toEqual({ COURSE: 0, MODULE: 0, SECTION: 0 });
    } finally {
      // ⚠️ Ikke `mockRestore`: på en Prisma-modell fjerner den funksjonen for testene etter. Spionen går tilbake til originalen.
      spy.mockImplementation(original as never);
    }
    expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });
  });

  it("KONTROLL: nødstoppen er bare for administrator", async () => {
    const smo = { ...ADMIN, "x-user-roles": "SUBJECT_MATTER_OWNER" };
    const r = await request(app).put("/api/admin/platform/archived-content-purge").set(smo).send({ enabled: false });
    expect(r.status).toBe(403);
    expect(await prisma.platformConfig.findUnique({ where: { key: ARCHIVED_CONTENT_PURGE_ENABLED_KEY }, select: { value: true } })).not.toEqual({ value: "false" });
  });

  it("uten overgangsrad: ingenting slettes, og sammendraget sier floor_unavailable", async () => {
    const x = await archivedCourse("uten gulv");
    await setFloor(null);
    try {
      const summary = await round(x.ids);
      expect(summary.skipped).toBe("floor_unavailable");
      expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });
    } finally {
      await setFloor(FLOOR);
    }
  });
});

// ── 4. Overvåkeren og helsa ────────────────────────────────────────────────────────────────────────────────────────────────

describe("#1152 4c: overvåkeren gjør aldri workeren usunn fordi en runde feilet", () => {
  it("en runde som kaster: lastCycleAt settes likevel, lastError står, og helsesjekken er frisk", async () => {
    const monitor = new ArchivedContentRetentionMonitor(10 * 60_000, async () => { throw new Error("databasen er borte"); }, 0);
    await monitor.tick();
    const health = monitor.health();
    expect(health.lastCycleAt).not.toBeNull();
    expect(health.lastError).toBe("databasen er borte");
    expect(health.running).toBe(false);
    // 31 minutter senere uten nye runder ville «stalled»; rett etter en feilet runde er den frisk.
    const report = evaluateWorkerHealth([health], new Date(), new Date(Date.now() - 60 * 60_000));
    expect(report.healthy).toBe(true);
  });

  it("stopp: runden ser signalet før neste kandidat", async () => {
    const x = await archivedCourse("stopp");
    const summary = await round(x.ids, { shouldStop: () => true });
    expect(summary.stoppedBy).toBe("stop");
    expect(await exists(x)).toEqual({ course: 1, module: 1, section: 1 });
  });
});

// ── 5. Forhåndsvisningen sier det jobben gjør ──────────────────────────────────────────────────────────────────────────────

describe("#1152 4c: forhåndsvisningen (vedlikeholdsskriptet) gir samme sluttresultat som jobben", () => {
  it("«slettes» i forhåndsvisningen er nøyaktig det jobben sletter; «beholdes» med samme grunn", async () => {
    const free = await archivedCourse("forhånd fri");
    const held = await archivedCourse("forhånd bevis");
    const course = await prisma.course.findUniqueOrThrow({ where: { id: held.course }, select: { versionMajor: true } });
    await prisma.courseCompletion.create({ data: { userId: await user("forhand"), courseId: held.course, versionMajor: course.versionMajor, moduleSnapshotJson: "[]" } });
    const mine = new Set([...free.ids, ...held.ids]);

    const preview = (await previewArchivedRetention(NIGHT)).filter((row) => mine.has(row.id));
    const predicted = new Set(preview.filter((row) => row.verdict === "deletes").map((row) => row.id));
    expect(predicted).toEqual(new Set(free.ids));
    expect(preview.find((row) => row.id === held.course)).toMatchObject({ verdict: "kept", detail: "course_has_completions" });

    await round([...mine]);
    const remaining = new Set<string>();
    for (const id of mine) {
      const found = (await prisma.course.count({ where: { id } })) + (await prisma.module.count({ where: { id } })) + (await prisma.courseSection.count({ where: { id } }));
      if (found > 0) remaining.add(id);
    }
    expect(new Set([...mine].filter((id) => !remaining.has(id)))).toEqual(predicted);
  });
});
