import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1124: deltakeren ser kriteriene med trinnene før levering (`assessmentCriteria` på modulen), og
// poengene per kriterium etter vurderingen (`participantGuidance.criterionScores` på resultatet).
//
// ⚠️ Gjennom RUTENE, ikke tjenestene (2.106.0: tjenesten tok imot et felt ruta avviste). Og det
// viktigste beviset står i den første testen: et kriterium merket `candidateVisible: false` og
// `assessorExpectedContent` finnes ikke NOE STED i det deltakeren får — heller ikke ett nivå ned, i
// `activeVersion`, der fasiten lå urørt før denne saken.
//
// Egen modul og egen deltaker, så ingen annen test ser radene; alt ryddes i afterAll.

const participant = {
  "x-user-id": "participant-1124",
  "x-user-email": "participant-1124@company.com",
  "x-user-name": "Criteria Participant",
  "x-user-roles": "PARTICIPANT",
};
const other = {
  "x-user-id": "participant-1124-other",
  "x-user-email": "participant-1124-other@company.com",
  "x-user-name": "Other Participant",
  "x-user-roles": "PARTICIPANT",
};

const FASIT = "FASIT-1124: budsjettet ble godkjent, Ola sender til revisor";
const HIDDEN_TEXT = "SKJULT-1124 nevner artikkel 6-1";

const CRITERIA = {
  vedtak: {
    label: { nb: "Vedtakene", nn: "Vedtaka", "en-GB": "The decisions" },
    description: {
      nb: "0 = vedtakene mangler; 1 = blandet med diskusjonen; 2 = står først, presist",
      nn: "0 = vedtaka manglar; 1 = blanda med diskusjonen; 2 = står først, presist",
      "en-GB": "0 = decisions missing; 1 = mixed with the discussion; 2 = first, precise",
    },
    maxScore: 2,
    weight: 0.5,
    candidateVisible: true,
  },
  struktur: { label: "Struktur", description: "0–4: 0 = ingen; 2 = delvis; 4 = tydelig struktur" },
  hemmelig_1124: { label: HIDDEN_TEXT, description: "0 = nei; 2 = ja", maxScore: 2, candidateVisible: false },
  task_comprehension: { weight: 0.2 },
};

