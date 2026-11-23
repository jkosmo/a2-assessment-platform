import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import {
  COURSE_NOTICE_STATUS,
  deliverCourseMajorVersionNotice,
  runCourseMajorEmailSchedule,
  type CourseMajorVersionSend,
} from "../src/modules/course/courseMajorVersionEmail.js";
import { OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";

// #1196: e-posten om ny hovedversjon gikk til alle med kursbevis, også dem som ikke lenger ser kurset (fjernet fra klassen etter at
// de fullførte et begrenset kurs). Lenken ga 404. Nå avgjøres synligheten med samme regel som «Mine kurs» og de andre e-postene,
// både i jobben og rett før sendingen.

const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const stamp = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const laget: { courses: string[]; users: string[]; classes: string[] } = { courses: [], users: [], classes: [] };

afterAll(async () => {
  await prisma.courseVersionNotice.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.outboxEvent.deleteMany({ where: { payloadJson: { contains: "noticeId" }, type: OUTBOX_EVENT_TYPES.courseMajorVersionNotification } });
  await prisma.courseEnrollment.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.courseCompletion.deleteMany({ where: { courseId: { in: laget.courses } } });
  await prisma.course.deleteMany({ where: { id: { in: laget.courses } } });
  await prisma.class.deleteMany({ where: { id: { in: laget.classes } } });
  await prisma.user.deleteMany({ where: { id: { in: laget.users } } });
  await prisma.$disconnect();
});

async function bruker(tag: string) {
  const s = stamp();
  const u = await prisma.user.create({ data: { externalId: `v1196-${tag}-${s}`, email: `v1196.${tag}.${s}@company.com`, name: tag }, select: { id: true } });
  laget.users.push(u.id);
  return u.id;
}

/** Et publisert kurs på hovedversjon 2, med en ventende rad for hver av personene. */
async function kursMedRader(policy: "OPEN" | "RESTRICTED", userIds: string[]) {
  const course = await prisma.course.create({
    data: { title: L(`1196 ${policy} ${stamp()}`), slug: `v1196-${stamp()}`, publishedAt: new Date(), enrollmentPolicy: policy, versionMajor: 2 },
    select: { id: true },
  });
  laget.courses.push(course.id);
  await prisma.courseVersionNotice.createMany({ data: userIds.map((userId) => ({ courseId: course.id, userId, versionMajor: 2 })) });
  return course.id;
}

const status = async (courseId: string, userId: string) =>
  prisma.courseVersionNotice.findFirstOrThrow({ where: { courseId, userId }, select: { id: true, status: true, reason: true } });

describe("#1196 — e-posten om ny hovedversjon går bare til den som ser kurset", () => {
  it("jobben: begrenset kurs — den som er tildelt, legges i køen; den som ikke ser kurset, hoppes over med «not_visible»", async () => {
    const tildelt = await bruker("tildelt");
    const fjernet = await bruker("fjernet");
    const courseId = await kursMedRader("RESTRICTED", [tildelt, fjernet]);
    await prisma.courseEnrollment.create({ data: { userId: tildelt, courseId, source: "INDIVIDUAL" } });
    // Fjernet: tildelingen er trukket tilbake.
    await prisma.courseEnrollment.create({ data: { userId: fjernet, courseId, source: "INDIVIDUAL", revokedAt: new Date() } });

    await runCourseMajorEmailSchedule({ onlyCourseIds: [courseId] });

    expect(await status(courseId, tildelt)).toMatchObject({ status: COURSE_NOTICE_STATUS.queued, reason: null });
    expect(await status(courseId, fjernet)).toMatchObject({ status: COURSE_NOTICE_STATUS.skipped, reason: "not_visible" });
  });

  // QA 2026-11-23: saken er klassen. Testen over trekker tilbake en individuell tildeling; denne fjerner personen fra klassen.
  it("jobben: begrenset kurs via klasse — den som står i klassen, legges i køen; den som er fjernet fra klassen, hoppes over", async () => {
    const iKlassen = await bruker("klasse-inne");
    const fjernetFraKlassen = await bruker("klasse-ute");
    const courseId = await kursMedRader("RESTRICTED", [iKlassen, fjernetFraKlassen]);
    const klasse = await prisma.class.create({ data: { name: `1196 klasse ${stamp()}` }, select: { id: true } });
    laget.classes.push(klasse.id);
    await prisma.courseGroupAssignment.create({ data: { courseId, classId: klasse.id } });
    await prisma.classMember.create({ data: { classId: klasse.id, userId: iKlassen } });
    // fjernetFraKlassen sto i klassen da hen fullførte, og er tatt ut siden: ingen medlemsrad.

    await runCourseMajorEmailSchedule({ onlyCourseIds: [courseId] });

    expect((await status(courseId, iKlassen)).status).toBe(COURSE_NOTICE_STATUS.queued);
    expect(await status(courseId, fjernetFraKlassen)).toMatchObject({ status: COURSE_NOTICE_STATUS.skipped, reason: "not_visible" });
  });

  it("kontroll: åpent kurs — alle ser det, og alle legges i køen", async () => {
    const a = await bruker("aapen-a");
    const b = await bruker("aapen-b");
    const courseId = await kursMedRader("OPEN", [a, b]);
    await runCourseMajorEmailSchedule({ onlyCourseIds: [courseId] });
    expect((await status(courseId, a)).status).toBe(COURSE_NOTICE_STATUS.queued);
    expect((await status(courseId, b)).status).toBe(COURSE_NOTICE_STATUS.queued);
  });

  it("behandleren: mister personen tilgangen mens raden står i køen, sendes ingenting", async () => {
    const person = await bruker("mister");
    const courseId = await kursMedRader("RESTRICTED", [person]);
    const enrollment = await prisma.courseEnrollment.create({ data: { userId: person, courseId, source: "INDIVIDUAL" }, select: { id: true } });
    await runCourseMajorEmailSchedule({ onlyCourseIds: [courseId] });
    const rad = await status(courseId, person);
    expect(rad.status).toBe(COURSE_NOTICE_STATUS.queued);

    await prisma.courseEnrollment.update({ where: { id: enrollment.id }, data: { revokedAt: new Date() } });
    const send = vi.fn() as unknown as CourseMajorVersionSend;
    await deliverCourseMajorVersionNotice(rad.id, { send });

    expect(send).not.toHaveBeenCalled();
    expect(await status(courseId, person)).toMatchObject({ status: COURSE_NOTICE_STATUS.skipped, reason: "not_visible" });
  });
});
