import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #498 — teacher/SMO cohort-status dashboard API. Verifies the enrollment-status aggregate over a
// course's effective audience (individual enrolments + class-assigned members), against native Postgres.

const adminHeaders = {
  "x-user-id": "cohort-admin-ext",
  "x-user-email": "cohort-admin@company.com",
  "x-user-name": "Cohort Admin",
  "x-user-roles": "ADMINISTRATOR",
};

describe("Cohort-status dashboard API (#498)", () => {
  const stamp = `${Date.now()}-${Math.round(performance.now())}`;
  const userIds: string[] = [];
  let courseId = "";
  let classId = "";

  async function makeUser(tag: string): Promise<string> {
    const user = await prisma.user.create({
      data: { externalId: `co-${tag}-${stamp}`, name: `CO ${tag}`, email: `co-${tag}-${stamp}@x.test` },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  }

  afterAll(async () => {
    await prisma.courseGroupAssignment.deleteMany({ where: { courseId } });
    await prisma.classMember.deleteMany({ where: { classId } });
    if (classId) await prisma.class.deleteMany({ where: { id: classId } });
    await prisma.courseCompletion.deleteMany({ where: { courseId } });
    await prisma.courseEnrollment.deleteMany({ where: { courseId } });
    if (courseId) await prisma.course.deleteMany({ where: { id: courseId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("counts enrollment status over individual + class-assigned audience, with a per-class breakdown", async () => {
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ nb: "Kohortkurs", "en-GB": "Cohort course" }), publishedAt: new Date() },
      select: { id: true },
    });
    courseId = course.id;

    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const past = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const assigned = await makeUser("assigned"); // individual, due in future, not started → ASSIGNED
    const overdue = await makeUser("overdue"); // individual, due in past, not completed → OVERDUE
    const completed = await makeUser("completed"); // individual, has completion → COMPLETED
    const classMember = await makeUser("classmember"); // class-assigned, no due → ASSIGNED

    await prisma.courseEnrollment.create({ data: { userId: assigned, courseId, source: "INDIVIDUAL", dueAt: future } });
    await prisma.courseEnrollment.create({ data: { userId: overdue, courseId, source: "INDIVIDUAL", dueAt: past } });
    await prisma.courseEnrollment.create({ data: { userId: completed, courseId, source: "INDIVIDUAL", dueAt: future } });
    await prisma.courseCompletion.create({ data: { userId: completed, courseId, moduleSnapshotJson: "[]" } });

    const klass = await prisma.class.create({
      data: { name: `Kull ${stamp}`, kind: "MANUAL", members: { create: [{ userId: classMember }] } },
      select: { id: true },
    });
    classId = klass.id;
    await prisma.courseGroupAssignment.create({ data: { courseId, classId, dueAt: null } });

    const res = await request(app).get(`/api/cohort-status/course/${courseId}`).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.courseId).toBe(courseId);
    expect(res.body.total).toBe(4);
    expect(res.body.counts).toEqual({ ASSIGNED: 2, IN_PROGRESS: 0, OVERDUE: 1, COMPLETED: 1 });

    // Per-class breakdown: the class member (ASSIGNED) shows under the class bucket.
    const bucket = (res.body.byClass as Array<{ classId: string; total: number; counts: Record<string, number> }>)
      .find((b) => b.classId === classId);
    expect(bucket).toBeTruthy();
    expect(bucket?.total).toBe(1);
    expect(bucket?.counts.ASSIGNED).toBe(1);
  });

  it("lists published courses for the picker and 404s an unknown course", async () => {
    const list = await request(app).get("/api/cohort-status/courses").set(adminHeaders);
    expect(list.status).toBe(200);
    const row = (list.body.courses as Array<{ id: string; title: string }>).find((c) => c.id === courseId);
    expect(row?.title).toMatch(/Kohortkurs|Cohort course/); // localized to the request locale

    const missing = await request(app).get("/api/cohort-status/course/does-not-exist").set(adminHeaders);
    expect(missing.status).toBe(404);
  });

  it("forbids a plain PARTICIPANT (not in the dashboard roles)", async () => {
    const res = await request(app)
      .get(`/api/cohort-status/course/${courseId}`)
      .set({ "x-user-id": `co-p-${stamp}`, "x-user-email": `co-p-${stamp}@x.test`, "x-user-name": "P", "x-user-roles": "PARTICIPANT" });
    expect(res.status).toBe(403);
  });
});
