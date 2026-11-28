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

// #1192 punkt 2 (produkteier 2026-11-24), skive 2c–2e: en ny frist etter en ny hovedversjon gjør kurset utestående igjen for den
// som bare har kursbevis for en eldre hovedversjon. Uten en slik frist står kurset som fullført, og ingen får påminnelse.
// Samme svar på alle flater: /enrollments, Status, påminnelsene, den ukentlige e-posten og kursrapporten (sammendrag og detalj).
//
// Personene, alle med en frist som har gått ut:
//   A: bevis for v1, individuell frist satt ETTER v2         → utestående (forfalt, påminnelse, «Må ta ny versjon»)
//   B: bevis for v1, individuell frist satt FØR feltet fantes → fullført (svar B: eksisterende frister er gamle)
//   C: bevis for v2, frist satt etter v2                      → fullført (kontroll: beviset for nåværende versjon)
//   D: bevis for v1, KLASSEFRIST satt etter v2                → utestående (samme regel gjennom klassen)

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `nyfrist ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const admin = { "x-user-id": `nyfrist-admin-${RUN}`, "x-user-email": `nyfrist.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
const DAG = 24 * 3600 * 1000;
const V1 = new Date(Date.now() - 60 * DAG);
const V2 = new Date(Date.now() - 5 * DAG);
const PASSERT = new Date(Date.now() - 2 * DAG);

const laget = { courses: [] as string[], users: [] as string[], classes: [] as string[] };
afterAll(async () => {
  await prisma.courseEnrollment.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.courseGroupAssignment.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.courseCompletion.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.courseVersion.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.course.deleteMany({ where: { id: { in: laget.courses } } });
  await prisma.class.deleteMany({ where: { id: { in: laget.classes } } });
  await prisma.user.deleteMany({ where: { id: { in: laget.users } } });
  await prisma.$disconnect();
});

async function deltaker(name: string) {
  const externalId = `nyfrist-${name}-${RUN}-${seq++}`;
  const user = await prisma.user.create({
    data: { externalId, name, email: `${externalId}@x.test`, roleAssignments: { create: { appRole: "PARTICIPANT", validFrom: new Date("2020-01-01T00:00:00.000Z") } } },
    select: { id: true },
  });
  laget.users.push(user.id);
  return { userId: user.id, headers: { "x-user-id": externalId, "x-user-email": `${externalId}@x.test`, "x-user-name": name, "x-user-roles": "PARTICIPANT", "x-locale": "nb" } };
}

