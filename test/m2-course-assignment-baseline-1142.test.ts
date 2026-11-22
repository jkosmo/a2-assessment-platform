import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { deliverCourseAssignmentDigest, runCourseAssignmentEmailSchedule, type CourseAssignmentDigestSend } from "../src/modules/course/courseAssignmentNotice.js";
import { OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";

// #1142 skive 3: migrering 2 (`…_course_assignment_notice_baseline`) gir `baseline` for kursene folk har fra før, så ingen
// får e-post om gamle kurs (doc/design/PLAN_1142.md, punkt 2). Testen LESER migreringsfila og kjører den mot et oppsett, så
// den måler den ekte migreringen.
//
// Ett tilfelle per spor av «har vært ute» (Codex runde 1 nr. 1): publisert nå (avpubliseres og publiseres igjen etterpå),
// avpublisert med delingslenke, avpublisert uten delingslenke men med `course_published` i revisjonssporet, uten begge men
// med kursbevis, og arkivert. Og et ekte utkast uten noen av sporene, som gir e-post når det publiseres (vei 3). Ingen filter
// på personen eller på arkiverte klasser; filteret på vanlige klasser (ikke Entra, ikke «Alle deltakere») er med.
//
// ⚠️ Migreringen kjører over hele testdatabasen, som deles med andre testfiler (de kjører én om gangen). Den gir bare
// `baseline` for par uten rad; ingen andre tester leser tabellen uavgrenset.

const MIGRATION_DIR = path.join(process.cwd(), "prisma", "migrations");
const migrationFile = () => {
  const dir = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith("_course_assignment_notice_baseline"));
  expect(dir, "migreringen finnes én gang").toHaveLength(1);
  return path.join(MIGRATION_DIR, dir[0]!, "migration.sql");
};

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `baseline1142 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const admin = { "x-user-id": `baseline1142-admin-${RUN}`, "x-user-email": `baseline1142.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

afterAll(async () => {
  await prisma.$disconnect();
});

