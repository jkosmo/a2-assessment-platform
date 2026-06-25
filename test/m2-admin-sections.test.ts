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

  // #494 AC: localisation of section subfields is an EXPLICIT author action via the
  // /localize endpoint — translation never happens implicitly on save. The endpoint returns
  // the translated title + bodyMarkdown for the target locale, which the author reviews and
  // then saves separately. (LLM stub mode tags output as "[<locale>] …".)
  it("explicitly localises section title + body to another locale without mutating the source", async () => {
    const create = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({
        title: { "en-GB": `Localise me ${Date.now()}` },
        bodyMarkdown: { "en-GB": "# Heading\n\nBody text." },
      });
    const sectionId = create.body.section.id as string;

    const localized = await request(app)
      .post("/api/admin/content/sections/localize")
      .set(adminHeaders)
      .send({
        title: "Localise me",
        bodyMarkdown: "# Heading\n\nBody text.",
        sourceLocale: "en-GB",
        targetLocale: "nb",
      });
    expect(localized.status).toBe(200);
    expect(localized.body.title).toContain("[nb]");
    expect(localized.body.bodyMarkdown).toContain("[nb]");

    // The localize call must NOT have persisted anything: the stored nb field is still empty
    // until the author explicitly saves the reviewed translation.
    const detail = await request(app)
      .get(`/api/admin/content/sections/${sectionId}`)
      .set(adminHeaders);
    const storedBody = JSON.parse(detail.body.section.bodyMarkdown) as Record<string, string>;
    expect(storedBody.nb ?? "").toBe("");

    await request(app).delete(`/api/admin/content/sections/${sectionId}`).set(adminHeaders);
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