/** Et kurs på hovedversjon 2 (publisert V2), med én seksjon ingen har lest. Begge hovedversjonene har sin `CourseVersion`. */
async function kursPaaV2() {
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const version = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  const course = await prisma.course.create({
    data: {
      title: L(tag("kurs")),
      publishedAt: V1,
      enrollmentPolicy: "RESTRICTED",
      versionMajor: 2,
      versionMinor: 0,
      items: { create: [{ itemType: "SECTION", sectionId: section.id, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  laget.courses.push(course.id);
  await prisma.courseVersion.createMany({
    data: [
      { courseId: course.id, versionMajor: 1, publishedAt: V1, sectionVersionsJson: "[]" },
      { courseId: course.id, versionMajor: 2, publishedAt: V2, sectionVersionsJson: "[]" },
    ],
  });
  return course.id;
}

const bevis = (userId: string, courseId: string, versionMajor: number) =>
  prisma.courseCompletion.create({ data: { userId, courseId, versionMajor, versionMinor: 0, moduleSnapshotJson: "[]", completedAt: new Date(V1.getTime() + DAG) } });

describe("#1192 2c–2e: ny frist etter ny hovedversjon", async () => {
  const courseId = await kursPaaV2();
  const A = await deltaker("A");
  const B = await deltaker("B");
  const C = await deltaker("C");
  const D = await deltaker("D");
  const etterV2 = new Date();
  await bevis(A.userId, courseId, 1);
  await bevis(B.userId, courseId, 1);
  await bevis(C.userId, courseId, 2);
  await bevis(D.userId, courseId, 1);
  await prisma.courseEnrollment.createMany({
    data: [
      { userId: A.userId, courseId, source: "INDIVIDUAL", dueAt: PASSERT, dueSetAt: etterV2 },
      { userId: B.userId, courseId, source: "INDIVIDUAL", dueAt: PASSERT, dueSetAt: null },
      { userId: C.userId, courseId, source: "INDIVIDUAL", dueAt: PASSERT, dueSetAt: etterV2 },
    ],
  });
  const klasse = await prisma.class.create({ data: { name: tag("klasse"), members: { create: [{ userId: D.userId }] } }, select: { id: true } });
  laget.classes.push(klasse.id);
  await prisma.courseGroupAssignment.create({ data: { courseId, classId: klasse.id, dueAt: PASSERT, dueSetAt: etterV2 } });

  it("/enrollments: A og D er forfalt, B og C er fullført", async () => {
    const status = async (p: { headers: Record<string, string> }) => {
      const res = await request(app).get("/api/courses/enrollments").set(p.headers);
      expect(res.status).toBe(200);
      return (res.body.enrollments as Array<{ courseId: string; status: string }>).find((r) => r.courseId === courseId)?.status;
    };
    expect({ A: await status(A), B: await status(B), C: await status(C), D: await status(D) }).toEqual({ A: "OVERDUE", B: "COMPLETED", C: "COMPLETED", D: "OVERDUE" });
  });

  it("Status: to fullført, to forfalt", async () => {
    const res = await request(app).get(`/api/cohort-status/course/${courseId}`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ COMPLETED: 2, OVERDUE: 2 });
  });

  it("påminnelsene: A og D får «forfalt», B og C ingenting", async () => {
    const sent: CourseReminderSendInput[] = [];
    const sendImpl = async (input: CourseReminderSendInput): Promise<CourseReminderSendResult> => { sent.push(input); return { delivered: true, channel: "log" }; };
    await runCourseReminderSchedule({ asOf: new Date(), sendImpl });
    const mine = sent.filter((s) => s.courseId === courseId).map((s) => `${s.userId}:${s.kind}`).sort();
    expect(mine).toEqual([`${A.userId}:overdue`, `${D.userId}:overdue`].sort());
  });

  it("den ukentlige e-posten: kurset står under «Fristen har gått ut» for A, og ikke i det hele tatt for B", async () => {
    const forA = await getWeeklyDigestContent({ userId: A.userId, roles: ["PARTICIPANT"], locale: "nb", now: new Date() });
    expect((forA?.overdue ?? []).some((c) => c.courseId === courseId)).toBe(true);
    const forB = await getWeeklyDigestContent({ userId: B.userId, roles: ["PARTICIPANT"], locale: "nb", now: new Date() });
    const alleB = [...(forB?.overdue ?? []), ...(forB?.dueSoon ?? []), ...(forB?.inProgress ?? []), ...(forB?.notStarted ?? [])];
    expect(alleB.some((c) => c.courseId === courseId)).toBe(false);
  });

  it("kursrapporten: «Må ta ny versjon» bare for A og D; sammendraget teller B og C som fullført, som detaljen", async () => {
    const detail = await request(app).get("/api/reports/courses/details").query({ selectedCourseId: courseId }).set(admin);
    expect(detail.status).toBe(200);
    const rows = detail.body.rows as Array<{ participantId: string; status: string }>;
    const statusOf = (id: string) => rows.find((r) => r.participantId === id)?.status;
    expect({ A: statusOf(A.userId), B: statusOf(B.userId), C: statusOf(C.userId), D: statusOf(D.userId) }).toEqual({
      A: "NEEDS_NEW_VERSION",
      B: "COMPLETED",
      C: "COMPLETED",
      D: "NEEDS_NEW_VERSION",
    });
    expect(detail.body.totals).toMatchObject({ completed: 2, needsNewVersion: 2 });

    const summary = await request(app).get("/api/reports/courses").query({ selectedCourseId: courseId }).set(admin);
    expect(summary.status).toBe(200);
    expect(summary.body.rows.find((r: { courseId: string }) => r.courseId === courseId)).toMatchObject({ completedParticipants: 2, enrolledParticipants: 4 });
  });
});
