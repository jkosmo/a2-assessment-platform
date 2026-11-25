import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import {
  runCourseReminderSchedule,
  type CourseReminderSendInput,
  type CourseReminderSendResult,
} from "../src/modules/course/courseReminderService.js";
import { getWeeklyDigestContent } from "../src/modules/weeklyDigest/weeklyDigestContent.js";

// #1192 punkt 2, skive 2b og 2a (doc/design/PLAN_1192_BESTATT_OG_FRIST.md).
//
// 2b: ÉN regel for gjeldende frist (`effectiveDeadline`). Før kunne samme person ha tre frister:
//   - Status lot en tildeling uten frist vinne (ingen frist),
//   - påminnelsene så bare individuelle frister innen vinduet, så klassens frist vant (påminnelse om forfalt),
//   - den ukentlige e-posten brukte `??`, så klassens frist vant («Fristen har gått ut»).
// Nå: en tildeling til personen vinner, også uten frist; en SELF-påmelding gjør ikke det; ellers den tidligste fra aktive klasser.
//
// 2a: `dueSetAt` skrives når fristen settes eller endres, ikke når samme dato sendes på nytt.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `frist ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const admin = { "x-user-id": `frist-admin-${RUN}`, "x-user-email": `frist.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };
const PASSERT = new Date(Date.now() - 10 * 24 * 3600 * 1000);
const LANGT_FRAM = new Date(Date.now() + 200 * 24 * 3600 * 1000);

const laget = { courses: [] as string[], users: [] as string[], classes: [] as string[] };
afterAll(async () => {
  await prisma.courseEnrollment.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.courseGroupAssignment.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.courseSectionRead.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.course.deleteMany({ where: { id: { in: laget.courses } } });
  await prisma.class.deleteMany({ where: { id: { in: laget.classes } } });
  await prisma.user.deleteMany({ where: { id: { in: laget.users } } });
  await prisma.$disconnect();
});

async function deltaker(name: string) {
  const externalId = `frist-${name}-${RUN}-${seq++}`;
  const user = await prisma.user.create({
    data: {
      externalId,
      name,
      email: `${externalId}@x.test`,
      roleAssignments: { create: { appRole: "PARTICIPANT", validFrom: new Date("2020-01-01T00:00:00.000Z") } },
    },
    select: { id: true },
  });
  laget.users.push(user.id);
  return { userId: user.id, headers: { "x-user-id": externalId, "x-user-email": `${externalId}@x.test`, "x-user-name": name, "x-user-roles": "PARTICIPANT", "x-locale": "nb" } };
}

/** Publisert kurs med én publisert seksjon (så «Mine kurs» og e-posten har et steg å vise). */
async function kurs(policy: "RESTRICTED" | "OPEN" = "RESTRICTED") {
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const version = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  const course = await prisma.course.create({
    data: { title: L(tag("kurs")), publishedAt: new Date(), enrollmentPolicy: policy, items: { create: [{ itemType: "SECTION", sectionId: section.id, sortOrder: 0 }] } },
    select: { id: true },
  });
  laget.courses.push(course.id);
  return course.id;
}

async function klasse(memberIds: string[]) {
  const created = await prisma.class.create({ data: { name: tag("klasse"), members: { create: memberIds.map((userId) => ({ userId })) } }, select: { id: true } });
  laget.classes.push(created.id);
  return created.id;
}

const fanget = () => {
  const sent: CourseReminderSendInput[] = [];
  return { sent, sendImpl: async (input: CourseReminderSendInput): Promise<CourseReminderSendResult> => { sent.push(input); return { delivered: true, channel: "log" }; } };
};

