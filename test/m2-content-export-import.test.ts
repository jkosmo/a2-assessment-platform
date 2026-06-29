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

// Use the seeded admin-1 user for both sides of the round-trip. Trying separate
// arbitrary user IDs without role headers leads to 403 because the publish/
// ownership middleware can't resolve them.
const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const otherAdminHeaders = adminHeaders;

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
    // exportedBy is the internal DB user id (Prisma CUID), not the x-user-id
    // header value. Just confirm it's a non-empty string.
    expect(typeof envelope.exportedBy).toBe("string");
    expect((envelope.exportedBy as string).length).toBeGreaterThan(0);
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
    expect(verifyEnvelope.module.activeVersion.mcqSet.questions[0].stem).toEqual(envelope.module.activeVersion.mcqSet.questions[0].stem);
    // The destination's audit records WHO ran the latest export. exportedBy is
    // the INTERNAL user id (Prisma CUID), not the external x-user-id header; we
    // just assert it is non-empty (cross-env attribution is a future enhancement
    // that requires either email lookup or stable external IDs).
    expect(typeof verifyEnvelope.exportedBy).toBe("string");
    expect((verifyEnvelope.exportedBy as string).length).toBeGreaterThan(0);
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

  // #528 (security): replaceExisting import into a module the actor does not own (and is not admin)
  // must be blocked before any version is appended — closes an authz gap (combinable with auto-publish).
  it("blocks replaceExisting import into a module the importer does not own (#528)", async () => {
    const { moduleId } = await setupModule(`own-${Date.now()}`); // owned by admin-1
    const envelope = (
      await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(adminHeaders)
    ).body.envelope;

    const otherSmo = {
      "x-user-id": `sec-import-${Date.now()}`,
      "x-user-email": `imp-${Date.now()}@company.com`,
      "x-user-name": "Other SMO",
      "x-user-roles": "SUBJECT_MATTER_OWNER",
    };
    const res = await request(app)
      .post("/api/admin/content/modules/import")
      .set(otherSmo)
      .send({ payload: envelope, mode: "replaceExisting", targetId: moduleId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("module_ownership");

    // Sanity: the owner (admin) can still replaceExisting into their own module.
    const ownerRes = await request(app)
      .post("/api/admin/content/modules/import")
      .set(adminHeaders)
      .send({ payload: envelope, mode: "replaceExisting", targetId: moduleId });
    expect(ownerRes.status).toBe(201);
  });
});

describe("#512 course export-import with learning sections", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("round-trips a course containing an interleaved learning section", async () => {
    const { moduleId } = await setupModule(`sec-${Date.now()}`);

    const sectionRes = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      // Partial locales on purpose (only nb) — sections need not have all three;
      // this exercises the patch-schema export/import path (#512 follow-up).
      .send({
        title: { nb: "Intro-seksjon" },
        bodyMarkdown: { nb: "# Hei\n\nLes dette først." },
      });
    expect(sectionRes.status).toBe(201);
    const sectionId = sectionRes.body.section.id as string;

    const courseRes = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({ title: { "en-GB": `Course ${Date.now()}`, nb: "Kurs", nn: "Kurs" } });
    expect(courseRes.status).toBe(201);
    const courseId = courseRes.body.course.id as string;

    const itemsRes = await request(app)
      .put(`/api/admin/content/courses/${courseId}/items`)
      .set(adminHeaders)
      .send({ items: [{ type: "SECTION", sectionId }, { type: "MODULE", moduleId }] });
    expect(itemsRes.status).toBe(204);

    // Export — envelope must carry the full mixed sequence incl. the section.
    const exportRes = await request(app)
      .get(`/api/admin/content/courses/${courseId}/export-package`)
      .set(adminHeaders);
    expect(exportRes.status).toBe(200);
    const envelope = exportRes.body.envelope;
    const items = envelope.course.course.items as Array<{ type: string; section?: { bodyMarkdown: unknown } }>;
    expect(items.map((i) => i.type)).toEqual(["SECTION", "MODULE"]);
    expect(items[0].section?.bodyMarkdown).toBeTruthy();

    // Import as a new course — the section must be recreated in sequence.
    const importRes = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({ payload: envelope, mode: "createNew" });
    expect(importRes.status, JSON.stringify(importRes.body)).toBe(201);
    const newCourseId = importRes.body.courseId as string;
    expect(newCourseId).not.toBe(courseId);

    const newItemsRes = await request(app)
      .get(`/api/admin/content/courses/${newCourseId}/items`)
      .set(adminHeaders);
    expect(newItemsRes.status).toBe(200);
    const newItems = newItemsRes.body.items as Array<{ type: string; sectionId?: string }>;
    expect(newItems.map((i) => i.type)).toEqual(["SECTION", "MODULE"]);
    const recreatedSection = newItems.find((i) => i.type === "SECTION");
    expect(recreatedSection?.sectionId).toBeTruthy();
    expect(recreatedSection?.sectionId).not.toBe(sectionId);
  });
});