describe("#1124 kriteriene og poengene, gjennom rutene", () => {
  let moduleId: string;
  let versionId: string;
  let rubricId: string;
  let promptId: string;
  let submissionId: string;

  beforeAll(async () => {
    const module = await prisma.module.create({ data: { title: `Kriterier 1124 ${Date.now()}` }, select: { id: true } });
    moduleId = module.id;
    rubricId = (await prisma.rubricVersion.create({
      data: { moduleId, versionNo: 1, criteriaJson: JSON.stringify(CRITERIA), scalingRuleJson: "{}", active: true },
      select: { id: true },
    })).id;
    promptId = (await prisma.promptTemplateVersion.create({
      data: { moduleId, versionNo: 1, systemPrompt: "sys", userPromptTemplate: "usr", examplesJson: "[]", active: true },
      select: { id: true },
    })).id;
    versionId = (await prisma.moduleVersion.create({
      data: {
        moduleId,
        versionNo: 1,
        taskText: JSON.stringify({ nb: "Skriv referatet." }),
        assessorExpectedContent: FASIT,
        assessmentMode: "FREETEXT_ONLY",
        rubricVersionId: rubricId,
        promptTemplateVersionId: promptId,
        publishedAt: new Date(),
      },
      select: { id: true },
    })).id;
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: versionId } });

    // Brukeren opprettes av autentiseringen ved første kall.
    await request(app).get("/api/me").set(participant);
    await request(app).get("/api/me").set(other);
    const user = await prisma.user.findUniqueOrThrow({ where: { externalId: participant["x-user-id"] } });
    submissionId = (await prisma.submission.create({
      data: {
        userId: user.id,
        moduleId,
        moduleVersionId: versionId,
        deliveryType: "text",
        responseJson: JSON.stringify({ response: "Referatet." }),
        submissionStatus: "COMPLETED",
      },
      select: { id: true },
    })).id;
    await prisma.lLMEvaluation.create({
      data: {
        submissionId,
        moduleVersionId: versionId,
        modelName: "stub",
        promptTemplateVersionId: promptId,
        requestPayloadHash: "1124",
        rubricTotal: 8,
        practicalScoreScaled: 50,
        passFailPractical: true,
        manualReviewRecommended: false,
        responseJson: JSON.stringify({
          module_id: moduleId,
          rubric_scores: { vedtak: 2, struktur: 4, hemmelig_1124: 2, task_comprehension: 0 },
          rubric_total: 8,
          practical_score_scaled: 50,
          pass_fail_practical: true,
          criterion_rationales: {
            vedtak: "Vedtakene står, men blandet med diskusjonen.",
            // Begrunnelsen for det skjulte kriteriet røper det samme som etiketten — den skal ikke ut.
            hemmelig_1124: "SKJULT-1124: nevnte ikke artikkel 6-1.",
          },
          improvement_advice: [],
          red_flags: [],
          manual_review_recommended: false,
          confidence_note: "",
        }),
      },
    });
  });

  afterAll(async () => {
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: null } });
    await prisma.lLMEvaluation.deleteMany({ where: { moduleVersionId: versionId } });
    await prisma.assessmentDecision.deleteMany({ where: { moduleVersionId: versionId } });
    await prisma.submission.deleteMany({ where: { moduleId } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId } });
    await prisma.rubricVersion.deleteMany({ where: { moduleId } });
    await prisma.promptTemplateVersion.deleteMany({ where: { moduleId } });
    await prisma.module.delete({ where: { id: moduleId } });
    await prisma.$disconnect();
  });

  function expectNothingHidden(payload: unknown) {
    const sent = JSON.stringify(payload);
    expect(sent).not.toContain("assessorExpectedContent");
    expect(sent).not.toContain("FASIT-1124");
    expect(sent).not.toContain("SKJULT-1124");
    expect(sent).not.toContain("hemmelig_1124");
    expect(sent).not.toContain("criteriaJson");
  }

  it("GET /api/modules — assessmentCriteria med trinn; verken fasit eller skjult kriterium noe sted", async () => {
    const res = await request(app).get("/api/modules?includeCompleted=true").set(participant).set("x-locale", "nn");
    expect(res.status).toBe(200);
    const module = (res.body.modules as Array<{ id: string }>).find((m) => m.id === moduleId) as Record<string, unknown> | undefined;
    expect(module).toBeDefined();
    expect(module!.assessmentCriteria).toEqual([
      {
        id: "vedtak",
        label: "Vedtaka",
        scaleMax: 2,
        intro: null,
        steps: [
          { score: 0, text: "vedtaka manglar" },
          { score: 1, text: "blanda med diskusjonen" },
          { score: 2, text: "står først, presist" },
        ],
      },
      {
        id: "struktur",
        label: "Struktur",
        scaleMax: 4,
        intro: null,
        steps: [{ score: 0, text: "ingen" }, { score: 2, text: "delvis" }, { score: 4, text: "tydelig struktur" }],
      },
    ]);
    // Hele lista, ikke bare denne modulen: fasiten lå i `activeVersion` på ALLE moduler.
    expectNothingHidden(res.body);
  });

  it("GET /api/modules/:id — samme kriterier, og ingenting skjult", async () => {
    const res = await request(app).get(`/api/modules/${moduleId}`).set(participant).set("x-locale", "nb");
    expect(res.status).toBe(200);
    expect((res.body.module.assessmentCriteria as Array<{ id: string; label: string }>).map((c) => [c.id, c.label])).toEqual([
      ["vedtak", "Vedtakene"],
      ["struktur", "Struktur"],
    ]);
    expectNothingHidden(res.body);
  });

  it("GET /api/modules?adminFacing=true — forfattersiden har fortsatt fasiten", async () => {
    const res = await request(app)
      .get("/api/modules?adminFacing=true&includeCompleted=true")
      .set({ ...participant, "x-user-id": "admin-1124", "x-user-email": "admin-1124@company.com", "x-user-roles": "ADMINISTRATOR" });
    expect(res.status).toBe(200);
    const module = (res.body.modules as Array<Record<string, unknown>>).find((m) => m.id === moduleId);
    expect(module).toHaveProperty("assessorExpectedContent", FASIT);
  });

  it("GET /api/submissions/:id/result — poeng på kriteriets egen skala, og toppnivået der det mangler", async () => {
    const res = await request(app).get(`/api/submissions/${submissionId}/result`).set(participant).set("x-locale", "nb");
    expect(res.status).toBe(200);
    expect(res.body.participantGuidance.criterionScores).toEqual([
      { id: "vedtak", label: "Vedtakene", score: 1, maxScore: 2, topStep: "står først, presist" },
      { id: "struktur", label: "Struktur", score: 4, maxScore: 4, topStep: null },
      { id: "task_comprehension", label: null, score: 0, maxScore: 4, topStep: null },
    ]);
    // Begrunnelsen for det skjulte kriteriet er filtrert bort på serveren.
    expect(res.body.participantGuidance.criterionRationales).toEqual({ vedtak: "Vedtakene står, men blandet med diskusjonen." });
    // Ingen vurderer har overstyrt: ingen merknad.
    expect(res.body.participantGuidance.finalDecisionByAssessor).toBe(false);
    const sent = JSON.stringify(res.body);
    expect(sent).not.toContain("FASIT-1124");
    expect(sent).not.toContain("SKJULT-1124");
    expect(sent).not.toContain("hemmelig_1124");
  });

  it("GET /api/submissions/:id/result — en vurderer overstyrte: poengene står, med flagget for merknaden", async () => {
    await prisma.assessmentDecision.create({
      data: {
        submissionId,
        moduleVersionId: versionId,
        rubricVersionId: rubricId,
        mcqScaledScore: 0,
        practicalScaledScore: 50,
        totalScore: 50,
        redFlagsJson: "[]",
        passFailTotal: false,
        decisionType: "MANUAL_OVERRIDE",
        decisionReason: "Vurdereren satte strøket.",
      },
    });
    const res = await request(app).get(`/api/submissions/${submissionId}/result`).set(participant).set("x-locale", "nb");
    expect(res.status).toBe(200);
    expect(res.body.participantGuidance.finalDecisionByAssessor).toBe(true);
    expect(res.body.participantGuidance.criterionScores).toHaveLength(3);
  });

  it("en annens innlevering: 404", async () => {
    const res = await request(app).get(`/api/submissions/${submissionId}/result`).set(other);
    expect(res.status).toBe(404);
  });
});