/** Fristen og statusen personen har for kurset på de fire flatene. */
async function fireFlater(person: { userId: string; headers: Record<string, string> }, courseId: string) {
  const enrollments = await request(app).get("/api/courses/enrollments").set(person.headers);
  expect(enrollments.status).toBe(200);
  const row = (enrollments.body.enrollments as Array<{ courseId: string; dueAt: string | null; status: string; source: string }>).find((r) => r.courseId === courseId);
  const cohort = await request(app).get(`/api/cohort-status/course/${courseId}`).set(admin);
  expect(cohort.status).toBe(200);
  const capture = fanget();
  await runCourseReminderSchedule({ asOf: new Date(), sendImpl: capture.sendImpl });
  const reminder = capture.sent.find((s) => s.userId === person.userId && s.courseId === courseId) ?? null;
  const digest = await getWeeklyDigestContent({ userId: person.userId, roles: ["PARTICIPANT"], locale: "nb", now: new Date() });
  return {
    enrollment: row ?? null,
    cohortOverdue: cohort.body.counts?.OVERDUE ?? cohort.body.summary?.counts?.OVERDUE ?? null,
    reminderKind: reminder?.kind ?? null,
    digestOverdue: (digest?.overdue ?? []).some((c) => c.courseId === courseId),
  };
}

describe("#1192 2b: én frist på alle flater", () => {
  it("tildeling UTEN frist + klasse med passert frist: ingen frist noe sted (før: påminnelse og «Fristen har gått ut», Status ikke)", async () => {
    const p = await deltaker("tildelt-uten-frist");
    const courseId = await kurs();
    await prisma.courseEnrollment.create({ data: { userId: p.userId, courseId, source: "INDIVIDUAL", dueAt: null } });
    const classId = await klasse([p.userId]);
    await prisma.courseGroupAssignment.create({ data: { courseId, classId, dueAt: PASSERT } });

    const seen = await fireFlater(p, courseId);
    expect(seen.enrollment).toMatchObject({ dueAt: null, status: "ASSIGNED" });
    expect(seen.cohortOverdue).toBe(0);
    expect(seen.reminderKind).toBeNull();
    expect(seen.digestOverdue).toBe(false);
  });

  it("tildeling med frist LANGT FRAM + klasse med passert frist: tildelingens frist overalt (før: påminnelsen tok klassens)", async () => {
    const p = await deltaker("tildelt-langt-fram");
    const courseId = await kurs();
    await prisma.courseEnrollment.create({ data: { userId: p.userId, courseId, source: "INDIVIDUAL", dueAt: LANGT_FRAM } });
    const classId = await klasse([p.userId]);
    await prisma.courseGroupAssignment.create({ data: { courseId, classId, dueAt: PASSERT } });

    const seen = await fireFlater(p, courseId);
    expect(seen.enrollment).toMatchObject({ dueAt: LANGT_FRAM.toISOString(), status: "ASSIGNED" });
    expect(seen.cohortOverdue).toBe(0);
    expect(seen.reminderKind).toBeNull();
    expect(seen.digestOverdue).toBe(false);
  });

  it("SELF-påmelding + klasse med passert frist: klassens frist gjelder overalt (en SELF-påmelding er ikke en tildeling)", async () => {
    const p = await deltaker("self");
    const courseId = await kurs("OPEN");
    await prisma.courseEnrollment.create({ data: { userId: p.userId, courseId, source: "SELF", dueAt: null } });
    const classId = await klasse([p.userId]);
    await prisma.courseGroupAssignment.create({ data: { courseId, classId, dueAt: PASSERT } });

    const seen = await fireFlater(p, courseId);
    expect(seen.enrollment).toMatchObject({ source: "SELF", dueAt: PASSERT.toISOString(), status: "OVERDUE" });
    expect(seen.cohortOverdue).toBe(1);
    expect(seen.reminderKind).toBe("overdue");
    expect(seen.digestOverdue).toBe(true);
  });

  it("kontroll: bare klasse med passert frist gir forfalt på alle fire flater", async () => {
    const p = await deltaker("bare-klasse");
    const courseId = await kurs();
    const classId = await klasse([p.userId]);
    await prisma.courseGroupAssignment.create({ data: { courseId, classId, dueAt: PASSERT } });

    const seen = await fireFlater(p, courseId);
    expect(seen.enrollment).toMatchObject({ source: "CLASS", dueAt: PASSERT.toISOString(), status: "OVERDUE" });
    expect(seen.cohortOverdue).toBe(1);
    expect(seen.reminderKind).toBe("overdue");
    expect(seen.digestOverdue).toBe(true);
  });
});

