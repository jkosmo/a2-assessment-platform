import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// Produkteier 2026-11-08, arkiverte klasser:
//   «Kurs fra arkiverte klasser som ikke er fullført eller påbegynt bør ikke vises i Mine kurs. Man bør ikke kunne legge til
//    folk i en arkivert klasse.» Og: det skal heller ikke være mulig å tildele kurs til en arkivert klasse.
//
// Det testen måler, gjennom rutene:
//   - «Påbegynt eller fullført» er det kursdetaljen regner som fremdrift: lest seksjon, levert (eller bestått) modul, kursbevis.
//     Hver av dem holder kurset synlig, hver for seg. Uten noen av dem er kurset borte fra lista, detaljen, /enrollments og
//     diskusjonene, og en kontroll viser at det var synlig før arkiveringen.
//   - Fra en aktiv klasse, som OPEN-kurs og som individuell tildeling vises kurset som før.
//   - En arkivert klasse tar ikke imot medlemmer eller kurs (400 class_archived), og ingenting er skrevet. Etter gjenoppretting går det.
//   - En arkivering som kommer mens en innmelding står i transaksjonen, venter, og innmeldingen etterpå avvises.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `arkiv ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const adminHeaders = { "x-user-id": `arkiv-admin-${RUN}`, "x-user-email": `arkiv.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

afterAll(async () => {
  await prisma.$disconnect();
});

async function learner() {
  const externalId = `arkiv-p-${RUN}-${seq++}`;
  const user = await prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test` }, select: { id: true } });
  const headers = { "x-user-id": externalId, "x-user-email": `${externalId}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
  return { userId: user.id, headers };
}

/** Publisert kurs med én modul og én seksjon. RESTRICTED som standard: da er klassen det eneste som gir tilgang. */
async function course(options: { policy?: "RESTRICTED" | "OPEN" } = {}) {
  const module = await prisma.module.create({ data: { title: L(tag("modul")) }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({ data: { moduleId: module.id, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() }, select: { id: true } });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const sectionVersion = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: sectionVersion.id } });
  const created = await prisma.course.create({
    data: {
      title: L(tag("kurs")),
      enrollmentPolicy: options.policy ?? "RESTRICTED",
      publishedAt: new Date(),
      items: {
        create: [
          { itemType: "MODULE", moduleId: module.id, sortOrder: 0 },
          { itemType: "SECTION", sectionId: section.id, sortOrder: 1 },
        ],
      },
    },
    select: { id: true },
  });
  return { courseId: created.id, moduleId: module.id, moduleVersionId: moduleVersion.id, sectionId: section.id };
}

async function newClass() {
  const created = await request(app).post("/api/admin/content/classes").set(adminHeaders).send({ name: tag("klasse") });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.class.id as string;
}

const addMember = (classId: string, userId: string) =>
  request(app).post(`/api/admin/content/classes/${classId}/members`).set(adminHeaders).send({ userId });
const assignCourse = (classId: string, courseId: string) =>
  request(app).post(`/api/admin/content/classes/${classId}/courses`).set(adminHeaders).send({ courseId, dueAt: "2030-01-01T00:00:00.000Z" });
const archive = (classId: string) => request(app).post(`/api/admin/content/classes/${classId}/archive`).set(adminHeaders);
const restore = (classId: string) => request(app).post(`/api/admin/content/classes/${classId}/restore`).set(adminHeaders);

/** Deltakeren i en klasse med kurset tildelt, alt gjennom rutene. */
async function memberWithCourse(options: { policy?: "RESTRICTED" | "OPEN" } = {}) {
  const c = await course(options);
  const u = await learner();
  const classId = await newClass();
  expect((await addMember(classId, u.userId)).status).toBe(201);
  expect((await assignCourse(classId, c.courseId)).status).toBe(201);
  return { ...c, ...u, classId };
}

/** Alle deltakerflatene som svarer på «har deltakeren dette kurset». */
async function sees(headers: Record<string, string>, courseId: string) {
  const list = await request(app).get("/api/courses").set(headers);
  expect(list.status).toBe(200);
  const enrollments = await request(app).get("/api/courses/enrollments").set(headers);
  expect(enrollments.status).toBe(200);
  const detail = await request(app).get(`/api/courses/${courseId}`).set(headers);
  const discussions = await request(app).get(`/api/courses/${courseId}/discussions`).set(headers);
  return {
    list: (list.body.courses as Array<{ id: string }>).some((row) => row.id === courseId),
    enrollments: (enrollments.body.enrollments as Array<{ courseId: string }>).some((row) => row.courseId === courseId),
    detail: detail.status,
    discussions: discussions.status,
  };
}

const visible = { list: true, enrollments: true, detail: 200, discussions: 200 };
const hidden = { list: false, enrollments: false, detail: 404, discussions: 404 };

