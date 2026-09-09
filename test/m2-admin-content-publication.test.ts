import request from "supertest";
import { app } from "../src/app.js";
import { localizedTextCodec } from "../src/codecs/localizedTextCodec.js";
import { localizeContentText } from "../src/i18n/content.js";
import { missingLocalesFor } from "../src/modules/adminContent/contentValidationService.js";
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
        // Every MCQ field carries all three locales: the module version built from this set is
        // published below, and #896 S4 gates MCQ content the same way it gates the task text.
        questions: [
          {
            stem: {
              "en-GB": "Who owns final scoring and decision logic?",
              nb: "Hvem eier endelig vurderings- og beslutningslogikk?",
              nn: "Kven eig endeleg vurderings- og avgjerdslogikk?",
            },
            options: [
              { "en-GB": "LLM service", nb: "LLM-tjeneste", nn: "LLM-teneste" },
              {
                "en-GB": "Backend service",
                nb: "Backend-tjeneste",
                nn: "Backend-teneste",
              },
              { "en-GB": "Frontend", nb: "Frontend", nn: "Frontend" },
              { "en-GB": "External reviewer only", nb: "Kun ekstern vurderer", nn: "Berre ekstern vurderar" },
            ],
            correctAnswer: {
              "en-GB": "Backend service",
              nb: "Backend-tjeneste",
              nn: "Backend-teneste",
            },
            rationale: {
              "en-GB": "Backend must own final scoring and decision logic.",
              nb: "Backend må eie endelig vurderings- og beslutningslogikk.",
              nn: "Backend må eige endeleg vurderings- og avgjerdslogikk.",
            },
          },
          {
            stem: {
              "en-GB": "What should be config-driven to reduce hardcoding?",
              nb: "Hva bør være konfigurasjonsstyrt for å redusere hardkoding?",
              nn: "Kva bør vere konfigurasjonsstyrt for å redusere hardkoding?",
            },
            options: [
              { "en-GB": "Prompts and thresholds", nb: "Prompter og terskler", nn: "Promptar og tersklar" },
              { "en-GB": "Secrets in source", nb: "Hemmeligheter i kildekoden", nn: "Løyndomar i kjeldekoden" },
              { "en-GB": "Role IDs in code", nb: "Rolle-ID-er i koden", nn: "Rolle-ID-ar i koden" },
            ],
            correctAnswer: { "en-GB": "Prompts and thresholds", nb: "Prompter og terskler", nn: "Promptar og tersklar" },
            rationale: {
              "en-GB": "Frequently changed values should be outside code.",
              nb: "Verdier som endres ofte bør ligge utenfor koden.",
              nn: "Verdiar som blir endra ofte bør liggje utanfor koden.",
            },
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
        assessorExpectedContent: {
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
        // Three locales, because this version gets published below and #896 S4 blocks publishing
        // a version that is missing a language. The test is about benchmark wiring, not about
        // translation — so it supplies complete content rather than asserting the gate here.
        taskText: {
          "en-GB": "Submit practical reflection with benchmark-anchored quality expectations.",
          nb: "Lever praktisk refleksjon med benchmark-forankrede kvalitetskrav.",
          nn: "Lever praktisk refleksjon med benchmark-forankra kvalitetskrav.",
        },
        assessorExpectedContent: {
          "en-GB": "Use benchmark examples to calibrate scoring consistency.",
          nb: "Bruk benchmark-eksempler for å kalibrere konsistent poenggiving.",
          nn: "Bruk benchmark-døme for å kalibrere konsistent poenggjeving.",
        },
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
      });

    expect(rubricResponse.status).toBe(201);

    const blockedDeleteResponse = await request(app)
      .delete(`/api/admin/content/modules/${protectedModuleId}`)
      .set(adminHeaders);

    expect(blockedDeleteResponse.status).toBe(400);
    expect(blockedDeleteResponse.body.error).toBe("delete_module_failed");
  });

  it("merges partial title locale patches instead of rejecting or dropping other locales", async () => {
    const originalEnGBTitle = `Patchable Module ${Date.now()}`;
    const createModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": originalEnGBTitle,
          nb: "Oppdaterbar modul",
          nn: "Oppdaterbar modul nynorsk",
        },
      });

    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

    const patchResponse = await request(app)
      .patch(`/api/admin/content/modules/${moduleId}/title`)
      .set(adminHeaders)
      .send({
        title: {
          nb: "Oppdatert modulnavn",
        },
      });

    expect(patchResponse.status).toBe(200);

    const storedModule = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { title: true },
    });
    const parsedTitle = localizedTextCodec.parse(storedModule?.title ?? null);

    expect(typeof parsedTitle).toBe("object");
    expect(parsedTitle).toMatchObject({
      "en-GB": originalEnGBTitle,
      nb: "Oppdatert modulnavn",
      nn: "Oppdaterbar modul nynorsk",
    });

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  // #892: this test used to assert that a plain-string patch was copied into en-GB, nb AND nn.
  // That behaviour was a bug, not a requirement — it made every renamed module look translated,
  // served participants the author's language under every locale with no signal, and erased the
  // "still needs translating" state (a filled nn became indistinguishable from a deliberate one).
  //
  // The contract now matches updateSectionTitle: a plain string is stored as a plain string.
  // Display is unchanged, because localizeContentText falls back to it for every locale — which is
  // asserted below so the change stays provably invisible to participants.
  it("stores a plain-string title patch as a plain string, without fabricating per-locale copies", async () => {
    const createModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": `String Patch Module ${Date.now()}`,
          nb: "Strengoppdatering modul",
          nn: "Strengoppdatering modul nynorsk",
        },
      });

    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

    const patchResponse = await request(app)
      .patch(`/api/admin/content/modules/${moduleId}/title`)
      .set(adminHeaders)
      .send({
        title: "Unified module title",
      });

    expect(patchResponse.status).toBe(200);

    const storedModule = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { title: true },
    });
    const parsedTitle = localizedTextCodec.parse(storedModule?.title ?? null);

    // The stored value carries no locale claim — that is what makes "not translated yet"
    // detectable again (#894).
    expect(typeof parsedTitle).toBe("string");
    expect(parsedTitle).toBe("Unified module title");
    expect(storedModule?.title.startsWith("{")).toBe(false);

    // …and the participant sees the new title in every locale regardless, so dropping the
    // fabricated copies changed nothing observable.
    for (const locale of ["en-GB", "nb", "nn"] as const) {
      expect(localizeContentText(locale, storedModule?.title ?? "")).toBe("Unified module title");
    }

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  // The other half of the contract: a localized OBJECT patch still merges, so translating one
  // language never disturbs the others. (Create requires all three locales — localizedTextSchema —
  // while the patch is partial, so the module starts fully translated and only nn is revised.)
  it("merges a localized object patch instead of replacing the whole title", async () => {
    const englishTitle = `Merge Patch Module ${Date.now()}`;
    const createModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": englishTitle,
          nb: "Fletteoppdatering modul",
          nn: "Fletteoppdatering modul (gammel nynorsk)",
        },
      });

    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

    const patchResponse = await request(app)
      .patch(`/api/admin/content/modules/${moduleId}/title`)
      .set(adminHeaders)
      .send({ title: { nn: "Fletteoppdatering modul nynorsk" } });

    expect(patchResponse.status).toBe(200);

    const storedModule = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { title: true },
    });
    const parsedTitle = localizedTextCodec.parse(storedModule?.title ?? null) as Record<string, string>;

    expect(typeof parsedTitle).toBe("object");
    expect(parsedTitle.nn).toBe("Fletteoppdatering modul nynorsk");
    // The untouched locales must survive — that is the whole point of merging.
    expect(parsedTitle.nb).toBe("Fletteoppdatering modul");
    expect(parsedTitle["en-GB"]).toBe(englishTitle);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  // #981: the case neither test above covered — a locale patch landing on a title that is still a
  // PLAIN STRING. The merge base used to be that string copied into all three locales, so the
  // author translating only nn produced {en-GB: source, nb: source, nn: translation}, the publish
  // gate saw a fully translated module, and an en-GB participant got the Norwegian title. Run all
  // the way through the route so the schema, the command and the gate are measured together.
  it("translating one locale of a plain-string title leaves the other two reported missing", async () => {
    const sourceTitle = `Tryggleik i praksis ${Date.now()}`;
    const createModuleResponse = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      // A plain string: written in one language, not translated yet.
      .send({ title: sourceTitle });

    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

    const patchResponse = await request(app)
      .patch(`/api/admin/content/modules/${moduleId}/title`)
      .set(adminHeaders)
      .send({ title: { nn: "Tryggleik i praksis (nynorsk)" } });

    expect(patchResponse.status).toBe(200);

    const storedModule = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { title: true },
    });

    // The consequence that matters: the gate must still see two holes. This was [] before the fix.
    expect(missingLocalesFor(storedModule?.title ?? null).sort()).toEqual(["en-GB", "nb"]);
    expect(localizedTextCodec.parse(storedModule?.title ?? null)).toEqual({
      nn: "Tryggleik i praksis (nynorsk)",
    });
    expect(storedModule?.title).not.toContain(sourceTitle);

    // CONTROL: the same starting point, translated properly, must still count as complete —
    // otherwise the test above would only prove that merging was switched off.
    const completeResponse = await request(app)
      .patch(`/api/admin/content/modules/${moduleId}/title`)
      .set(adminHeaders)
      .send({
        title: {
          "en-GB": "Safety in practice",
          nb: "Trygghet i praksis",
          nn: "Tryggleik i praksis (nynorsk)",
        },
      });

    expect(completeResponse.status).toBe(200);

    const completeModule = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { title: true },
    });
    expect(missingLocalesFor(completeModule?.title ?? null)).toEqual([]);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
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
          // ⚠️ Lengden er load-bearing — se kommentaren i teksten.
          response:
            "Completed module should still remain visible after later publication. Denne teksten er bevisst lang nok til at den hermetiske LLM-stubben gir toppscore (over 800 tegn gir 4 per kriterium), slik at resultatet lander KLART over bestaatt-grensa og ikke inne i grensebaandet paa ti poeng under terskelen. Uten det ville denne testen — som handler om SYNLIGHET av fullfoerte moduler etter en publisering, ikke om vurderingspolicy — blitt roed hver gang noen justerer baandet. Fiksturen sier altsaa noe om hva testen maaler: den trenger en fullfoert innlevering, og da maa den score som en fullfoert innlevering. Teksten gjentar seg med vilje for aa naa lengden. Den unngaar dessuten ord som utloeser roede flagg i stubben — foerste utkast forklarte nettopp det, og brukte da selv et av ordene. Lengden er load-bearing, og det samme er ordvalget.",
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
              // Three locales throughout — this set is published below and #896 S4 gates MCQ.
              { "en-GB": "LLM service", nb: "LLM-tjeneste", nn: "LLM-teneste" },
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
        assessorExpectedContent: {
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
      // Three locales: the version below gets published, and #896 S4 blocks publishing a module
      // whose title is missing a language.
      .send({
        title: {
          "en-GB": "Assessment Policy Test Module",
          nb: "Testmodul for vurderingspolicy",
          nn: "Testmodul for vurderingspolicy",
        },
      });
    expect(createModuleResponse.status).toBe(201);
    const moduleId = createModuleResponse.body.module.id as string;

    const rubricResponse = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
      .set(adminHeaders)
      .send({
        criteria: { quality: "0-4" },
        scalingRule: { practical_weight: 70, max_total: 4 },
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
            // Three locales: published below, and #896 S4 gates MCQ content.
            stem: {
              "en-GB": "What does assessment policy control?",
              nb: "Hva styrer vurderingspolicyen?",
              nn: "Kva styrer vurderingspolicyen?",
            },
            options: [
              { "en-GB": "Pass thresholds", nb: "Beståttgrenser", nn: "Ståttgrenser" },
              { "en-GB": "Module title", nb: "Modultittel", nn: "Modultittel" },
              { "en-GB": "User roles", nb: "Brukerroller", nn: "Brukarroller" },
            ],
            correctAnswer: { "en-GB": "Pass thresholds", nb: "Beståttgrenser", nn: "Ståttgrenser" },
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
        taskText: {
          "en-GB": "Complete the policy test task with documented reasoning.",
          nb: "Fullfør policytesten med dokumentert resonnement.",
          nn: "Fullfør policytesten med dokumentert resonnement.",
        },
        // #372 pre-publish gate (a1e9a73) now requires assessorExpectedContent at
        // publish time. Adding the field here so this policy-focused test does not
        // get rejected by the unrelated content-validation gate.
        // #896 S4 added a second unrelated gate: all three locales must be present to publish.
        assessorExpectedContent: {
          "en-GB": "A strong response includes clear reasoning and references to policy.",
          nb: "Et sterkt svar har tydelig resonnement og referanser til policyen.",
          nn: "Eit sterkt svar har tydeleg resonnement og referansar til policyen.",
        },
        rubricVersionId: rubricResponse.body.rubricVersion.id,
        promptTemplateVersionId: promptResponse.body.promptTemplateVersion.id,
        mcqSetVersionId: mcqResponse.body.mcqSetVersion.id,
        assessmentPolicy,
      });
    expect(moduleVersionResponse.status).toBe(201);
    // ⚠️ Policyen lagres NØYAKTIG som sendt. Grensevinduet festes bevisst IKKE her — det er en
    // avledet verdi, og en avledet verdi i innholdet blir gammel når terskelen endres. Se
    // begrunnelsen i assessmentPolicyCodec.ts.
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

  // ── #930: en tittel skrevet i ETT språk skal bære HVILKET språk ────────────────────────────────
  //
  // #918 fjernet den ene løgnen: tre språk fylt med samme kildetekst påsto «dette ER oversatt».
  // Klienten sender nå én streng i stedet. Men en ren streng er ikke nøytral — `missingLocalesFor`
  // leser den som bokmål, fordi feltet ikke bærer noe språkmerke.
  //
  // ⚠️ Konsekvensen: oppretter du en modul mens arbeidsflaten står på engelsk, lagres «Incident
  // response» som norsk. Gaten melder at en-GB og nn mangler. Det er feil — det er nb og nn som
  // mangler. «Oversett det som mangler» oversetter da til feil språk, fra en kilde den tror er
  // norsk, og en norsk deltaker får engelsk tekst servert SOM norsk uten at noe flagger det.
  it("#930: en tittel opprettet på engelsk lagres som engelsk, ikke som bokmål", async () => {
    const response = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({ title: { "en-GB": "Incident response" } });

    expect(response.status).toBe(201);
    const moduleId = response.body.module.id as string;

    const stored = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });
    expect(localizedTextCodec.parse(stored?.title ?? null)).toEqual({ "en-GB": "Incident response" });

    // ⚠️ Kjernen. Før dette svarte gaten ["en-GB", "nn"] — den navnga kildespråket som manglende.
    expect(missingLocalesFor(stored?.title ?? null).sort()).toEqual(["nb", "nn"]);

    await prisma.module.deleteMany({ where: { id: moduleId } });
  });

  // Motprøven, som skiller «bærer språket sitt» fra «godtar hva som helst». En modul opprettet på
  // bokmål skal mangle de to andre — ikke seg selv.
  it("#930: en tittel opprettet på bokmål mangler en-GB og nn", async () => {
    const response = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({ title: { nb: "Hendelseshåndtering" } });

    expect(response.status).toBe(201);
    const moduleId = response.body.module.id as string;
    const stored = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });

    expect(missingLocalesFor(stored?.title ?? null).sort()).toEqual(["en-GB", "nn"]);

    await prisma.module.deleteMany({ where: { id: moduleId } });
  });

  // Bakoverkompatibilitet: rene strenger finnes allerede i databasen og fra eldre klienter. De skal
  // fortsatt godtas og fortsatt leses som før — dette handler om hva som SKRIVES fra nå av.
  it("#930: en ren streng godtas fortsatt ved opprettelse", async () => {
    const response = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({ title: "Gammel klient sender en streng" });

    expect(response.status).toBe(201);
    const moduleId = response.body.module.id as string;
    const stored = await prisma.module.findUnique({ where: { id: moduleId }, select: { title: true } });
    expect(stored?.title).toBe("Gammel klient sender en streng");

    await prisma.module.deleteMany({ where: { id: moduleId } });
  });
});
