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
    // #734: publishing a course now requires its modules to be published first (invariant I1 —
    // a published course must never contain unavailable content). Publish both modules up front so
    // the course-publish below exercises the unchanged all-items-published happy path.
    for (const module of [moduleA, moduleB]) {
      const version = await prisma.moduleVersion.create({
        data: {
          moduleId: module.id,
          versionNo: 1,
          taskText: JSON.stringify({ "en-GB": "Task text long enough to be a meaningful assessment." }),
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
    }

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

  // #660: deleting a course that has completions (issued certificates) must fail with a clear 400,
  // not a raw FK-violation 500. A course with no completions still deletes (204).
  it("blocks deletion of a course with completions and allows deletion otherwise", async () => {
    const stamp = Date.now();
    const courseWithCompletion = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({ title: { "en-GB": `Completed Course ${stamp}`, nb: "x", nn: "x" } });
    expect(courseWithCompletion.status).toBe(201);
    const completedCourseId = courseWithCompletion.body.course.id as string;

    const learner = await prisma.user.create({
      data: {
        externalId: `del-course-learner-${stamp}`,
        name: "Course Learner",
        email: `del-course-learner-${stamp}@example.test`,
      },
      select: { id: true },
    });
    await prisma.courseCompletion.create({
      data: { userId: learner.id, courseId: completedCourseId, moduleSnapshotJson: "[]" },
    });

    const blocked = await request(app)
      .delete(`/api/admin/content/courses/${completedCourseId}`)
      .set(adminHeaders);
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/completion/i);
    // The course must still exist (the failed delete must not have partially removed it).
    expect(await prisma.course.findUnique({ where: { id: completedCourseId } })).not.toBeNull();

    // A course with no completions deletes cleanly.
    const deletable = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({ title: { "en-GB": `Deletable Course ${stamp}`, nb: "x", nn: "x" } });
    const deletableId = deletable.body.course.id as string;
    const ok = await request(app).delete(`/api/admin/content/courses/${deletableId}`).set(adminHeaders);
    expect(ok.status).toBe(204);
    expect(await prisma.course.findUnique({ where: { id: deletableId } })).toBeNull();

    // Cleanup the blocked-delete fixtures (completion FK is Restrict → remove it first).
    await prisma.courseCompletion.deleteMany({ where: { courseId: completedCourseId } });
    await prisma.course.delete({ where: { id: completedCourseId } });
    await prisma.user.delete({ where: { id: learner.id } });
  });
});
