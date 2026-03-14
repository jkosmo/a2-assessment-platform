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
    const createModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `Admin Content Test Module ${Date.now()}`,
          nb: "Admin innholdsmodul test",
          nn: "Admin innhaldsmodul test",
        },
        description: {
          "en-GB": "Isolated module for admin content publication test.",
          nb: "Isolert modul for admin innholds test.",
          nn: "Isolert modul for admin innhalds test.",
        },
        certificationLevel: "foundation",
        validFrom: "2026-03-01",
        validTo: "2028-03-01",
      });
    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

    const adminModuleListResponse = await request(app)
      .get("/api/admin/content/modules")
      .set(adminHeaders);
    expect(adminModuleListResponse.status).toBe(200);
    expect(
      (adminModuleListResponse.body.modules as Array<{ id: string }>).some((module) => module.id === moduleId),
    ).toBe(true);

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
        systemPrompt: {
          "en-GB": "You are an assessment assistant. Return strict JSON only.",
          nb: "Du er en vurderingsassistent. Returner kun streng JSON.",
          nn: "Du er ein vurderingsassistent. Returner berre streng JSON.",
        },
        userPromptTemplate: {
          "en-GB": "Evaluate submission against rubric and provide criterion rationales.",
          nb: "Vurder innlevering mot kriterier og gi begrunnelser per kriterium.",
          nn: "Vurder innlevering mot kriterium og gi grunngjeving per kriterium.",
        },
        examples: [{ example: "Good response with quality controls and iteration." }],
      });
    expect(promptResponse.status).toBe(201);
    const promptTemplateVersionId = promptResponse.body.promptTemplateVersion.id as string;

    const mcqResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": "MVP Admin Content Test",
          nb: "MVP admin innholdstest",
          nn: "MVP admin innhaldstest",
        },
        questions: [
          {
            stem: {
              "en-GB": "Who owns final scoring and decision logic?",
              nb: "Hvem eier endelig vurderings- og beslutningslogikk?",
              nn: "Kven eig endeleg vurderings- og avgjerdslogikk?",
            },
            options: [
              "LLM service",
              {
                "en-GB": "Backend service",
                nb: "Backend-tjeneste",
                nn: "Backend-teneste",
              },
              "Frontend",
              "External reviewer only",
            ],
            correctAnswer: {
              "en-GB": "Backend service",
              nb: "Backend-tjeneste",
              nn: "Backend-teneste",
            },
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
        taskText: {
          "en-GB": "Submit practical reflection with documented iteration and QA checks.",
          nb: "Lever praktisk refleksjon med dokumentert iterasjon og QA-kontroller.",
          nn: "Lever praktisk refleksjon med dokumentert iterasjon og QA-kontrollar.",
        },
        guidanceText: {
          "en-GB": "Keep references to prompt evolution and validation checks.",
          nb: "Beskriv forventet svar med tydelige valideringskontroller.",
          nn: "Skildra forventa svar med tydelege valideringskontrollar.",
        },
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

    const exportResponse = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export`)
      .set(adminHeaders);
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.moduleExport.module.id).toBe(moduleId);
    expect(exportResponse.body.moduleExport.selectedConfiguration.source).toBe("activeModuleVersion");
    expect(exportResponse.body.moduleExport.selectedConfiguration.moduleVersion.id).toBe(benchmarkModuleVersionId);
    expect(exportResponse.body.moduleExport.selectedConfiguration.promptTemplateVersion.id).toBe(
      benchmarkPromptTemplateVersionId,
    );
    expect(exportResponse.body.moduleExport.selectedConfiguration.mcqSetVersion.questions.length).toBeGreaterThan(0);
    expect(exportResponse.body.moduleExport.versions.rubricVersions.length).toBeGreaterThan(0);

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

    const moduleCreatedAuditEvent = await prisma.auditEvent.findFirst({
      where: {
        entityType: "module",
        entityId: moduleId,
        action: "module_created",
      },
    });
    expect(moduleCreatedAuditEvent).toBeTruthy();
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

  it("validates module create date fields", async () => {
    const response = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: "Date validation module",
        validFrom: "not-a-date",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
  });

  it("allows deleting an empty module and blocks deleting a module with dependencies", async () => {
    const createEmptyModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `Disposable Module ${Date.now()}`,
          nb: "Slettbar modul",
          nn: "Slettbar modul",
        },
      });

    expect(createEmptyModuleResponse.status).toBe(201);
    const emptyModuleId = createEmptyModuleResponse.body.module.id as string;

    const deleteEmptyResponse = await request(app)
      .delete(`/api/admin/content/modules/${emptyModuleId}`)
      .set(adminHeaders);

    expect(deleteEmptyResponse.status).toBe(200);
    expect(deleteEmptyResponse.body.deletedModule.id).toBe(emptyModuleId);

    const createProtectedModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `Protected Module ${Date.now()}`,
          nb: "Beskyttet modul",
          nn: "Verna modul",
        },
      });

    expect(createProtectedModuleResponse.status).toBe(201);
    const protectedModuleId = createProtectedModuleResponse.body.module.id as string;

    const rubricResponse = await request(app)
      .post(`/api/admin/content/modules/${protectedModuleId}/rubric-versions`)
      .set(adminHeaders)
      .send({
        criteria: { relevance_for_case: "0-4" },
        scalingRule: { practical_weight: 70, max_total: 20 },
        passRule: {
          total_min: 70,
          practical_min_percent: 50,
          mcq_min_percent: 60,
          no_open_red_flags: true,
        },
      });

    expect(rubricResponse.status).toBe(201);

    const blockedDeleteResponse = await request(app)
      .delete(`/api/admin/content/modules/${protectedModuleId}`)
      .set(adminHeaders);

    expect(blockedDeleteResponse.status).toBe(400);
    expect(blockedDeleteResponse.body.error).toBe("delete_module_failed");
  });

  it("keeps previously completed modules visible to participant after publishing a new module", async () => {
    const isolatedParticipantHeaders = {
      "x-user-id": `participant-pub-regression-${Date.now()}`,
      "x-user-email": "participant.pub.regression@company.com",
      "x-user-name": "Participant Pub Regression",
      "x-user-roles": "PARTICIPANT",
    };

    const seedModulesResponse = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set(isolatedParticipantHeaders);
    expect(seedModulesResponse.status).toBe(200);

    const seedModule = (seedModulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set(isolatedParticipantHeaders)
      .send({
        moduleId: seedModule.id,
        deliveryType: "text",
        responseJson: {
          response: "Completed module should still remain visible after later publication.",
          reflection: "Creating a completed module baseline before publishing a new module.",
          promptExcerpt: "Document baseline completion before publication test.",
        },
      });
    expect(submissionResponse.status).toBe(201);

    const submissionId = submissionResponse.body.submission.id as string;
    const startMcqResponse = await request(app)
      .get(`/api/modules/${seedModule.id}/mcq/start`)
      .query({ submissionId })
      .set(isolatedParticipantHeaders);
    expect(startMcqResponse.status).toBe(200);

    const responses = startMcqResponse.body.questions.map((question: { id: string; stem: string }) => ({
      questionId: question.id,
      selectedAnswer:
        question.stem === "What is the recommended model ownership boundary?"
          ? "Backend owns final decision"
          : "Prompt versions and thresholds",
    }));

    const submitMcqResponse = await request(app)
      .post(`/api/modules/${seedModule.id}/mcq/submit`)
      .set(isolatedParticipantHeaders)
      .send({
        submissionId,
        attemptId: startMcqResponse.body.attemptId,
        responses,
      });
    expect(submitMcqResponse.status).toBe(200);

    const runAssessmentResponse = await request(app)
      .post(`/api/assessments/${submissionId}/run`)
      .set(isolatedParticipantHeaders)
      .send({ sync: true });
    expect(runAssessmentResponse.status).toBe(202);

    const createModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `Participant Visibility Module ${Date.now()}`,
          nb: "Deltaker synlighetsmodul",
          nn: "Deltakar synlegheitsmodul",
        },
        description: {
          "en-GB": "Published module should not hide completed modules.",
          nb: "Publisert modul skal ikke skjule fullførte moduler.",
          nn: "Publisert modul skal ikkje skjule fullførte modular.",
        },
      });
    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

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

    const promptResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
      .set(adminHeaders)
      .send({
        systemPrompt: {
          "en-GB": "Return strict JSON only.",
          nb: "Returner kun streng JSON.",
          nn: "Returner berre streng JSON.",
        },
        userPromptTemplate: {
          "en-GB": "Evaluate against rubric.",
          nb: "Vurder mot kriterier.",
          nn: "Vurder mot kriterium.",
        },
        examples: [],
      });
    expect(promptResponse.status).toBe(201);

    const mcqResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": "Visibility MCQ",
          nb: "Synlighetstest MCQ",
          nn: "Synlegheitstest MCQ",
        },
        questions: [
          {
            stem: {
              "en-GB": "Which layer owns the final certification decision?",
              nb: "Hvilket lag eier den endelige sertifiseringsbeslutningen?",
              nn: "Kva lag eig den endelege sertifiseringsavgjerda?",
            },
            options: [
              "LLM service",
              {
                "en-GB": "Backend service",
                nb: "Backend-tjeneste",
                nn: "Backend-teneste",
              },
            ],
            correctAnswer: {
              "en-GB": "Backend service",
              nb: "Backend-tjeneste",
              nn: "Backend-teneste",
            },
          },
        ],
      });
    expect(mcqResponse.status).toBe(201);

    const moduleVersionResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: {
          "en-GB": "Complete the visibility publication task.",
          nb: "Fullfør synlighetspubliseringsoppgaven.",
          nn: "Fullfør synlegheitspubliseringsoppgåva.",
        },
        guidanceText: {
          "en-GB": "Describe controls and expected outcome.",
          nb: "Beskriv kontroller og forventet resultat.",
          nn: "Skildra kontrollar og venta resultat.",
        },
        rubricVersionId: rubricResponse.body.rubricVersion.id,
        promptTemplateVersionId: promptResponse.body.promptTemplateVersion.id,
        mcqSetVersionId: mcqResponse.body.mcqSetVersion.id,
      });
    expect(moduleVersionResponse.status).toBe(201);

    const publishResponse = await request(app)
      .post(
        `/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionResponse.body.moduleVersion.id}/publish`,
      )
      .set(adminHeaders);
    expect(publishResponse.status).toBe(200);

    const participantListResponse = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set({
        ...isolatedParticipantHeaders,
        "x-locale": "nb",
      });
    expect(participantListResponse.status).toBe(200);

    const modules = participantListResponse.body.modules as Array<Record<string, unknown>>;
    expect(modules.some((module) => module.id === seedModule.id)).toBe(true);
    expect(modules.some((module) => module.id === moduleId)).toBe(true);

    const completedSeedModule = modules.find((module) => module.id === seedModule.id);
    expect(completedSeedModule?.participantStatus).toMatchObject({
      latestStatus: "COMPLETED",
    });
  });

  it("stores assessmentPolicy on module version and returns it as parsed object via active-version endpoint", async () => {
    const createModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({ title: "Assessment Policy Test Module" });
    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

    const rubricResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
      .set(adminHeaders)
      .send({
        criteria: { quality: "0-4" },
        scalingRule: { practical_weight: 70, max_total: 4 },
        passRule: { total_min: 70, practical_min_percent: 50, mcq_min_percent: 60, no_open_red_flags: true },
      });
    expect(rubricResponse.status).toBe(201);

    const promptResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
      .set(adminHeaders)
      .send({
        systemPrompt: "You are an assessor.",
        userPromptTemplate: "Evaluate: {{submission}}",
        examples: [{ example: "Good response." }],
      });
    expect(promptResponse.status).toBe(201);

    const mcqResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
      .set(adminHeaders)
      .send({
        title: "Policy Test MCQ",
        questions: [
          {
            stem: "What does assessment policy control?",
            options: ["Pass thresholds", "Module title", "User roles"],
            correctAnswer: "Pass thresholds",
          },
        ],
      });
    expect(mcqResponse.status).toBe(201);

    const assessmentPolicy = {
      scoring: { practicalWeight: 60, mcqWeight: 40 },
      passRules: { totalMin: 65 },
    };

    const moduleVersionResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: "Complete the policy test task.",
        rubricVersionId: rubricResponse.body.rubricVersion.id,
        promptTemplateVersionId: promptResponse.body.promptTemplateVersion.id,
        mcqSetVersionId: mcqResponse.body.mcqSetVersion.id,
        assessmentPolicy,
      });
    expect(moduleVersionResponse.status).toBe(201);
    expect(moduleVersionResponse.body.moduleVersion.assessmentPolicyJson).toBe(JSON.stringify(assessmentPolicy));

    await request(app)
      .post(
        `/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionResponse.body.moduleVersion.id}/publish`,
      )
      .set(adminHeaders)
      .expect(200);

    const activeVersionResponse = await request(app)
      .get(`/api/modules/${moduleId}/active-version`)
      .set(adminHeaders);
    expect(activeVersionResponse.status).toBe(200);
    expect(activeVersionResponse.body.activeVersion.assessmentPolicy).toEqual(assessmentPolicy);
  });
});
