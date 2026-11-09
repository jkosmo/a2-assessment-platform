import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { eligibleAssignmentPairs } from "../src/modules/course/courseAssignmentNotice.js";
import { getClassAssignedCourseDueDates, getUserClassIds } from "../src/modules/course/classService.js";
import { filterVisibleCourseIds } from "../src/modules/course/enrollmentService.js";
import { courseRepository } from "../src/modules/course/courseRepository.js";
import { SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "../src/modules/course/classRepository.js";

// #1142 skive 1: regelen «hvem har kurset nå» (`eligibleAssignmentPairs`, doc/design/PLAN_1142.md, punkt 2).
//
// Sammenligning, ikke etterligning (Codex runde 1 nr. 7). E-postregelen er med vilje strengere enn «Mine kurs», så testen
// er delt i to:
//   (a) KURSGRUNNLAGET — klasse, tildeling og kurs — mot «Mine kurs»-funksjonene (`getUserClassIds` →
//       `getClassAssignedCourseDueDates` → `filterVisibleCourseIds`) og mot «Mine kurs»-ruta, på vanlige klasser som ikke er
//       arkivert. Personene er aktive og har ingen kursbevis, så vilkårene om person og kursbevis står stille her, og regelen
//       skal gi nøyaktig det «Mine kurs» viser fra klassene.
//   (b) FILTRENE FOR SEG, ett om gangen, hvert med en kontroll som snur bare det ene og viser at paret da kommer: arkivert
//       klasse, «Alle deltakere», Entra-klasse, inaktiv, anonymisert, kursbevis for eldre og nåværende hovedversjon.
//
// Klasser, medlemmer, tildelinger, publisering og arkivering går gjennom rutene. Direkte i databasen, der planen sier det
// eller ingen rute finnes: Entra-klassen (ingen kode lager dem, #1017), en medlemsrad i «Alle deltakere» (ruta nekter),
// personens tilstand (aktiv, anonymisert), kursbevis, en lest seksjon, og et arkivert kurs som fortsatt har `publishedAt`
// (arkivering avpubliserer, men regelen skal ikke hvile på det).

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `regel1142 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });

const adminHeaders = { "x-user-id": `regel1142-admin-${RUN}`, "x-user-email": `regel1142.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

afterAll(async () => {
  await prisma.$disconnect();
});

async function learner() {
  const externalId = `regel1142-p-${RUN}-${seq++}`;
  const user = await prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test` }, select: { id: true } });
  const headers = { "x-user-id": externalId, "x-user-email": `${externalId}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
  return { userId: user.id, headers };
}

/** Kurs med én publisert modul og én publisert seksjon. RESTRICTED: da er klassen det eneste som gir tilgang. */
async function course(options: { published?: boolean; versionMajor?: number } = {}) {
  const module = await prisma.module.create({ data: { title: L(tag("modul")) }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({ data: { moduleId: module.id, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() }, select: { id: true } });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const sectionVersion = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: sectionVersion.id } });
  const created = await prisma.course.create({
    data: {
      title: L(tag("kurs")),
      enrollmentPolicy: "RESTRICTED",
      publishedAt: options.published === false ? null : new Date(),
      ...(options.versionMajor ? { versionMajor: options.versionMajor } : {}),
      items: {
        create: [
          { itemType: "MODULE", moduleId: module.id, sortOrder: 0 },
          { itemType: "SECTION", sectionId: section.id, sortOrder: 1 },
        ],
      },
    },
    select: { id: true },
  });
  return { courseId: created.id, sectionId: section.id };
}

async function newClass() {
  const created = await request(app).post("/api/admin/content/classes").set(adminHeaders).send({ name: tag("klasse") });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.class.id as string;
}