describe("#1192 2a: dueSetAt skrives når fristen settes eller endres", () => {
  const classRow = (courseId: string, classId: string) => prisma.courseGroupAssignment.findFirstOrThrow({ where: { courseId, classId }, select: { dueAt: true, dueSetAt: true } });
  const enrollmentRow = (userId: string, courseId: string) => prisma.courseEnrollment.findFirstOrThrow({ where: { userId, courseId }, select: { dueAt: true, dueSetAt: true } });

  it("klassens kurs: ny med frist → satt; samme dato på nytt → urørt; ny dato → flyttet; uten frist → null", async () => {
    const courseId = await kurs();
    const created = await request(app).post("/api/admin/content/classes").set(admin).send({ name: tag("klasse via rute") });
    expect(created.status).toBe(201);
    const classId = created.body.class.id as string;
    laget.classes.push(classId);
    const assign = (dueAt: string | null) => request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId, ...(dueAt ? { dueAt } : {}) });

    expect((await assign("2030-01-01T00:00:00.000Z")).status).toBe(201);
    const first = await classRow(courseId, classId);
    expect(first.dueSetAt).not.toBeNull();

    await new Promise((r) => setTimeout(r, 15));
    expect((await assign("2030-01-01T00:00:00.000Z")).status).toBe(201);
    expect((await classRow(courseId, classId)).dueSetAt).toEqual(first.dueSetAt);

    await new Promise((r) => setTimeout(r, 15));
    expect((await assign("2030-02-01T00:00:00.000Z")).status).toBe(201);
    const moved = await classRow(courseId, classId);
    expect(moved.dueSetAt!.getTime()).toBeGreaterThan(first.dueSetAt!.getTime());

    expect((await assign(null)).status).toBe(201);
    expect(await classRow(courseId, classId)).toEqual({ dueAt: null, dueSetAt: null });

    // Klasseskjermens «Lagre frist» sender `dueAt: null` eksplisitt for en tom dato; det fjerner fristen likt.
    expect((await assign("2030-03-01T00:00:00.000Z")).status).toBe(201);
    const explicitNull = await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId, dueAt: null });
    expect(explicitNull.status).toBe(201);
    expect(await classRow(courseId, classId)).toEqual({ dueAt: null, dueSetAt: null });

    // Skjermen varsler for kurs i versjon 2 eller høyere: lista over klassens kurs har kursets hovedversjon.
    await prisma.course.update({ where: { id: courseId }, data: { versionMajor: 2 } });
    const listed = await request(app).get(`/api/admin/content/classes/${classId}/courses`).set(admin);
    expect(listed.status).toBe(200);
    expect(listed.body.courses.find((c: { courseId: string }) => c.courseId === courseId)).toMatchObject({ courseVersionMajor: 2 });
  });

  it("individuell tildeling: ny med frist → satt; samme dato på nytt → urørt; ny dato → flyttet; uten frist → null", async () => {
    const p = await deltaker("tildeles");
    const courseId = await kurs();
    const assign = (dueAt: string | null) => request(app).post(`/api/admin/content/courses/${courseId}/enrollments`).set(admin).send({ userIds: [p.userId], ...(dueAt ? { dueAt } : {}) });

    expect((await assign("2030-01-01T00:00:00.000Z")).status).toBe(201);
    const first = await enrollmentRow(p.userId, courseId);
    expect(first.dueSetAt).not.toBeNull();

    await new Promise((r) => setTimeout(r, 15));
    expect((await assign("2030-01-01T00:00:00.000Z")).status).toBe(201);
    expect((await enrollmentRow(p.userId, courseId)).dueSetAt).toEqual(first.dueSetAt);

    await new Promise((r) => setTimeout(r, 15));
    expect((await assign("2030-02-01T00:00:00.000Z")).status).toBe(201);
    expect((await enrollmentRow(p.userId, courseId)).dueSetAt!.getTime()).toBeGreaterThan(first.dueSetAt!.getTime());

    expect((await assign(null)).status).toBe(201);
    expect(await enrollmentRow(p.userId, courseId)).toEqual({ dueAt: null, dueSetAt: null });
  });
});