// #525/#547: MCQ-only modules have no rubric/prompt/taskText. Export must not require them, and
// the round-trip must preserve assessmentMode=MCQ_ONLY.
describe("#547 MCQ-only module export-import round-trip", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setupMcqOnlyModule(suffix: string) {
    const createResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { "en-GB": `MCQ-only source ${suffix}`, nb: `Kun-MCQ kilde ${suffix}`, nn: `Kun-MCQ kjelde ${suffix}` },
        description: { "en-GB": "MCQ-only source", nb: "Kun-MCQ", nn: "Kun-MCQ" },
        certificationLevel: "basic",
      });
    expect(createResponse.status).toBe(201);
    const moduleId = createResponse.body.module.id as string;

    const mcq = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
      .set(adminHeaders)
      .send({
        title: { "en-GB": "MCQ", nb: "MCQ", nn: "MCQ" },
        questions: [
          {
            // #557: deliberately NO rationale — export must not emit rationale:null and import
            // must accept its absence (this round-trip previously failed).
            stem: { "en-GB": "2+2?", nb: "2+2?", nn: "2+2?" },
            options: [{ "en-GB": "4", nb: "4", nn: "4" }, { "en-GB": "5", nb: "5", nn: "5" }],
            correctAnswer: { "en-GB": "4", nb: "4", nn: "4" },
          },
        ],
      });
    expect(mcq.status).toBe(201);
    const mcqSetVersionId = mcq.body.mcqSetVersion.id as string;

    const moduleVersion = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        assessmentMode: "MCQ_ONLY",
        mcqSetVersionId,
        assessmentPolicy: { passRules: { mcqMinPercent: 70 } },
      });
    expect(moduleVersion.status).toBe(201);
    expect(moduleVersion.body.moduleVersion.assessmentMode).toBe("MCQ_ONLY");
    return { moduleId, mcqSetVersionId };
  }

  it("exports an MCQ-only module (no rubric/prompt/taskText) and re-imports it preserving the mode", async () => {
    const { moduleId } = await setupMcqOnlyModule("A");

    const exportResponse = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package`)
      .set(adminHeaders);
    expect(exportResponse.status).toBe(200);
    const envelope = exportResponse.body.envelope;
    expect(envelope.module.activeVersion.assessmentMode).toBe("MCQ_ONLY");
    expect(envelope.module.activeVersion.rubric ?? null).toBeNull();
    expect(envelope.module.activeVersion.promptTemplate ?? null).toBeNull();
    expect(envelope.module.activeVersion.taskText ?? null).toBeNull();
    expect(envelope.module.activeVersion.mcqSet.questions).toHaveLength(1);

    const importResponse = await request(app)
      .post("/api/admin/content/modules/import")
      .set(otherAdminHeaders)
      .send({ mode: "createNew", payload: envelope });
    expect(importResponse.status).toBe(201);
    const newModuleId = importResponse.body.moduleId as string;
    expect(newModuleId).not.toBe(moduleId);

    const verifyResponse = await request(app)
      .get(`/api/admin/content/modules/${newModuleId}/export-package`)
      .set(adminHeaders);
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.envelope.module.activeVersion.assessmentMode).toBe("MCQ_ONLY");
    expect(verifyResponse.body.envelope.module.activeVersion.rubric ?? null).toBeNull();
    expect(verifyResponse.body.envelope.module.activeVersion.mcqSet.questions).toHaveLength(1);
  });
});

// #578: FREETEXT_ONLY modules have taskText + rubric + prompt but NO MCQ set. Export must not
// require the MCQ set, and the round-trip must preserve assessmentMode=FREETEXT_ONLY with mcqSet null.
describe("#578 FREETEXT_ONLY module export-import round-trip", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setupFreetextOnlyModule(suffix: string) {
    const createResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { "en-GB": `Free-text-only source ${suffix}`, nb: `Kun-fritekst kilde ${suffix}`, nn: `Berre-fritekst kjelde ${suffix}` },
        description: { "en-GB": "Free-text-only source", nb: "Kun fritekst", nn: "Berre fritekst" },
        certificationLevel: "basic",
      });
    expect(createResponse.status).toBe(201);
    const moduleId = createResponse.body.module.id as string;

    const rubric = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
      .set(adminHeaders)
      .send({ criteria: { relevance: "0-4", quality: "0-4" }, scalingRule: { practical_weight: 100, max_total: 20 } });
    expect(rubric.status).toBe(201);
    const rubricVersionId = rubric.body.rubricVersion.id as string;

    const prompt = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
      .set(adminHeaders)
      .send({ systemPrompt: { "en-GB": "Sys", nb: "Sys", nn: "Sys" }, userPromptTemplate: { "en-GB": "Eval", nb: "Eval", nn: "Eval" }, examples: [] });
    expect(prompt.status).toBe(201);
    const promptTemplateVersionId = prompt.body.promptTemplateVersion.id as string;

    const moduleVersion = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        assessmentMode: "FREETEXT_ONLY",
        taskText: { "en-GB": "Write an essay", nb: "Skriv et essay", nn: "Skriv eit essay" },
        assessorExpectedContent: { "en-GB": "Depth", nb: "Dybde", nn: "Djupne" },
        rubricVersionId,
        promptTemplateVersionId,
      });
    expect(moduleVersion.status).toBe(201);
    expect(moduleVersion.body.moduleVersion.assessmentMode).toBe("FREETEXT_ONLY");
    return { moduleId };
  }

  it("exports a FREETEXT_ONLY module (no MCQ set) and re-imports it preserving the mode", async () => {
    const { moduleId } = await setupFreetextOnlyModule("A");

    const exportResponse = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package`)
      .set(adminHeaders);
    expect(exportResponse.status).toBe(200);
    const envelope = exportResponse.body.envelope;
    expect(envelope.module.activeVersion.assessmentMode).toBe("FREETEXT_ONLY");
    expect(envelope.module.activeVersion.mcqSet ?? null).toBeNull();
    expect(envelope.module.activeVersion.taskText).toEqual(expect.objectContaining({ "en-GB": "Write an essay" }));
    expect(envelope.module.activeVersion.rubric).not.toBeNull();

    const importResponse = await request(app)
      .post("/api/admin/content/modules/import")
      .set(otherAdminHeaders)
      .send({ mode: "createNew", payload: envelope });
    expect(importResponse.status).toBe(201);
    const newModuleId = importResponse.body.moduleId as string;
    expect(newModuleId).not.toBe(moduleId);

    const verifyResponse = await request(app)
      .get(`/api/admin/content/modules/${newModuleId}/export-package`)
      .set(adminHeaders);
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.envelope.module.activeVersion.assessmentMode).toBe("FREETEXT_ONLY");
    expect(verifyResponse.body.envelope.module.activeVersion.mcqSet ?? null).toBeNull();
    expect(verifyResponse.body.envelope.module.activeVersion.taskText).toEqual(expect.objectContaining({ "en-GB": "Write an essay" }));
  });
});