async function addMember(classId: string, userId: string) {
  const response = await request(app).post(`/api/admin/content/classes/${classId}/members`).set(adminHeaders).send({ userId });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function assignCourse(classId: string, courseId: string) {
  const response = await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(adminHeaders).send({ courseId, dueAt: "2030-01-01T00:00:00.000Z" });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function post(path: string, body: object = {}) {
  const response = await request(app).post(path).set(adminHeaders).send(body);
  expect(response.status, `${path} ${JSON.stringify(response.body)}`).toBe(200);
}

const archiveClass = (classId: string) => post(`/api/admin/content/classes/${classId}/archive`);
const restoreClass = (classId: string) => post(`/api/admin/content/classes/${classId}/restore`);

/** Regelen for personen og kursene: kurs-id-ene, sortert. */
async function rule(userId: string, courseIds: string[]) {
  const pairs = await eligibleAssignmentPairs(prisma, { userId, courseIds });
  for (const pair of pairs) expect(pair.userId).toBe(userId);
  return pairs.map((pair) => pair.courseId).sort();
}

/** «Mine kurs» fra klassene, gjennom de samme funksjonene som ruta bruker, avgrenset til kursene. */
async function myCourses(userId: string, courseIds: string[]) {
  const classIds = await getUserClassIds({ userId, roles: ["PARTICIPANT"] });
  const fromClasses = await getClassAssignedCourseDueDates(classIds, userId);
  const published = (await courseRepository.findPublishedCourses()).filter((c) => courseIds.includes(c.id));
  const visible = await filterVisibleCourseIds(userId, published, new Set(fromClasses.keys()));
  return [...visible].sort();
}

/** «Mine kurs» gjennom ruta, avgrenset til kursene. */
async function myCoursesRoute(headers: Record<string, string>, courseIds: string[]) {
  const response = await request(app).get("/api/courses").set(headers);
  expect(response.status).toBe(200);
  return (response.body.courses as Array<{ id: string }>).map((c) => c.id).filter((id) => courseIds.includes(id)).sort();
}

const sorted = (ids: string[]) => [...ids].sort();

describe("(a) kursgrunnlaget: regelen gir det «Mine kurs» viser fra vanlige klasser som ikke er arkivert", () => {
  it("publisert, upublisert, avpublisert, arkivert og to klasser med samme kurs — likt for hver person, og publisering tar kurset inn", async () => {
    const published1 = await course();
    const published2 = await course();
    const draft = await course({ published: false });
    const unpublished = await course();
    const archived = await course();
    const archivedStillPublished = await course();
    const noMembers = await course();
    const all = [published1, published2, draft, unpublished, archived, archivedStillPublished, noMembers].map((c) => c.courseId);

    const both = await learner();
    const onlySecond = await learner();
    const none = await learner();
    const first = await newClass();
    const second = await newClass();
    const empty = await newClass();
    await addMember(first, both.userId);
    await addMember(second, both.userId);
    await addMember(second, onlySecond.userId);
    for (const c of [published1, draft, unpublished, archived, archivedStillPublished]) await assignCourse(first, c.courseId);
    for (const c of [published1, published2]) await assignCourse(second, c.courseId);
    await assignCourse(empty, noMembers.courseId);

    await post(`/api/admin/content/courses/${unpublished.courseId}/unpublish`);
    await post(`/api/admin/content/courses/${archived.courseId}/archive`);
    // Arkivering avpubliserer (`archiveCourse`). Et arkivert kurs med `publishedAt` lages direkte, så vilkåret om arkivert
    // kurs måles for seg og ikke gjennom avpubliseringen.
    await prisma.course.update({ where: { id: archivedStillPublished.courseId }, data: { archivedAt: new Date() } });

    const expected = sorted([published1.courseId, published2.courseId]);
    for (const person of [both, onlySecond]) {
      expect(await myCourses(person.userId, all), "«Mine kurs»-funksjonene").toEqual(expected);
      expect(await myCoursesRoute(person.headers, all), "«Mine kurs»-ruta").toEqual(expected);
      expect(await rule(person.userId, all), "regelen").toEqual(expected);
    }
    expect(await myCourses(none.userId, all)).toEqual([]);
    expect(await rule(none.userId, all)).toEqual([]);

    // Samme kurs fra to klasser: ett par, ikke to.
    expect(await eligibleAssignmentPairs(prisma, { userId: both.userId, courseIds: [published1.courseId] })).toHaveLength(1);

    // Vei 3: utkastet publiseres gjennom «Publiser kurs», og er med begge steder for den som har det fra en klasse.
    await post(`/api/admin/content/courses/${draft.courseId}/publish`);
    expect(await myCourses(both.userId, all)).toEqual(sorted([...expected, draft.courseId]));
    expect(await rule(both.userId, all)).toEqual(sorted([...expected, draft.courseId]));
    expect(await rule(onlySecond.userId, all)).toEqual(expected);
  });
});

describe("(b) filtrene for seg: hvert vilkår tar paret ut, og kontrollen viser at paret ellers er med", () => {
  it("arkivert klasse: ingen par, også når kurset er påbegynt og står i «Mine kurs». Gjenopprettet klasse gir paret (vei 5)", async () => {
    const c = await course();
    const u = await learner();
    const classId = await newClass();
    await addMember(classId, u.userId);
    await assignCourse(classId, c.courseId);
    await prisma.courseSectionRead.create({ data: { userId: u.userId, courseId: c.courseId, sectionId: c.sectionId } });
    await archiveClass(classId);

    expect(await myCourses(u.userId, [c.courseId]), "påbegynt: står i «Mine kurs»").toEqual([c.courseId]);
    expect(await myCoursesRoute(u.headers, [c.courseId])).toEqual([c.courseId]);
    expect(await rule(u.userId, [c.courseId])).toEqual([]);

    await restoreClass(classId);
    expect(await rule(u.userId, [c.courseId])).toEqual([c.courseId]);
  });

  it("aktiv og arkivert klasse med samme kurs: paret er med, gjennom den aktive", async () => {
    const c = await course();
    const u = await learner();
    const archived = await newClass();
    const active = await newClass();
    for (const classId of [archived, active]) {
      await addMember(classId, u.userId);
      await assignCourse(classId, c.courseId);
    }
    await archiveClass(archived);
    expect(await rule(u.userId, [c.courseId])).toEqual([c.courseId]);
    expect(await eligibleAssignmentPairs(prisma, { userId: u.userId, courseIds: [c.courseId] })).toHaveLength(1);
  });

  it("«Alle deltakere»: kurset står i «Mine kurs», men gir ingen par — heller ikke med en medlemsrad i klassen", async () => {
    const c = await course();
    const u = await learner();
    await assignCourse(SYSTEM_ALL_PARTICIPANTS_CLASS_ID, c.courseId);
    try {
      expect(await myCourses(u.userId, [c.courseId]), "deltakeren har kurset fra systemklassen").toEqual([c.courseId]);
      expect(await myCoursesRoute(u.headers, [c.courseId])).toEqual([c.courseId]);
      expect(await rule(u.userId, [c.courseId])).toEqual([]);
      // Systemklassen har ingen medlemsrader (ruta nekter, `system_class_immutable`). Raden lages direkte, så filteret på
      // `isSystem` måles og ikke bare fraværet av rader.
      await prisma.classMember.create({ data: { classId: SYSTEM_ALL_PARTICIPANTS_CLASS_ID, userId: u.userId } });
      expect(await rule(u.userId, [c.courseId])).toEqual([]);
    } finally {
      await prisma.classMember.deleteMany({ where: { classId: SYSTEM_ALL_PARTICIPANTS_CLASS_ID, userId: u.userId } });
      const removed = await request(app).delete(`/api/admin/content/classes/${SYSTEM_ALL_PARTICIPANTS_CLASS_ID}/courses/${c.courseId}`).set(adminHeaders);
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
    }
  });

  it("Entra-klasse (laget direkte i databasen, med en medlemsrad): ingen par. Samme klasse som vanlig klasse gir paret", async () => {
    const c = await course();
    const u = await learner();
    const entra = await prisma.class.create({ data: { name: tag("entra"), kind: "ENTRA", entraGroupId: `gruppe-${RUN}` }, select: { id: true } });
    await prisma.classMember.create({ data: { classId: entra.id, userId: u.userId } });
    await prisma.courseGroupAssignment.create({ data: { classId: entra.id, courseId: c.courseId } });
    expect(await rule(u.userId, [c.courseId])).toEqual([]);

    await prisma.class.update({ where: { id: entra.id }, data: { kind: "MANUAL", entraGroupId: null } });
    expect(await rule(u.userId, [c.courseId])).toEqual([c.courseId]);
  });

  async function memberWithCourse(options: { versionMajor?: number } = {}) {
    const c = await course(options);
    const u = await learner();
    const classId = await newClass();
    await addMember(classId, u.userId);
    await assignCourse(classId, c.courseId);
    expect(await rule(u.userId, [c.courseId]), "kontroll før endringen").toEqual([c.courseId]);
    return { ...c, ...u, classId };
  }

  it("inaktiv person: kurset står i «Mine kurs», men gir ingen par. Aktiv igjen gir paret (vei 4)", async () => {
    const m = await memberWithCourse();
    await prisma.user.update({ where: { id: m.userId }, data: { activeStatus: false } });
    expect(await myCourses(m.userId, [m.courseId])).toEqual([m.courseId]);
    expect(await rule(m.userId, [m.courseId])).toEqual([]);
    await prisma.user.update({ where: { id: m.userId }, data: { activeStatus: true } });
    expect(await rule(m.userId, [m.courseId])).toEqual([m.courseId]);
  });

  it("anonymisert person, ellers aktiv: ingen par", async () => {
    const m = await memberWithCourse();
    await prisma.user.update({ where: { id: m.userId }, data: { isAnonymized: true } });
    expect(await myCourses(m.userId, [m.courseId])).toEqual([m.courseId]);
    expect(await rule(m.userId, [m.courseId])).toEqual([]);
  });

  it("kursbevis for en eldre hovedversjon: ingen par (hvilken som helst hovedversjon teller, spørsmål 1)", async () => {
    const m = await memberWithCourse({ versionMajor: 2 });
    await prisma.courseCompletion.create({ data: { userId: m.userId, courseId: m.courseId, moduleSnapshotJson: "[]", versionMajor: 1 } });
    expect(await myCourses(m.userId, [m.courseId])).toEqual([m.courseId]);
    expect(await rule(m.userId, [m.courseId])).toEqual([]);
  });

  it("kursbevis for nåværende hovedversjon: ingen par. Et bevis for et ANNET kurs tar ikke dette ut", async () => {
    const m = await memberWithCourse();
    const other = await course();
    await prisma.courseCompletion.create({ data: { userId: m.userId, courseId: other.courseId, moduleSnapshotJson: "[]" } });
    expect(await rule(m.userId, [m.courseId]), "bevis for et annet kurs").toEqual([m.courseId]);
    await prisma.courseCompletion.create({ data: { userId: m.userId, courseId: m.courseId, moduleSnapshotJson: "[]", versionMajor: 1 } });
    expect(await rule(m.userId, [m.courseId])).toEqual([]);
  });

  it("avgrensningen: bare den personen og de kursene", async () => {
    const m = await memberWithCourse();
    const other = await learner();
    await addMember(m.classId, other.userId);
    const second = await course();
    await assignCourse(m.classId, second.courseId);
    expect(await rule(m.userId, [m.courseId])).toEqual([m.courseId]);
    expect(await rule(m.userId, [m.courseId, second.courseId])).toEqual(sorted([m.courseId, second.courseId]));
    expect(await rule(other.userId, [second.courseId])).toEqual([second.courseId]);
    expect(await rule(m.userId, [])).toEqual([]);
  });
});
