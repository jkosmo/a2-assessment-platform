import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

// #492 — read sections count toward course progress and are marked as read.
describe("Participant section read progress", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("marks a section read and counts it toward course progress", async () => {
    const course = await prisma.course.create({
      data: { title: `Read Course ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Read me" }) },
      select: { id: true },
    });
    const version = await prisma.courseSectionVersion.create({
      data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify({ "en-GB": "Body." }), publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder: 0 } });

    // Before reading: section shows read=false, progress 0/1.
    const before = await request(app).get(`/api/courses/${course.id}`).set(participantHeaders);
    expect(before.status).toBe(200);
    const sectionBefore = (before.body.course.items as Array<{ type: string; read?: boolean }>).find((i) => i.type === "SECTION");
    expect(sectionBefore?.read).toBe(false);
    expect(before.body.course.progress).toMatchObject({ completed: 0, total: 1 });

    // Mark read (idempotent).
    const mark1 = await request(app).post(`/api/courses/${course.id}/sections/${section.id}/read`).set(participantHeaders);
    expect(mark1.status).toBe(204);
    const mark2 = await request(app).post(`/api/courses/${course.id}/sections/${section.id}/read`).set(participantHeaders);
    expect(mark2.status).toBe(204);

    // After reading: read=true, progress 1/1, course COMPLETED.
    const after = await request(app).get(`/api/courses/${course.id}`).set(participantHeaders);
    const sectionAfter = (after.body.course.items as Array<{ type: string; read?: boolean }>).find((i) => i.type === "SECTION");
    expect(sectionAfter?.read).toBe(true);
    expect(after.body.course.progress).toMatchObject({ completed: 1, total: 1, courseStatus: "COMPLETED" });

    await prisma.course.delete({ where: { id: course.id } });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: section.id } });
    await prisma.courseSection.delete({ where: { id: section.id } });
  });
});
