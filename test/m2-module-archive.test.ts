import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

describe("Module archive and restore (#258)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createBareModule(titleSuffix: string) {
    const res = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `Archive Test Module ${titleSuffix}`,
          nb: `Arkivtestmodul ${titleSuffix}`,
          nn: `Arkivtestmodul ${titleSuffix}`,
        },
        description: "For archive flow testing.",
      });
    expect(res.status).toBe(201);
    return res.body.module.id as string;
  }

  it("archives an unpublished module and hides it from the main list", async () => {
    const moduleId = await createBareModule(String(Date.now()));

    // Visible in main list before archiving
    const listBefore = await request(app).get("/api/admin/content/modules").set(adminHeaders);
    expect(listBefore.status).toBe(200);
    expect((listBefore.body.modules as Array<{ id: string }>).some((m) => m.id === moduleId)).toBe(true);

    // Archive
    const archiveRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/archive`)
      .set(adminHeaders);
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.moduleId).toBe(moduleId);
    expect(archiveRes.body.archivedAt).toBeTruthy();

    // Hidden from main list
    const listAfter = await request(app).get("/api/admin/content/modules").set(adminHeaders);
    expect(listAfter.status).toBe(200);
    expect((listAfter.body.modules as Array<{ id: string }>).some((m) => m.id === moduleId)).toBe(false);

    // Visible in archive list
    const archiveList = await request(app).get("/api/admin/content/modules/archive").set(adminHeaders);
    expect(archiveList.status).toBe(200);
    expect((archiveList.body.modules as Array<{ id: string }>).some((m) => m.id === moduleId)).toBe(true);
  });

  it("restores an archived module back to the main list", async () => {
    const moduleId = await createBareModule(`restore-${Date.now()}`);

    await request(app).post(`/api/admin/content/modules/${moduleId}/archive`).set(adminHeaders).expect(200);

    // Restore
    const restoreRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/restore`)
      .set(adminHeaders);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.moduleId).toBe(moduleId);

    // Back in main list
    const mainList = await request(app).get("/api/admin/content/modules").set(adminHeaders);
    expect((mainList.body.modules as Array<{ id: string }>).some((m) => m.id === moduleId)).toBe(true);

    // Gone from archive list
    const archiveList = await request(app).get("/api/admin/content/modules/archive").set(adminHeaders);
    expect((archiveList.body.modules as Array<{ id: string }>).some((m) => m.id === moduleId)).toBe(false);
  });

  it("blocks archiving a published (active) module", async () => {
    const moduleId = await createBareModule(`published-${Date.now()}`);

    // Create minimal content and publish
    const rubricRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
      .set(adminHeaders)
      .send({
        criteria: { task_comprehension: "0-4" },
        scalingRule: { practical_weight: 70, max_total: 4 },
        passRule: { total_min: 50, practical_min_percent: 50, mcq_min_percent: 50, no_open_red_flags: false },
        active: true,
      });
    expect(rubricRes.status).toBe(201);

    const promptRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
      .set(adminHeaders)
      .send({
        systemPrompt: "You are an evaluator.",
        userPromptTemplate: "Evaluate the submission.",
        examples: [],
        active: true,
      });
    expect(promptRes.status).toBe(201);

    const mcqRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
      .set(adminHeaders)
      .send({
        title: "Archive Block MCQ",
        active: true,
        questions: [
          { stem: "Q?", options: ["A", "B"], correctAnswer: "A", rationale: "A is correct." },
        ],
      });
    expect(mcqRes.status).toBe(201);

    const mvRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: "Submit your response.",
        rubricVersionId: rubricRes.body.rubricVersion.id,
        promptTemplateVersionId: promptRes.body.promptTemplateVersion.id,
        mcqSetVersionId: mcqRes.body.mcqSetVersion.id,
      });
    expect(mvRes.status).toBe(201);

    const pubRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${mvRes.body.moduleVersion.id}/publish`)
      .set(adminHeaders);
    expect(pubRes.status).toBe(200);

    // Archive should fail
    const archiveRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/archive`)
      .set(adminHeaders);
    expect(archiveRes.status).toBe(400);
    expect(archiveRes.body.message).toMatch(/unpublished/);
  });

  it("blocks archiving an already-archived module", async () => {
    const moduleId = await createBareModule(`double-${Date.now()}`);
    await request(app).post(`/api/admin/content/modules/${moduleId}/archive`).set(adminHeaders).expect(200);

    const secondArchive = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/archive`)
      .set(adminHeaders);
    expect(secondArchive.status).toBe(400);
    expect(secondArchive.body.message).toMatch(/already archived/);
  });

  it("blocks restoring a non-archived module", async () => {
    const moduleId = await createBareModule(`restore-not-archived-${Date.now()}`);

    const restoreRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/restore`)
      .set(adminHeaders);
    expect(restoreRes.status).toBe(400);
    expect(restoreRes.body.message).toMatch(/not archived/);
  });

  it("filters archive list by search term", async () => {
    const unique = `srch-${Date.now()}`;
    const moduleId = await createBareModule(unique);
    await request(app).post(`/api/admin/content/modules/${moduleId}/archive`).set(adminHeaders).expect(200);

    const matchRes = await request(app)
      .get(`/api/admin/content/modules/archive?search=${unique}`)
      .set(adminHeaders);
    expect(matchRes.status).toBe(200);
    expect((matchRes.body.modules as Array<{ id: string }>).some((m) => m.id === moduleId)).toBe(true);

    const noMatchRes = await request(app)
      .get("/api/admin/content/modules/archive?search=nomatch-xyz-99999")
      .set(adminHeaders);
    expect(noMatchRes.status).toBe(200);
    expect((noMatchRes.body.modules as Array<{ id: string }>).some((m) => m.id === moduleId)).toBe(false);
  });

  it("records audit events for archive and restore", async () => {
    const moduleId = await createBareModule(`audit-${Date.now()}`);

    await request(app).post(`/api/admin/content/modules/${moduleId}/archive`).set(adminHeaders).expect(200);
    await request(app).post(`/api/admin/content/modules/${moduleId}/restore`).set(adminHeaders).expect(200);

    const archiveAudit = await prisma.auditEvent.findFirst({
      where: { entityType: "module", entityId: moduleId, action: "module_archived" },
    });
    expect(archiveAudit).toBeTruthy();

    const restoreAudit = await prisma.auditEvent.findFirst({
      where: { entityType: "module", entityId: moduleId, action: "module_restored" },
    });
    expect(restoreAudit).toBeTruthy();
  });
});