async function person(extra: { activeStatus?: boolean } = {}) {
  const externalId = `baseline1142-p-${RUN}-${seq++}`;
  return prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test`, ...extra }, select: { id: true } });
}

/** Et kurs med én publisert modul og én publisert seksjon, i tilstanden sporet trenger. */
async function course(data: { publishedAt?: Date | null; slug?: string | null } = {}) {
  const title = tag("kurs");
  const module = await prisma.module.create({ data: { title: L(tag("modul")) }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({ data: { moduleId: module.id, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() }, select: { id: true } });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const sectionVersion = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: sectionVersion.id } });
  const created = await prisma.course.create({
    data: {
      title: L(title),
      enrollmentPolicy: "RESTRICTED",
      publishedAt: data.publishedAt ?? null,
      slug: data.slug ?? null,
      items: { create: [{ itemType: "MODULE", moduleId: module.id, sortOrder: 0 }, { itemType: "SECTION", sectionId: section.id, sortOrder: 1 }] },
    },
    select: { id: true },
  });
  return { id: created.id, title };
}

async function call(method: "post" | "delete", url: string, body: object = {}, expected = 200) {
  const response = await request(app)[method](url).set(admin).send(body);
  expect(response.status, `${url} ${JSON.stringify(response.body).slice(0, 300)}`).toBe(expected);
  return response;
}

async function newClass() {
  return (await call("post", "/api/admin/content/classes", { name: tag("klasse") }, 201)).body.class.id as string;
}

describe("#1142 skive 3 — baseline: kurs folk hadde før, gir ingen e-post", () => {
  it("hvert spor av «har vært ute» gir `baseline`, også etter avpublisering og publisering; et ekte utkast gir e-post når det publiseres", async () => {
    // Sporene, ett kurs hver.
    const publishedNow = await course({ publishedAt: new Date() });
    const withSlug = await course({ slug: `baseline1142-${RUN}-${seq++}` });
    // Publisert og avpublisert gjennom rutene (revisjonssporet får `course_published`), så delingslenka fjernet: et kurs
    // som var ute før delingslenka kom (2.121.0).
    const withAudit = await course();
    const withCertificate = await course();
    const archived = await course();
    const draft = await course();
    const all = [publishedNow, withSlug, withAudit, withCertificate, archived, draft];
    const ids = all.map((c) => c.id);

    const member = await person();
    const left = await person({ activeStatus: false });
    const inArchivedClass = await person();
    const inEntraClass = await person();
    const certificateHolder = await person();

    const classId = await newClass();
    const archivedClassId = await newClass();
    for (const userId of [member.id, left.id]) await call("post", `/api/admin/content/classes/${classId}/members`, { userId }, 201);
    await call("post", `/api/admin/content/classes/${archivedClassId}/members`, { userId: inArchivedClass.id }, 201);
    for (const c of all) {
      await call("post", `/api/admin/content/classes/${classId}/courses`, { courseId: c.id }, 201);
      await call("post", `/api/admin/content/classes/${archivedClassId}/courses`, { courseId: c.id }, 201);
    }
    await call("post", `/api/admin/content/classes/${archivedClassId}/archive`);
    // Entra-klasse (ingen kode lager dem, #1017): filteret på `kind` gjelder også i migreringen.
    const entra = await prisma.class.create({ data: { name: tag("entra"), kind: "ENTRA", entraGroupId: `gruppe-${RUN}` }, select: { id: true } });
    await prisma.classMember.create({ data: { classId: entra.id, userId: inEntraClass.id } });
    await prisma.courseGroupAssignment.createMany({ data: ids.map((courseId) => ({ classId: entra.id, courseId })) });

    await call("post", `/api/admin/content/courses/${withAudit.id}/publish`);
    await call("post", `/api/admin/content/courses/${withAudit.id}/unpublish`);
    await prisma.course.update({ where: { id: withAudit.id }, data: { slug: null } });
    expect(await prisma.auditEvent.count({ where: { entityType: "course", entityId: withAudit.id, action: "course_published" } })).toBeGreaterThan(0);
    await prisma.courseCompletion.create({ data: { userId: certificateHolder.id, courseId: withCertificate.id, moduleSnapshotJson: "[]" } });
    await prisma.course.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    // Kontroll: ingen av de andre sporene ligger på kursene ved et uhell.
    for (const c of [withSlug, withCertificate, archived, draft]) {
      const row = await prisma.course.findUniqueOrThrow({ where: { id: c.id }, select: { publishedAt: true } });
      expect(row.publishedAt, "bare kurset for «publisert nå» er publisert").toBeNull();
    }

    // Migreringen, slik den står i fila.
    await prisma.$executeRawUnsafe(readFileSync(migrationFile(), "utf8"));

    const rows = await prisma.courseAssignmentNotice.findMany({ where: { courseId: { in: ids } } });
    const byUser = (userId: string) => rows.filter((r) => r.userId === userId).map((r) => r.courseId).sort();
    const hadBefore = ids.filter((id) => id !== draft.id).sort();
    expect(byUser(member.id), "medlemmet").toEqual(hadBefore);
    expect(byUser(left.id), "uten filter på personen").toEqual(hadBefore);
    expect(byUser(inArchivedClass.id), "uten filter på arkiverte klasser").toEqual(hadBefore);
    expect(byUser(inEntraClass.id), "Entra-klasser er ikke med").toEqual([]);
    expect(rows.every((r) => r.status === "baseline" && r.reason === "before_1142")).toBe(true);

    // Kjørt igjen: ingenting nytt (ON CONFLICT DO NOTHING).
    expect(await prisma.$executeRawUnsafe(readFileSync(migrationFile(), "utf8"))).toBeGreaterThanOrEqual(0);
    expect(await prisma.courseAssignmentNotice.count({ where: { courseId: { in: ids } } })).toBe(rows.length);

    // Alt publiseres (igjen). Det arkiverte gjenopprettes først. Bare utkastet gir e-post.
    await call("post", `/api/admin/content/courses/${publishedNow.id}/unpublish`);
    await call("post", `/api/admin/content/courses/${archived.id}/restore`);
    for (const c of all) await call("post", `/api/admin/content/courses/${c.id}/publish`);
    // En som kommer tilbake, får heller ikke e-post om kursene fra før (vei 4).
    await prisma.user.update({ where: { id: left.id }, data: { activeStatus: true } });

    const t0 = new Date(Date.now() - 2 * 60 * 60_000);
    expect(await runCourseAssignmentEmailSchedule({ now: t0, onlyCourseIds: ids })).toMatchObject({ created: 2 });
    expect(await runCourseAssignmentEmailSchedule({ now: new Date(t0.getTime() + 16 * 60_000), onlyCourseIds: ids })).toMatchObject({ queued: 2 });
    const send = vi.fn<CourseAssignmentDigestSend>(async () => ({ delivered: true, channel: "log", subject: "", nextStepGuidance: "" }));
    const events = (await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.courseAssignmentDigest } }))
      .map((e) => JSON.parse(e.payloadJson) as { batchId: string; userId: string })
      .filter((p) => [member.id, left.id, inArchivedClass.id, inEntraClass.id].includes(p.userId));
    for (const p of events) await deliverCourseAssignmentDigest(p.batchId, { send });
    expect(send.mock.calls.map(([input]) => input.userId).sort()).toEqual([member.id, left.id].sort());
    for (const [input] of send.mock.calls) expect(input.courses.map((c) => JSON.parse(c.title).nb)).toEqual([draft.title]);
  });
});
