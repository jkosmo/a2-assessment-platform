import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import {
  runCourseReminderSchedule,
  type CourseReminderSendInput,
  type CourseReminderSendResult,
} from "../src/modules/course/courseReminderService.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";

// #497 — course due-date reminders. Exercises the orchestrator against native Postgres with an
// injected capturing sendImpl (no real email regardless of channel). Verifies: due-soon fires on
// offset match, overdue fires once, no send for completed / revoked / inactive / no-dueAt, and that
// a same-asOf re-run is idempotent (audit-based dedup).

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

describe("Course due-date reminders (#497)", () => {
  const stamp = `${Date.now()}-${Math.round(performance.now())}`;
  const createdUserIds: string[] = [];
  let courseId = "";

  async function makeUser(tag: string, opts: { activeStatus?: boolean } = {}): Promise<string> {
    const user = await prisma.user.create({
      data: {
        externalId: `cr-${tag}-${stamp}`,
        name: `CR ${tag}`,
        email: `cr-${tag}-${stamp}@x.test`,
        activeStatus: opts.activeStatus ?? true,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function enrol(userId: string, dueAt: Date | null, opts: { revoked?: boolean } = {}) {
    await prisma.courseEnrollment.create({
      data: {
        userId,
        courseId,
        source: "INDIVIDUAL",
        dueAt,
        revokedAt: opts.revoked ? new Date() : null,
      },
    });
  }

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { entityType: auditEntityTypes.course, entityId: courseId } });
    await prisma.courseCompletion.deleteMany({ where: { courseId } });
    await prisma.courseEnrollment.deleteMany({ where: { courseId } });
    if (courseId) await prisma.course.delete({ where: { id: courseId } });
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("sends due-soon + overdue to the right participants and is idempotent", async () => {
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify({ "en-GB": "Reminder course", nb: "Påminnelseskurs", nn: "Påminningskurs" }),
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    courseId = course.id;

    const dueSoon7 = await makeUser("due7");
    const dueSoon1 = await makeUser("due1");
    const overdue = await makeUser("overdue");
    const notYet = await makeUser("notyet");
    const completed = await makeUser("completed");
    const inactive = await makeUser("inactive", { activeStatus: false });
    const revoked = await makeUser("revoked");
    const noDue = await makeUser("nodue");

    await enrol(dueSoon7, daysFromT(7));
    await enrol(dueSoon1, daysFromT(1));
    await enrol(overdue, daysFromT(-3));
    await enrol(notYet, daysFromT(3)); // no offset match, not overdue
    await enrol(completed, daysFromT(7));
    await enrol(inactive, daysFromT(-3));
    await enrol(revoked, daysFromT(7), { revoked: true });
    await enrol(noDue, null);

    // completed user has a CourseCompletion → deriveStatus === COMPLETED → skipped.
    await prisma.courseCompletion.create({
      data: { userId: completed, courseId, moduleSnapshotJson: "[]" },
    });

    const first = makeCapture();
    const summary = await runCourseReminderSchedule({ asOf: T, sendImpl: first.sendImpl });

    const sentTo = new Map(first.sent.map((s) => [s.userId, s]));
    expect(new Set(sentTo.keys())).toEqual(new Set([dueSoon7, dueSoon1, overdue]));

    expect(sentTo.get(dueSoon7)?.kind).toBe("due_soon");
    expect(sentTo.get(dueSoon7)?.daysBefore).toBe(7);
    expect(sentTo.get(dueSoon1)?.kind).toBe("due_soon");
    expect(sentTo.get(dueSoon1)?.daysBefore).toBe(1);
    expect(sentTo.get(overdue)?.kind).toBe("overdue");
    expect(sentTo.get(overdue)?.daysBefore).toBeUndefined();

    // Localized course title resolved (org-default nb).
    expect(sentTo.get(dueSoon7)?.courseTitle).toBe("Påminnelseskurs");

    expect(summary.sent).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.skippedCompleted).toBe(1); // completed
    expect(summary.skippedInactive).toBe(1); // inactive

    // Audit rows persisted with correct metadata.
    const auditRows = await prisma.auditEvent.findMany({
      where: {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: auditActions.course.reminderSent,
      },
    });
    expect(auditRows).toHaveLength(3);

    // Idempotent: a same-asOf re-run sends nothing new (audit-based dedup).
    const second = makeCapture();
    const summary2 = await runCourseReminderSchedule({ asOf: T, sendImpl: second.sendImpl });
    expect(second.sent).toHaveLength(0);
    expect(summary2.sent).toBe(0);
    expect(summary2.skippedAlreadySent).toBe(3);
  });
});
