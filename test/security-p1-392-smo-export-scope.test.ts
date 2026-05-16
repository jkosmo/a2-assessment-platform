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

describe("Security P1 #392: SMO content scope and MCQ answer key protection on export", () => {
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

  it("SMO export omits correctAnswer and rationale from MCQ questions; admin export includes them", async () => {
    const createRes = await request(app)
      .post("/api/admin/content/modules")
      .set(smoAHeaders)
      .send(moduleBody);
    expect(createRes.status).toBe(201);
    const moduleId = createRes.body.module.id as string;

    // Create an MCQ set version with a question that has correctAnswer and rationale
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

    // SMO export: correctAnswer and rationale must be absent
    const smoExportRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export`)
      .set(smoAHeaders);
    expect(smoExportRes.status).toBe(200);

    const smoExport = smoExportRes.body.moduleExport;
    const smoVersionQuestions = smoExport.versions.mcqSetVersions?.[0]?.questions ?? [];
    expect(smoVersionQuestions.length).toBeGreaterThan(0);
    for (const q of smoVersionQuestions) {
      expect(q).not.toHaveProperty("correctAnswer");
      expect(q).not.toHaveProperty("rationale");
    }
    if (smoExport.selectedConfiguration?.mcqSetVersion?.questions) {
      for (const q of smoExport.selectedConfiguration.mcqSetVersion.questions) {
        expect(q).not.toHaveProperty("correctAnswer");
        expect(q).not.toHaveProperty("rationale");
      }
    }

    // Admin export: correctAnswer and rationale must be present
    const adminExportRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export`)
      .set(adminHeaders);
    expect(adminExportRes.status).toBe(200);

    const adminExport = adminExportRes.body.moduleExport;
    const adminVersionQuestions = adminExport.versions.mcqSetVersions?.[0]?.questions ?? [];
    expect(adminVersionQuestions.length).toBeGreaterThan(0);
    for (const q of adminVersionQuestions) {
      expect(q).toHaveProperty("correctAnswer");
      expect(q).toHaveProperty("rationale");
    }

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
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
