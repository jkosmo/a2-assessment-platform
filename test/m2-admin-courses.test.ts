import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

describe("Admin course management", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates, updates, orders, publishes, and archives courses through the admin API", async () => {
    const emptyCourseResponse = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `Empty Course ${Date.now()}`,
          nb: "Tomt kurs",
          nn: "Tomt kurs",
        },
      });
    expect(emptyCourseResponse.status).toBe(201);
    const emptyCourseId = emptyCourseResponse.body.course.id as string;

    const publishEmptyResponse = await request(app)
      .post(`/api/admin/content/courses/${emptyCourseId}/publish`)
      .set(adminHeaders);
    expect(publishEmptyResponse.status).toBe(400);

    const moduleA = await prisma.module.create({
      data: { title: `Admin Course Module A ${Date.now()}` },
      select: { id: true, title: true },
    });
    const moduleB = await prisma.module.create({
      data: { title: `Admin Course Module B ${Date.now()}` },
      select: { id: true, title: true },
    });

    const createCourseResponse = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `Managed Course ${Date.now()}`,
          nb: "Administrert kurs",
          nn: "Administrert kurs",
        },
        description: {
          "en-GB": "Course managed through admin API integration test.",
          nb: "Kurs styrt via integrasjonstest for admin-API.",
          nn: "Kurs styrt via integrasjonstest for admin-API.",
        },
        certificationLevel: {
          "en-GB": "foundation",
          nb: "grunnleggende",
          nn: "grunnleggjande",
        },
      });
    expect(createCourseResponse.status).toBe(201);
    const courseId = createCourseResponse.body.course.id as string;

    const updateCourseResponse = await request(app)
      .put(`/api/admin/content/courses/${courseId}`)
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": "Updated managed course",
        },
        description: {
          "en-GB": "Updated description from the admin UI.",
        },
      });
    expect(updateCourseResponse.status).toBe(200);

    const setModulesResponse = await request(app)
      .put(`/api/admin/content/courses/${courseId}/modules`)
      .set(adminHeaders)
      .send({
        modules: [
          { moduleId: moduleA.id, sortOrder: 2 },
          { moduleId: moduleB.id, sortOrder: 1 },
        ],
      });
    expect(setModulesResponse.status).toBe(204);

    const detailResponse = await request(app)
      .get(`/api/admin/content/courses/${courseId}`)
      .set(adminHeaders);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.course.title).toContain("Updated managed course");
    expect(detailResponse.body.course.modules).toEqual([
      expect.objectContaining({
        moduleId: moduleB.id,
        sortOrder: 1,
        moduleTitle: moduleB.title,
      }),
      expect.objectContaining({
        moduleId: moduleA.id,
        sortOrder: 2,
        moduleTitle: moduleA.title,
      }),
    ]);

    const publishResponse = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(adminHeaders);
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.course.publishedAt).toBeTruthy();

    const archiveResponse = await request(app)
      .post(`/api/admin/content/courses/${courseId}/archive`)
      .set(adminHeaders);
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body.course.archivedAt).toBeTruthy();

    const listResponse = await request(app)
      .get("/api/admin/content/courses")
      .set(adminHeaders);
    expect(listResponse.status).toBe(200);
    const listedCourse = (listResponse.body.courses as Array<Record<string, unknown>>).find(
      (course) => course.id === courseId,
    );
    expect(listedCourse).toMatchObject({
      id: courseId,
      moduleCount: 2,
    });
    expect(listedCourse?.updatedAt).toEqual(expect.any(String));

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        entityType: auditEntityTypes.course,
        entityId: courseId,
        action: {
          in: [
            auditActions.course.created,
            auditActions.course.published,
            auditActions.course.archived,
          ],
        },
      },
      orderBy: { timestamp: "asc" },
      select: { action: true },
    });
    expect(auditEvents.map((event) => event.action)).toEqual([
      auditActions.course.created,
      auditActions.course.published,
      auditActions.course.archived,
    ]);
  });
});
