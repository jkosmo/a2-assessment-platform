// Integration tests for #433 module + course export/import round-trip.
// Each test creates fresh content, exports it via the new /export-package
// endpoint, imports the envelope via /import, and verifies the destination
// module is structurally equivalent. Audit-history fields (sourcePublishedAt
// etc.) are validated separately.
//
// Vitest integration profile (test/vitest.integration.config.ts) provides
// a real Postgres test DB; these tests assume the DB is clean before each
// run (the integration runner handles reset/seed).

import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-export-test",
  "x-user-email": "admin-export@company.com",
  "x-user-name": "Export Test Admin",
};

const otherAdminHeaders = {
  "x-user-id": "admin-import-test",
  "x-user-email": "admin-import@company.com",
  "x-user-name": "Import Test Admin",
};

async function setupModule(suffix: string) {
  const createResponse = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    .send({
      title: { "en-GB": `Export source ${suffix}`, nb: `Eksport kilde ${suffix}`, nn: `Eksport kjelde ${suffix}` },
      description: { "en-GB": "Source module for round-trip", nb: "Kilde-modul", nn: "Kjelde-modul" },
      certificationLevel: "basic",
    });
  expect(createResponse.status).toBe(201);
  const moduleId = createResponse.body.module.id as string;

  const rubric = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
    .set(adminHeaders)
    .send({
      criteria: { relevance: "0-4", quality: "0-4" },
      scalingRule: { practical_weight: 70, max_total: 20 },
      passRule: { total_min: 70 },
    });
  expect(rubric.status).toBe(201);
  const rubricVersionId = rubric.body.rubricVersion.id as string;

  const prompt = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
    .set(adminHeaders)
    .send({
      systemPrompt: { "en-GB": "Sys", nb: "Sys", nn: "Sys" },
      userPromptTemplate: { "en-GB": "Eval", nb: "Eval", nn: "Eval" },
      examples: [{ note: "round-trip-fixture" }],
    });
  expect(prompt.status).toBe(201);
  const promptTemplateVersionId = prompt.body.promptTemplateVersion.id as string;

  const mcq = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
    .set(adminHeaders)
    .send({
      title: { "en-GB": "Round-trip MCQ", nb: "Round-trip MCQ", nn: "Round-trip MCQ" },
      questions: [
        {
          stem: { "en-GB": "What is 1+1?", nb: "Hva er 1+1?", nn: "Kva er 1+1?" },
          options: [{ "en-GB": "2", nb: "2", nn: "2" }, { "en-GB": "3", nb: "3", nn: "3" }],
          correctAnswer: { "en-GB": "2", nb: "2", nn: "2" },
          rationale: { "en-GB": "Math", nb: "Matte", nn: "Matte" },
        },
      ],
    });
  expect(mcq.status).toBe(201);
  const mcqSetVersionId = mcq.body.mcqSetVersion.id as string;

  const moduleVersion = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/module-versions`)
    .set(adminHeaders)
    .send({
      taskText: { "en-GB": "Reflect on QA", nb: "Reflekter over QA", nn: "Refleksjon QA" },
      assessorExpectedContent: { "en-GB": "Mention QA", nb: "Nevn QA", nn: "Nevn QA" },
      rubricVersionId,
      promptTemplateVersionId,
      mcqSetVersionId,
    });
  expect(moduleVersion.status).toBe(201);
  return { moduleId, rubricVersionId, promptTemplateVersionId, mcqSetVersionId };
}

describe("#433 module export-import round-trip", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exports a module as a versioned envelope and re-imports it as a new module with equivalent content", async () => {
    const { moduleId: sourceModuleId } = await setupModule(`m-${Date.now()}`);

    const exportResponse = await request(app)
      .get(`/api/admin/content/modules/${sourceModuleId}/export-package`)
      .set(adminHeaders);
    expect(exportResponse.status).toBe(200);
    const envelope = exportResponse.body.envelope;
    expect(envelope.exportFormat).toBe("a2-content-export/v1");
    expect(envelope.scope).toBe("module");
    expect(envelope.exportedBy).toBe(adminHeaders["x-user-id"]);
    expect(envelope.module).toBeDefined();
    expect(envelope.module.module.title).toEqual(expect.objectContaining({ "en-GB": expect.stringContaining("Export source") }));
    expect(envelope.module.activeVersion.taskText).toEqual(expect.objectContaining({ "en-GB": "Reflect on QA" }));
    expect(envelope.module.activeVersion.rubric.criteria).toEqual(expect.objectContaining({ relevance: "0-4" }));
    expect(envelope.module.activeVersion.mcqSet.questions).toHaveLength(1);
    expect(envelope.module.activeVersion.audit.sourceVersionNo).toBe(1);

    const importResponse = await request(app)
      .post("/api/admin/content/modules/import")
      .set(otherAdminHeaders)
      .send({ payload: envelope, mode: "createNew" });
    expect(importResponse.status).toBe(201);
    const newModuleId = importResponse.body.moduleId as string;
    expect(newModuleId).not.toBe(sourceModuleId);
    expect(importResponse.body.moduleVersionId).toBeDefined();

    const verifyResponse = await request(app)
      .get(`/api/admin/content/modules/${newModuleId}/export-package`)
      .set(otherAdminHeaders);
    expect(verifyResponse.status).toBe(200);
    const verifyEnvelope = verifyResponse.body.envelope;
    expect(verifyEnvelope.module.module.title).toEqual(envelope.module.module.title);
    expect(verifyEnvelope.module.activeVersion.taskText).toEqual(envelope.module.activeVersion.taskText);
    expect(verifyEnvelope.module.activeVersion.assessorExpectedContent).toEqual(envelope.module.activeVersion.assessorExpectedContent);
    expect(verifyEnvelope.module.activeVersion.rubric.criteria).toEqual(envelope.module.activeVersion.rubric.criteria);
    expect(verifyEnvelope.module.activeVersion.rubric.passRule).toEqual(envelope.module.activeVersion.rubric.passRule);
    expect(verifyEnvelope.module.activeVersion.mcqSet.questions[0].stem).toEqual(envelope.module.activeVersion.mcqSet.questions[0].stem);
    // The destination's audit reflects WHO imported, not the original publishedBy.
    expect(verifyEnvelope.exportedBy).toBe(otherAdminHeaders["x-user-id"]);
  });

  it("rejects an envelope whose scope does not match the endpoint", async () => {
    const { moduleId } = await setupModule(`scope-${Date.now()}`);
    const envelopeResponse = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package`)
      .set(adminHeaders);
    const moduleEnvelope = envelopeResponse.body.envelope;
    // Send the module envelope to the course-import endpoint.
    const wrongEndpoint = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({ payload: moduleEnvelope, mode: "createNew" });
    expect(wrongEndpoint.status).toBe(400);
    expect(wrongEndpoint.body.error).toBe("scope_mismatch");
  });

  it("rejects an envelope that fails schema validation", async () => {
    const bogus = {
      exportFormat: "wrong-version",
      exportedAt: "2026-01-01T00:00:00Z",
      scope: "module",
      module: { module: { title: "" }, activeVersion: {} },
    };
    const importResponse = await request(app)
      .post("/api/admin/content/modules/import")
      .set(adminHeaders)
      .send({ payload: bogus, mode: "createNew" });
    expect(importResponse.status).toBe(400);
    expect(importResponse.body.error).toBe("validation_error");
  });

  it("requires targetId when mode is replaceExisting", async () => {
    const { moduleId } = await setupModule(`replace-${Date.now()}`);
    const envelopeResponse = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package`)
      .set(adminHeaders);
    const importResponse = await request(app)
      .post("/api/admin/content/modules/import")
      .set(adminHeaders)
      .send({ payload: envelopeResponse.body.envelope, mode: "replaceExisting" });
    expect(importResponse.status).toBe(400);
    expect(importResponse.body.error).toBe("validation_error");
  });
});
