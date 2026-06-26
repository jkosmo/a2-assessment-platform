import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "../src/modules/course/index.js";

// #645/CL-2 — classes (cohorts): admin CRUD + membership + course assignment, and the dynamic
// visibility/my-enrollments effects for participants.

const adminHeaders = {
  "x-user-id": "class-admin-ext",
  "x-user-email": "class-admin@company.com",
  "x-user-name": "Class Admin",
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

async function createRestrictedCourse(): Promise<string> {
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": `Class course ${Date.now()}-${Math.round(performance.now())}` }),
      enrollmentPolicy: "RESTRICTED",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  return course.id;
}

describe("Class (cohort) management + dynamic assignment (#645/CL-2)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a class, adds a member, assigns a course, and makes it visible to the member only", async () => {
    const courseId = await createRestrictedCourse();
    const member = await prisma.user.create({
      data: { externalId: `cls-m-${Date.now()}`, name: "Class Member", email: `cls-m-${Date.now()}@x.test` },
      select: { id: true, externalId: true },
    });
    const outsider = await prisma.user.create({
      data: { externalId: `cls-o-${Date.now()}`, name: "Outsider", email: `cls-o-${Date.now()}@x.test` },
      select: { id: true, externalId: true },
    });

    const created = await request(app).post("/api/admin/content/classes").set(adminHeaders).send({ name: "Kull A" });
    expect(created.status).toBe(201);
    const classId = created.body.class.id as string;

    expect((await request(app).post(`/api/admin/content/classes/${classId}/members`).set(adminHeaders).send({ userId: member.id })).status).toBe(201);
    expect((await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(adminHeaders).send({ courseId, dueAt: "2020-01-01T00:00:00.000Z" })).status).toBe(201);

    // Member sees the RESTRICTED course; outsider does not.
    const memberCourses = await request(app).get("/api/courses").set(participantHeaders(member.externalId));
    expect((memberCourses.body.courses as Array<{ id: string }>).some((c) => c.id === courseId)).toBe(true);
    const outsiderCourses = await request(app).get("/api/courses").set(participantHeaders(outsider.externalId));
    expect((outsiderCourses.body.courses as Array<{ id: string }>).some((c) => c.id === courseId)).toBe(false);

    // Member's "my enrollments" surfaces the class-assigned course (source CLASS, OVERDUE due date).
    const mine = await request(app).get("/api/courses/enrollments").set(participantHeaders(member.externalId));
    const row = (mine.body.enrollments as Array<{ courseId: string; source: string; status: string }>).find((e) => e.courseId === courseId);
    expect(row?.source).toBe("CLASS");
    expect(row?.status).toBe("OVERDUE");

    // Removing the member revokes visibility.
    expect((await request(app).delete(`/api/admin/content/classes/${classId}/members/${member.id}`).set(adminHeaders)).status).toBe(204);
    const afterRemove = await request(app).get("/api/courses").set(participantHeaders(member.externalId));
    expect((afterRemove.body.courses as Array<{ id: string }>).some((c) => c.id === courseId)).toBe(false);

    await prisma.courseGroupAssignment.deleteMany({ where: { courseId } });
    await prisma.class.delete({ where: { id: classId } });
    await prisma.course.delete({ where: { id: courseId } });
    await prisma.user.deleteMany({ where: { id: { in: [member.id, outsider.id] } } });
  });

  it("makes a course assigned to the 'Alle deltakere' system class visible to any participant", async () => {
    const courseId = await createRestrictedCourse();
    const participant = await prisma.user.create({
      data: { externalId: `cls-all-${Date.now()}`, name: "Any Participant", email: `cls-all-${Date.now()}@x.test` },
      select: { externalId: true },
    });

    await request(app)
      .post(`/api/admin/content/classes/${SYSTEM_ALL_PARTICIPANTS_CLASS_ID}/courses`)
      .set(adminHeaders)
      .send({ courseId })
      .expect(201);

    const courses = await request(app).get("/api/courses").set(participantHeaders(participant.externalId));
    expect((courses.body.courses as Array<{ id: string }>).some((c) => c.id === courseId)).toBe(true);

    await prisma.courseGroupAssignment.deleteMany({ where: { courseId } });
    await prisma.course.delete({ where: { id: courseId } });
    await prisma.user.deleteMany({ where: { externalId: participant.externalId } });
  });

  it("refuses to archive the system class and forbids participants from creating classes", async () => {
    expect((await request(app).delete(`/api/admin/content/classes/${SYSTEM_ALL_PARTICIPANTS_CLASS_ID}`).set(adminHeaders)).status).toBe(400);
    expect((await request(app).post("/api/admin/content/classes").set(participantHeaders(`cls-forbid-${Date.now()}`)).send({ name: "Nope" })).status).toBe(403);
  });
});
