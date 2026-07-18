import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import {
  runCourseReminderSchedule,
  type CourseReminderSendInput,
  type CourseReminderSendResult,
} from "../src/modules/course/courseReminderService.js";
import { SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "../src/modules/course/classRepository.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";

// #497 — course due-date reminders. Runs the orchestrator against native Postgres with an injected
// capturing sendImpl (no real email). Covers both sources: individual CourseEnrollment.dueAt (v1) and
// class-assigned CourseGroupAssignment.dueAt (fase 2 — MANUAL + system "Alle deltakere"; ENTRA skipped).
// Assertions are filtered to each test's own user IDs so they are robust against unrelated rows in the
// shared test DB; each test cleans up in afterEach.

const T = new Date("2026-03-01T12:00:00.000Z"); // fixed "asOf"

function daysFromT(days: number): Date {
  const d = new Date(T);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function makeCapture() {
  const sent: CourseReminderSendInput[] = [];
  const sendImpl = async (input: CourseReminderSendInput): Promise<CourseReminderSendResult> => {
    sent.push(input);
    return { delivered: true, channel: "log" };
  };
  return { sent, sendImpl };
}

// Only the sends addressed to user IDs this test created — ignores unrelated shared-DB rows.
function ownedSends(sent: CourseReminderSendInput[], ownedUserIds: string[]) {
  const owned = new Set(ownedUserIds);
  return new Map(sent.filter((s) => owned.has(s.userId)).map((s) => [s.userId, s]));
}

describe("Course due-date reminders (#497)", () => {
  const stamp = `${Date.now()}-${Math.round(performance.now())}`;
  let seq = 0;
  const courseIds: string[] = [];
  const userIds: string[] = [];
  const classIds: string[] = [];

  async function makeCourse(): Promise<string> {
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify({ "en-GB": "Reminder course", nb: "Påminnelseskurs", nn: "Påminningskurs" }),
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    courseIds.push(course.id);
    return course.id;
  }

  async function makeUser(tag: string, opts: { activeStatus?: boolean; participant?: boolean } = {}): Promise<string> {
    seq += 1;
    const user = await prisma.user.create({
      data: {
        externalId: `cr-${tag}-${stamp}-${seq}`,
        name: `CR ${tag}`,
        email: `cr-${tag}-${stamp}-${seq}@x.test`,
        activeStatus: opts.activeStatus ?? true,
        ...(opts.participant
          ? { roleAssignments: { create: { appRole: "PARTICIPANT", validFrom: new Date("2020-01-01T00:00:00.000Z") } } }
          : {}),
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function enrol(userId: string, courseId: string, dueAt: Date | null, opts: { revoked?: boolean } = {}) {
    await prisma.courseEnrollment.create({
      data: { userId, courseId, source: "INDIVIDUAL", dueAt, revokedAt: opts.revoked ? new Date() : null },
    });
  }

  async function makeClass(kind: "MANUAL" | "ENTRA", memberUserIds: string[]): Promise<string> {
    seq += 1;
    const cls = await prisma.class.create({
      data: {
        name: `CR class ${stamp}-${seq}`,
        kind,
        ...(kind === "ENTRA" ? { entraGroupId: `grp-${stamp}-${seq}` } : {}),
        members: { create: memberUserIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    classIds.push(cls.id);
    return cls.id;
  }

  async function assignClass(courseId: string, classId: string, dueAt: Date | null) {
    await prisma.courseGroupAssignment.create({ data: { courseId, classId, dueAt } });
  }

  afterEach(async () => {
    await prisma.auditEvent.deleteMany({
      where: { entityType: auditEntityTypes.course, entityId: { in: courseIds } },
    });
    await prisma.courseCompletion.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseEnrollment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseGroupAssignment.deleteMany({
      where: { OR: [{ courseId: { in: courseIds } }, { classId: { in: classIds } }] },
    });
    await prisma.classMember.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.roleAssignment.deleteMany({ where: { userId: { in: userIds } } });
    if (classIds.length) await prisma.class.deleteMany({ where: { id: { in: classIds } } });
    if (courseIds.length) await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    courseIds.length = 0;
    userIds.length = 0;
    classIds.length = 0;
  });

  it("individual: sends due-soon + overdue to the right participants and is idempotent", async () => {
    const courseId = await makeCourse();
    const dueSoon7 = await makeUser("due7");
    const dueSoon1 = await makeUser("due1");
    const overdue = await makeUser("overdue");
    const notYet = await makeUser("notyet");
    const completed = await makeUser("completed");
    const inactive = await makeUser("inactive", { activeStatus: false });
    const revoked = await makeUser("revoked");
    const noDue = await makeUser("nodue");

    await enrol(dueSoon7, courseId, daysFromT(7));
    await enrol(dueSoon1, courseId, daysFromT(1));
    await enrol(overdue, courseId, daysFromT(-3));
    await enrol(notYet, courseId, daysFromT(3)); // no offset match, not overdue
    await enrol(completed, courseId, daysFromT(7));
    await enrol(inactive, courseId, daysFromT(-3));
    await enrol(revoked, courseId, daysFromT(7), { revoked: true });
    await enrol(noDue, courseId, null);
    await prisma.courseCompletion.create({ data: { userId: completed, courseId, moduleSnapshotJson: "[]" } });

    const owned = [dueSoon7, dueSoon1, overdue, notYet, completed, inactive, revoked, noDue];
    const first = makeCapture();
    await runCourseReminderSchedule({ asOf: T, sendImpl: first.sendImpl });
    const sentTo = ownedSends(first.sent, owned);

    expect(new Set(sentTo.keys())).toEqual(new Set([dueSoon7, dueSoon1, overdue]));
    expect(sentTo.get(dueSoon7)?.kind).toBe("due_soon");
    expect(sentTo.get(dueSoon7)?.daysBefore).toBe(7);
    expect(sentTo.get(dueSoon7)?.courseTitle).toBe("Påminnelseskurs"); // localized (nb)
    expect(sentTo.get(dueSoon1)?.daysBefore).toBe(1);
    expect(sentTo.get(overdue)?.kind).toBe("overdue");
    expect(sentTo.get(overdue)?.daysBefore).toBeUndefined();

    // Idempotent: same-asOf re-run sends nothing new for our users (audit dedup).
    const second = makeCapture();
    await runCourseReminderSchedule({ asOf: T, sendImpl: second.sendImpl });
    expect(ownedSends(second.sent, owned).size).toBe(0);

    const auditRows = await prisma.auditEvent.findMany({
      where: { entityType: auditEntityTypes.course, entityId: courseId, action: auditActions.course.reminderSent },
    });
    expect(auditRows).toHaveLength(3);
  });

  it("class: expands MANUAL membership, applies precedence (individual > class, earliest class wins), skips ENTRA", async () => {
    const courseId = await makeCourse();

    const onlyClass = await makeUser("onlyclass"); // member of a class due in 7 days
    const bothIndOverdue = await makeUser("both"); // individual overdue + class due-soon → individual wins
    const twoClasses = await makeUser("twoclass"); // in two classes (due 7 and due 1) → earliest (1) wins
    const entraOnly = await makeUser("entra"); // only in an ENTRA class → skipped

    const m1 = await makeClass("MANUAL", [onlyClass, bothIndOverdue, twoClasses]);
    const m2 = await makeClass("MANUAL", [twoClasses]);
    const entra = await makeClass("ENTRA", [entraOnly]);

    await assignClass(courseId, m1, daysFromT(7));
    await assignClass(courseId, m2, daysFromT(1));
    await assignClass(courseId, entra, daysFromT(7));
    await enrol(bothIndOverdue, courseId, daysFromT(-3)); // individual overdue

    const owned = [onlyClass, bothIndOverdue, twoClasses, entraOnly];
    const cap = makeCapture();
    const summary = await runCourseReminderSchedule({ asOf: T, sendImpl: cap.sendImpl });
    const sentTo = ownedSends(cap.sent, owned);

    expect(new Set(sentTo.keys())).toEqual(new Set([onlyClass, bothIndOverdue, twoClasses]));
    expect(sentTo.get(onlyClass)?.kind).toBe("due_soon");
    expect(sentTo.get(onlyClass)?.daysBefore).toBe(7);
    // individual due date (overdue) wins over the class due-soon:
    expect(sentTo.get(bothIndOverdue)?.kind).toBe("overdue");
    // earliest of the two class due dates (1 day) wins → single reminder:
    expect(sentTo.get(twoClasses)?.kind).toBe("due_soon");
    expect(sentTo.get(twoClasses)?.daysBefore).toBe(1);
    // ENTRA class is not resolvable in a background job → skipped, no send:
    expect(sentTo.has(entraOnly)).toBe(false);
    expect(summary.skippedEntraClass).toBeGreaterThanOrEqual(1);
  });

  it("class: the system 'Alle deltakere' class reaches active participants", async () => {
    const courseId = await makeCourse();
    const participant = await makeUser("sysparticipant", { participant: true });

    await assignClass(courseId, SYSTEM_ALL_PARTICIPANTS_CLASS_ID, daysFromT(1));

    const cap = makeCapture();
    await runCourseReminderSchedule({ asOf: T, sendImpl: cap.sendImpl });
    const sentTo = ownedSends(cap.sent, [participant]);

    expect(sentTo.get(participant)?.kind).toBe("due_soon");
    expect(sentTo.get(participant)?.daysBefore).toBe(1);
  });
});
