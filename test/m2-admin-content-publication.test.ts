import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
};

describe("MVP admin content management and publication", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates linked content versions, creates module version, and publishes it with audit log", async () => {
    const module = await prisma.module.create({
      data: {
        title: `Admin Content Test Module ${Date.now()}`,
        description: "Isolated module for admin content publication test.",
        certificationLevel: "foundation",
      },
      select: { id: true },
    });
    const moduleId = module.id;

    const rubricResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
      .set(adminHeaders)
      .send({
        criteria: {
          relevance_for_case: "0-4",
          quality_and_utility: "0-4",
          iteration_and_improvement: "0-4",
          human_quality_assurance: "0-4",
          responsible_use: "0-4",
        },
        scalingRule: { practical_weight: 70, max_total: 20 },
        passRule: {
          total_min: 70,
          practical_min_percent: 50,
          mcq_min_percent: 60,
          no_open_red_flags: true,
        },
      });
    expect(rubricResponse.status).toBe(201);
    const rubricVersionId = rubricResponse.body.rubricVersion.id as string;

    const promptResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
      .set(adminHeaders)
      .send({
        systemPrompt: "You are an assessment assistant. Return strict JSON only.",
        userPromptTemplate: "Evaluate submission against rubric and provide criterion rationales.",
        examples: [{ example: "Good response with quality controls and iteration." }],
      });
    expect(promptResponse.status).toBe(201);
    const promptTemplateVersionId = promptResponse.body.promptTemplateVersion.id as string;

    const mcqResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
      .set(adminHeaders)
      .send({
        title: "MVP Admin Content Test MCQ",
        questions: [
          {
            stem: "Who owns final scoring and decision logic?",
            options: ["LLM service", "Backend service", "Frontend", "External reviewer only"],
            correctAnswer: "Backend service",
            rationale: "Backend must own final scoring and decision logic.",
          },
          {
            stem: "What should be config-driven to reduce hardcoding?",
            options: ["Prompts and thresholds", "Secrets in source", "Role IDs in code"],
            correctAnswer: "Prompts and thresholds",
            rationale: "Frequently changed values should be outside code.",
          },
        ],
      });
    expect(mcqResponse.status).toBe(201);
    const mcqSetVersionId = mcqResponse.body.mcqSetVersion.id as string;

    const moduleVersionResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: "Submit practical reflection with documented iteration and QA checks.",
        guidanceText: "Keep references to prompt evolution and validation checks.",
        rubricVersionId,
        promptTemplateVersionId,
        mcqSetVersionId,
      });
    expect(moduleVersionResponse.status).toBe(201);
    const moduleVersionId = moduleVersionResponse.body.moduleVersion.id as string;

    expect(moduleVersionResponse.body.moduleVersion.rubricVersionId).toBe(rubricVersionId);
    expect(moduleVersionResponse.body.moduleVersion.promptTemplateVersionId).toBe(promptTemplateVersionId);
    expect(moduleVersionResponse.body.moduleVersion.mcqSetVersionId).toBe(mcqSetVersionId);
    expect(moduleVersionResponse.body.moduleVersion.publishedAt).toBeNull();

    const benchmarkVersionResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/benchmark-example-versions`)
      .set(adminHeaders)
      .send({
        basePromptTemplateVersionId: promptTemplateVersionId,
        linkedModuleVersionId: moduleVersionId,
        examples: [
          {
            anchorId: "anchor-pass-1",
            input: "Strong, policy-compliant submission with measurable QA checks.",
            expectedOutcome: "PASS",
            notes: "Reference anchor for stable high-quality evaluation.",
          },
          {
            anchorId: "anchor-fail-1",
            input: "Weak submission with no validation evidence and missing safeguards.",
            expectedOutcome: "FAIL",
            notes: "Reference anchor for stable low-quality evaluation.",
          },
        ],
      });
    expect(benchmarkVersionResponse.status).toBe(201);
    const benchmarkPromptTemplateVersionId = benchmarkVersionResponse.body.benchmarkExampleVersion.id as string;
    expect(benchmarkVersionResponse.body.benchmarkExampleVersion.sourcePromptTemplateVersionId).toBe(
      promptTemplateVersionId,
    );
    expect(benchmarkVersionResponse.body.benchmarkExampleVersion.sourceModuleVersionId).toBe(moduleVersionId);

    const benchmarkModuleVersionResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: "Submit practical reflection with benchmark-anchored quality expectations.",
        guidanceText: "Use benchmark examples to calibrate scoring consistency.",
        rubricVersionId,
        promptTemplateVersionId: benchmarkPromptTemplateVersionId,
        mcqSetVersionId,
      });
    expect(benchmarkModuleVersionResponse.status).toBe(201);
    const benchmarkModuleVersionId = benchmarkModuleVersionResponse.body.moduleVersion.id as string;

    const publishResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${benchmarkModuleVersionId}/publish`)
      .set(adminHeaders);
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.moduleVersion.id).toBe(benchmarkModuleVersionId);
    expect(publishResponse.body.moduleVersion.publishedAt).toBeTruthy();
    expect(publishResponse.body.moduleVersion.publishedBy).toBeTruthy();

    const activeVersionResponse = await request(app)
      .get(`/api/modules/${moduleId}/active-version`)
      .set(adminHeaders);
    expect(activeVersionResponse.status).toBe(200);
    expect(activeVersionResponse.body.activeVersion.id).toBe(benchmarkModuleVersionId);
    expect(activeVersionResponse.body.activeVersion.rubricVersionId).toBe(rubricVersionId);
    expect(activeVersionResponse.body.activeVersion.promptTemplateVersionId).toBe(benchmarkPromptTemplateVersionId);
    expect(activeVersionResponse.body.activeVersion.mcqSetVersionId).toBe(mcqSetVersionId);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        entityType: "module_version",
        entityId: benchmarkModuleVersionId,
        action: "module_version_published",
      },
    });
    expect(auditEvent).toBeTruthy();

    const benchmarkAuditEvent = await prisma.auditEvent.findFirst({
      where: {
        entityType: "prompt_template_version",
        entityId: benchmarkPromptTemplateVersionId,
        action: "benchmark_example_version_created",
      },
    });
    expect(benchmarkAuditEvent).toBeTruthy();
  });

  it("blocks participant role from admin content routes", async () => {
    const response = await request(app)
      .post("/api/admin/content/modules/not-real/rubric-versions")
      .set(participantHeaders)
      .send({
        criteria: { x: "0-4" },
        scalingRule: { practical_weight: 70 },
        passRule: { total_min: 70 },
      });

    expect(response.status).toBe(403);
  });
});
