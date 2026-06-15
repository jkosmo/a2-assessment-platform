import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

// #485/B1 — course learning-section CRUD API.
describe("Admin course-section management", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates, reads, lists, re-versions, and deletes a section", async () => {
    const createResponse = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({
        title: { "en-GB": `Section ${Date.now()}`, nb: "Seksjon", nn: "Seksjon" },
        bodyMarkdown: { "en-GB": "# Hello\n\nFirst body.", nb: "# Hei", nn: "# Hei" },
      });
    expect(createResponse.status).toBe(201);
    const sectionId = createResponse.body.section.id as string;
    expect(createResponse.body.section.versionNo).toBe(1);
    expect(createResponse.body.section.bodyMarkdown).toContain("First body.");

    const detailResponse = await request(app)
      .get(`/api/admin/content/sections/${sectionId}`)
      .set(adminHeaders);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.section.title).toContain("en-GB");

    const listResponse = await request(app)
      .get("/api/admin/content/sections")
      .set(adminHeaders);
    expect(listResponse.status).toBe(200);
    expect((listResponse.body.sections as Array<{ id: string }>).some((s) => s.id === sectionId)).toBe(true);

    // Editing content publishes a new immutable version (latest-wins).
    const updateResponse = await request(app)
      .put(`/api/admin/content/sections/${sectionId}/content`)
      .set(adminHeaders)
      .send({ bodyMarkdown: { "en-GB": "# Hello\n\nSecond body.", nb: "# Hei 2", nn: "# Hei 2" } });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.section.versionNo).toBe(2);
    expect(updateResponse.body.section.bodyMarkdown).toContain("Second body.");

    const versionCount = await prisma.courseSectionVersion.count({ where: { sectionId } });
    expect(versionCount).toBe(2);

    const titleResponse = await request(app)
      .patch(`/api/admin/content/sections/${sectionId}/title`)
      .set(adminHeaders)
      .send({ title: { "en-GB": "Renamed section", nb: "Omdøpt", nn: "Omdøpt" } });
    expect(titleResponse.status).toBe(200);
    expect(titleResponse.body.section.title).toContain("Renamed section");

    const deleteResponse = await request(app)
      .delete(`/api/admin/content/sections/${sectionId}`)
      .set(adminHeaders);
    expect(deleteResponse.status).toBe(204);

    const gone = await request(app)
      .get(`/api/admin/content/sections/${sectionId}`)
      .set(adminHeaders);
    expect(gone.status).toBe(404);
  });

  it("refuses to delete a section that is attached to a course", async () => {
    const create = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({
        title: { "en-GB": `Attached ${Date.now()}`, nb: "Festet", nn: "Festet" },
        bodyMarkdown: { "en-GB": "body", nb: "body", nn: "body" },
      });
    const sectionId = create.body.section.id as string;

    const course = await prisma.course.create({
      data: { title: `Section Host ${Date.now()}` },
      select: { id: true },
    });
    await prisma.courseItem.create({
      data: { courseId: course.id, itemType: "SECTION", sectionId, sortOrder: 0 },
    });

    const blocked = await request(app)
      .delete(`/api/admin/content/sections/${sectionId}`)
      .set(adminHeaders);
    expect(blocked.status).toBe(400);

    // cleanup (course cascade removes the CourseItem, then section is deletable)
    await prisma.course.delete({ where: { id: course.id } });
    await request(app).delete(`/api/admin/content/sections/${sectionId}`).set(adminHeaders);
  });
});