describe("«Mine kurs»: kurs fra arkiverte klasser", () => {
  it("ikke påbegynt: synlig før arkiveringen, borte etterpå, overalt, og tilbake etter gjenoppretting", async () => {
    const m = await memberWithCourse();
    expect(await sees(m.headers, m.courseId)).toEqual(visible);
    expect((await archive(m.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(hidden);
    expect((await restore(m.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(visible);
  });

  it("påbegynt med en lest seksjon: vises som før", async () => {
    const m = await memberWithCourse();
    await prisma.courseSectionRead.create({ data: { userId: m.userId, courseId: m.courseId, sectionId: m.sectionId } });
    expect((await archive(m.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(visible);
  });

  it("påbegynt med en levert modul, også uten vedtak: vises som før", async () => {
    const m = await memberWithCourse();
    await prisma.submission.create({ data: { userId: m.userId, moduleId: m.moduleId, moduleVersionId: m.moduleVersionId, deliveryType: "text", submissionStatus: "SUBMITTED" } });
    expect((await archive(m.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(visible);
  });

  it("fullført (kursbevis), uten noen annen rad: vises som før", async () => {
    const m = await memberWithCourse();
    await prisma.courseCompletion.create({ data: { userId: m.userId, courseId: m.courseId, moduleSnapshotJson: "[]" } });
    expect((await archive(m.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(visible);
  });

  it("en lesing eller innlevering i et ANNET kurs gjør ikke dette påbegynt", async () => {
    const m = await memberWithCourse();
    const other = await course();
    await prisma.courseSectionRead.create({ data: { userId: m.userId, courseId: other.courseId, sectionId: other.sectionId } });
    await prisma.submission.create({ data: { userId: m.userId, moduleId: other.moduleId, moduleVersionId: other.moduleVersionId, deliveryType: "text", submissionStatus: "SUBMITTED" } });
    expect((await archive(m.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(hidden);
  });

  it("også fra en aktiv klasse: vises som før", async () => {
    const m = await memberWithCourse();
    const active = await newClass();
    expect((await addMember(active, m.userId)).status).toBe(201);
    expect((await assignCourse(active, m.courseId)).status).toBe(201);
    expect((await archive(m.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(visible);
  });

  it("individuelt tildelt, og et OPEN-kurs: vises som før", async () => {
    const m = await memberWithCourse();
    await prisma.courseEnrollment.create({ data: { userId: m.userId, courseId: m.courseId, source: "INDIVIDUAL" } });
    const open = await memberWithCourse({ policy: "OPEN" });
    expect((await archive(m.classId)).status).toBe(200);
    expect((await archive(open.classId)).status).toBe(200);
    expect(await sees(m.headers, m.courseId)).toEqual(visible);
    const openSeen = await sees(open.headers, open.courseId);
    expect({ list: openSeen.list, detail: openSeen.detail, discussions: openSeen.discussions }).toEqual({ list: true, detail: 200, discussions: 200 });
  });
});

describe("en arkivert klasse tar ikke imot deltakere eller kurs", () => {
  it("ny deltaker: 400 class_archived, og ingenting er skrevet. Etter gjenoppretting går det", async () => {
    const classId = await newClass();
    const u = await learner();
    expect((await archive(classId)).status).toBe(200);
    const refused = await addMember(classId, u.userId);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("class_archived");
    expect(refused.body.details).toMatchObject({ action: "add_member", classId });
    expect(await prisma.classMember.count({ where: { classId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityType: "class", entityId: classId, action: "class_member_added" } })).toBe(0);

    expect((await restore(classId)).status).toBe(200);
    expect((await addMember(classId, u.userId)).status).toBe(201);
    expect(await prisma.classMember.count({ where: { classId } })).toBe(1);
  });

  it("nytt kurs: 400 class_archived, og ingenting er skrevet. Etter gjenoppretting går det", async () => {
    const classId = await newClass();
    const c = await course();
    expect((await archive(classId)).status).toBe(200);
    const refused = await assignCourse(classId, c.courseId);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error).toBe("class_archived");
    expect(refused.body.details).toMatchObject({ action: "assign_course", classId });
    expect(await prisma.courseGroupAssignment.count({ where: { classId } })).toBe(0);

    expect((await restore(classId)).status).toBe(200);
    expect((await assignCourse(classId, c.courseId)).status).toBe(201);
    expect(await prisma.courseGroupAssignment.count({ where: { classId } })).toBe(1);
  });

  it("å fjerne en deltaker fra en arkivert klasse går fortsatt", async () => {
    const m = await memberWithCourse();
    expect((await archive(m.classId)).status).toBe(200);
    expect((await request(app).delete(`/api/admin/content/classes/${m.classId}/members/${m.userId}`).set(adminHeaders)).status).toBe(204);
    expect(await prisma.classMember.count({ where: { classId: m.classId } })).toBe(0);
  });

  it("en arkivering som står åpen mens deltakeren legges til: innmeldingen venter, og avvises når arkiveringen er skrevet", async () => {
    const classId = await newClass();
    const u = await learner();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const archiving = prisma.$transaction(async (tx) => {
      await tx.class.update({ where: { id: classId }, data: { archivedAt: new Date() } });
      locked();
      await held;
    }, { timeout: 15_000 });
    await isLocked;
    let settled = false;
    const adding = addMember(classId, u.userId).then((response) => { settled = true; return response; });
    await pause(500);
    expect(settled, "innmeldingen ventet ikke på arkiveringen").toBe(false);
    release();
    await archiving;
    const response = await adding;
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.error).toBe("class_archived");
    expect(await prisma.classMember.count({ where: { classId } })).toBe(0);
  });
});
