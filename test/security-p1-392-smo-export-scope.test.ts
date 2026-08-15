import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const smoAHeaders = {
  "x-user-id": "smo-export-a",
  "x-user-email": "smo-export-a@company.com",
  "x-user-name": "SMO Export Alpha",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const smoBHeaders = {
  "x-user-id": "smo-export-b",
  "x-user-email": "smo-export-b@company.com",
  "x-user-name": "SMO Export Beta",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const adminHeaders = {
  "x-user-id": "admin-export-1",
  "x-user-email": "admin-export@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const moduleBody = {
  title: { "en-GB": "Export Scope Test Module", nb: "Eksportomfangsmodul", nn: "Eksportomfangsmodul" },
};

// #392 established two controls on module export. The SCOPE control stands: an SMO may only
// export a module they own. The answer-key redaction was removed on 2026-08-14 - it hid the
// key from the very person who wrote it, while /export-package handed the same owner the same
// key anyway, and its only real effect was a lossy backup (export -> import lost the answers
// with no warning).
describe("Security P1 #392: SMO content scope on module export", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("SMO-B is denied export of a module owned by SMO-A", async () => {
    const createRes = await request(app)
      .post("/api/admin/content/modules")
      .set(smoAHeaders)
      .send(moduleBody);
    expect(createRes.status).toBe(201);
    const moduleId = createRes.body.module.id as string;

    const exportBRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export`)
      .set(smoBHeaders);
    expect(exportBRes.status).toBe(403);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("an owner's export includes correctAnswer and rationale, like an admin's", async () => {
    const createRes = await request(app)
      .post("/api/admin/content/modules")
      .set(smoAHeaders)
      .send(moduleBody);
    expect(createRes.status).toBe(201);
    const moduleId = createRes.body.module.id as string;

    const mcqRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
      .set(smoAHeaders)
      .send({
        title: { "en-GB": "Test MCQ Set", nb: "Test MCQ-sett", nn: "Test MCQ-sett" },
        questions: [
          {
            stem: { "en-GB": "What is 2+2?", nb: "Hva er 2+2?", nn: "Kva er 2+2?" },
            options: [
              { "en-GB": "3", nb: "3", nn: "3" },
              { "en-GB": "4", nb: "4", nn: "4" },
              { "en-GB": "5", nb: "5", nn: "5" },
            ],
            correctAnswer: { "en-GB": "4", nb: "4", nn: "4" },
            rationale: { "en-GB": "Because math.", nb: "Fordi matte.", nn: "Fordi matte." },
          },
        ],
      });
    expect(mcqRes.status).toBe(201);

    // The owner gets a complete module back - anything less is a lossy backup.
    const smoExportRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export`)
      .set(smoAHeaders);
    expect(smoExportRes.status).toBe(200);

    const smoExport = smoExportRes.body.moduleExport;
    const smoVersionQuestions = smoExport.versions.mcqSetVersions?.[0]?.questions ?? [];
    expect(smoVersionQuestions.length).toBeGreaterThan(0);
    for (const q of smoVersionQuestions) {
      expect(q).toHaveProperty("correctAnswer");
      expect(q).toHaveProperty("rationale");
    }

    // Admin sees exactly the same shape - the two exports no longer diverge.
    const adminExportRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export`)
      .set(adminHeaders);
    expect(adminExportRes.status).toBe(200);

    const adminVersionQuestions = adminExportRes.body.moduleExport.versions.mcqSetVersions?.[0]?.questions ?? [];
    expect(adminVersionQuestions.length).toBeGreaterThan(0);
    for (const q of adminVersionQuestions) {
      expect(q).toHaveProperty("correctAnswer");
      expect(q).toHaveProperty("rationale");
    }

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  // #903: the module route was guarded, the COURSE route was not - and a course export
  // inlines each module's full payload, answer keys included. Exporting someone else's course
  // was therefore a way around the module guard above.
  it("SMO-B is denied export of a course owned by SMO-A", async () => {
    const courseRes = await request(app)
      .post("/api/admin/content/courses")
      .set(smoAHeaders)
      .send({ title: { "en-GB": "Export Scope Course", nb: "Eksportomfangskurs", nn: "Eksportomfangskurs" } });
    expect(courseRes.status).toBe(201);
    const courseId = courseRes.body.course.id as string;

    const exportBRes = await request(app)
      .get(`/api/admin/content/courses/${courseId}/export-package`)
      .set(smoBHeaders);
    expect(exportBRes.status).toBe(403);

    // The owner still reaches it - the guard is about who, not about disabling the feature.
    // Assert the EXACT status, not "anything but 403": an empty course is not exportable, and
    // a loose assertion here hid a 500 (the not-exportable branch missed "no items to export").
    const exportARes = await request(app)
      .get(`/api/admin/content/courses/${courseId}/export-package`)
      .set(smoAHeaders);
    expect(exportARes.status).toBe(422);
    expect(exportARes.body.error).toBe("course_not_exportable");

    await request(app).delete(`/api/admin/content/courses/${courseId}`).set(adminHeaders);
  });

  it("SMO-B is denied the participant list of SMO-A's course", async () => {
    const courseRes = await request(app)
      .post("/api/admin/content/courses")
      .set(smoAHeaders)
      .send({ title: { "en-GB": "Enrollment Scope Course", nb: "Deltakerkurs", nn: "Deltakarkurs" } });
    expect(courseRes.status).toBe(201);
    const courseId = courseRes.body.course.id as string;

    // Names, e-mail, department and progress - guarded like the mutating enrollment routes.
    const listBRes = await request(app)
      .get(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(smoBHeaders);
    expect(listBRes.status).toBe(403);

    const listARes = await request(app)
      .get(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(smoAHeaders);
    expect(listARes.status).toBe(200);

    await request(app).delete(`/api/admin/content/courses/${courseId}`).set(adminHeaders);
  });

  it("admin can export any module regardless of ownership", async () => {
    const createRes = await request(app)
      .post("/api/admin/content/modules")
      .set(smoAHeaders)
      .send(moduleBody);
    expect(createRes.status).toBe(201);
    const moduleId = createRes.body.module.id as string;

    const exportRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export`)
      .set(adminHeaders);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.moduleExport.module.id).toBe(moduleId);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });
});
