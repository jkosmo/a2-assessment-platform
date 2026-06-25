import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #496/EN-2 — enrollment backend API: assign/revoke, my-enrollments, per-course list, self-enrol,
// and the RESTRICTED-course visibility filter on GET /api/courses.

const adminHeaders = {
  "x-user-id": "enroll-admin-ext",
  "x-user-email": "enroll-admin@company.com",
  "x-user-name": "Enroll Admin",
  "x-user-roles": "ADMINISTRATOR",
};

function participantHeaders(externalId: string) {
  return {
    "x-user-id": externalId,
    "x-user-email": `${externalId}@company.com`,
    "x-user-name": externalId,
    "x-user-roles": "PARTICIPANT",
  };
}

async function createPublishedCourse(policy: "OPEN" | "RESTRICTED"): Promise<string> {
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": `Enroll course ${Date.now()}-${Math.round(performance.now())}` }),
      enrollmentPolicy: policy,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  return course.id;
}

describe("Course enrollment API (#496/EN-2)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("assigns, lists, shows to the participant, and revokes an enrollment", async () => {
    const courseId = await createPublishedCourse("OPEN");
    const learner = await prisma.user.create({
      data: { externalId: `en-learner-${Date.now()}`, name: "Learner One", email: `en-learner-${Date.now()}@x.test`, department: "Sales" },
      select: { id: true, externalId: true },
    });

    // Admin assigns the participant with a past due date → derived status OVERDUE.
    const assign = await request(app)
      .post(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(adminHeaders)
      .send({ userIds: [learner.id], dueAt: "2020-01-01T00:00:00.000Z" });
    expect(assign.status).toBe(201);
    expect(assign.body.source).toBe("INDIVIDUAL");
    expect(assign.body.assignedUserIds).toContain(learner.id);

    // Admin per-course list shows the participant with derived status.
    const adminList = await request(app)
      .get(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(adminHeaders);
    expect(adminList.status).toBe(200);
    const row = (adminList.body.enrollments as Array<{ userId: string; status: string; department: string | null }>)
      .find((e) => e.userId === learner.id);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("OVERDUE");
    expect(row?.department).toBe("Sales");

    // Participant sees the course among their own enrollments.
    const mine = await request(app)
      .get("/api/courses/enrollments")
      .set(participantHeaders(learner.externalId));
    expect(mine.status).toBe(200);
    const mineRow = (mine.body.enrollments as Array<{ courseId: string; status: string }>)
      .find((e) => e.courseId === courseId);
    expect(mineRow?.status).toBe("OVERDUE");

    // Revoke → participant no longer enrolled.
    const revoke = await request(app)
      .delete(`/api/admin/content/courses/${courseId}/enrollments/${learner.id}`)
      .set(adminHeaders);
    expect(revoke.status).toBe(204);
    const afterRevoke = await request(app)
      .get("/api/courses/enrollments")
      .set(participantHeaders(learner.externalId));
    expect((afterRevoke.body.enrollments as Array<{ courseId: string }>).some((e) => e.courseId === courseId)).toBe(false);

    await prisma.courseEnrollment.deleteMany({ where: { courseId } });
    await prisma.course.delete({ where: { id: courseId } });
    await prisma.user.delete({ where: { id: learner.id } });
  });

  it("hides RESTRICTED courses from non-enrolled users and shows them once enrolled", async () => {
    const restrictedId = await createPublishedCourse("RESTRICTED");
    const openId = await createPublishedCourse("OPEN");
    const learner = await prisma.user.create({
      data: { externalId: `en-vis-${Date.now()}`, name: "Vis Learner", email: `en-vis-${Date.now()}@x.test` },
      select: { id: true, externalId: true },
    });
    const headers = participantHeaders(learner.externalId);

    const before = await request(app).get("/api/courses").set(headers);
    const beforeIds = (before.body.courses as Array<{ id: string }>).map((c) => c.id);
    expect(beforeIds).toContain(openId); // OPEN visible to everyone
    expect(beforeIds).not.toContain(restrictedId); // RESTRICTED hidden when not enrolled

    await request(app)
      .post(`/api/admin/content/courses/${restrictedId}/enrollments`)
      .set(adminHeaders)
      .send({ userIds: [learner.id] });

    const after = await request(app).get("/api/courses").set(headers);
    const afterIds = (after.body.courses as Array<{ id: string }>).map((c) => c.id);
    expect(afterIds).toContain(restrictedId); // now visible

    await prisma.courseEnrollment.deleteMany({ where: { courseId: { in: [restrictedId, openId] } } });
    await prisma.course.deleteMany({ where: { id: { in: [restrictedId, openId] } } });
    await prisma.user.delete({ where: { id: learner.id } });
  });

  it("allows self-enrolment on OPEN courses but rejects it on RESTRICTED", async () => {
    const openId = await createPublishedCourse("OPEN");
    const restrictedId = await createPublishedCourse("RESTRICTED");
    const learner = await prisma.user.create({
      data: { externalId: `en-self-${Date.now()}`, name: "Self Learner", email: `en-self-${Date.now()}@x.test` },
      select: { id: true, externalId: true },
    });
    const headers = participantHeaders(learner.externalId);

    const openEnrol = await request(app).post(`/api/courses/${openId}/enroll`).set(headers);
    expect(openEnrol.status).toBe(204);
    const mine = await request(app).get("/api/courses/enrollments").set(headers);
    const row = (mine.body.enrollments as Array<{ courseId: string; source: string }>).find((e) => e.courseId === openId);
    expect(row?.source).toBe("SELF");

    const restrictedEnrol = await request(app).post(`/api/courses/${restrictedId}/enroll`).set(headers);
    expect(restrictedEnrol.status).toBe(400);

    await prisma.courseEnrollment.deleteMany({ where: { courseId: { in: [openId, restrictedId] } } });
    await prisma.course.deleteMany({ where: { id: { in: [openId, restrictedId] } } });
    await prisma.user.delete({ where: { id: learner.id } });
  });

  it("forbids a participant from assigning enrollments", async () => {
    const courseId = await createPublishedCourse("OPEN");
    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(participantHeaders(`en-forbidden-${Date.now()}`))
      .send({ userIds: ["whoever"] });
    expect(res.status).toBe(403);
    await prisma.course.delete({ where: { id: courseId } });
  });
});
