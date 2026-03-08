import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
};

const appealHandlerHeaders = {
  "x-user-id": "appeal-handler-user-1",
  "x-user-email": "appeal.handler@company.com",
  "x-user-name": "Appeal Handler",
  "x-user-roles": "APPEAL_HANDLER",
};

describe("MVP appeal flow", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("supports appeal create -> claim -> resolve with immutable resolution decision layer", async () => {
    const modulesResponse = await request(app).get("/api/modules").set(participantHeaders);
    expect(modulesResponse.status).toBe(200);
    const seedModule = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }
    const moduleId = seedModule.id;

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set(participantHeaders)
      .send({
        moduleId,
        deliveryType: "text",
        rawText: "A practical submission with analysis and responsible use notes.",
        reflectionText: "I iterated on prompts and manually validated outputs.",
        promptExcerpt: "Improve structure and summarize findings.",
        responsibilityAcknowledged: true,
      });
    expect(submissionResponse.status).toBe(201);
    const submissionId = submissionResponse.body.submission.id as string;

    const startMcqResponse = await request(app)
      .get(`/api/modules/${moduleId}/mcq/start`)
      .query({ submissionId })
      .set(participantHeaders);
    expect(startMcqResponse.status).toBe(200);

    const responses = startMcqResponse.body.questions.map((question: { id: string; stem: string }) => ({
      questionId: question.id,
      selectedAnswer:
        question.stem === "What is the recommended model ownership boundary?"
          ? "Backend owns final decision"
          : "Prompt versions and thresholds",
    }));

    const submitMcqResponse = await request(app)
      .post(`/api/modules/${moduleId}/mcq/submit`)
      .set(participantHeaders)
      .send({
        submissionId,
        attemptId: startMcqResponse.body.attemptId,
        responses,
      });
    expect(submitMcqResponse.status).toBe(200);

    const runAssessmentResponse = await request(app)
      .post(`/api/assessments/${submissionId}/run`)
      .set(participantHeaders)
      .send({ sync: true });
    expect(runAssessmentResponse.status).toBe(202);

    const createAppealResponse = await request(app)
      .post(`/api/submissions/${submissionId}/appeals`)
      .set(participantHeaders)
      .send({
        appealReason: "I request a second review because the practical quality was evaluated too harshly.",
      });
    expect(createAppealResponse.status).toBe(201);
    const appealId = createAppealResponse.body.appeal.id as string;
    expect(createAppealResponse.body.appeal.appealStatus).toBe("OPEN");

    const duplicateAppealResponse = await request(app)
      .post(`/api/submissions/${submissionId}/appeals`)
      .set(participantHeaders)
      .send({
        appealReason: "Second request should be rejected while first appeal is open.",
      });
    expect(duplicateAppealResponse.status).toBe(409);

    const queueResponse = await request(app).get("/api/appeals?status=OPEN").set(appealHandlerHeaders);
    expect(queueResponse.status).toBe(200);
    const queuedAppeal = (
      queueResponse.body.appeals as Array<{
        id: string;
        submission: { id: string };
      }>
    ).find((item) => item.submission.id === submissionId);
    expect(queuedAppeal).toBeDefined();
    expect(queuedAppeal?.id).toBe(appealId);

    const detailResponse = await request(app).get(`/api/appeals/${appealId}`).set(appealHandlerHeaders);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.appeal.submission.llmEvaluations.length).toBeGreaterThan(0);
    expect(detailResponse.body.appeal.submission.mcqAttempts.length).toBeGreaterThan(0);
    expect(detailResponse.body.appeal.submission.decisions.length).toBeGreaterThan(0);

    const claimResponse = await request(app).post(`/api/appeals/${appealId}/claim`).set(appealHandlerHeaders);
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.body.appeal.appealStatus).toBe("IN_REVIEW");

    const resolveResponse = await request(app)
      .post(`/api/appeals/${appealId}/resolve`)
      .set(appealHandlerHeaders)
      .send({
        passFailTotal: false,
        decisionReason: "Appeal handler resolved with fail due to missing practical evidence.",
        resolutionNote: "Original decision was adjusted after detailed second review.",
      });
    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.resolutionDecision.decisionType).toBe("APPEAL_RESOLUTION");
    expect(resolveResponse.body.resolutionDecision.parentDecisionId).toBeTruthy();

    const decisions = await prisma.assessmentDecision.findMany({
      where: { submissionId },
      orderBy: { finalisedAt: "desc" },
    });
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    expect(decisions[0].decisionType).toBe("APPEAL_RESOLUTION");
    expect(decisions[0].parentDecisionId).toBe(decisions[1].id);

    const resolvedAppeal = await prisma.appeal.findUniqueOrThrow({ where: { id: appealId } });
    expect(resolvedAppeal.appealStatus).toBe("RESOLVED");
    expect(resolvedAppeal.resolutionNote).toContain("adjusted");

    const auditResponse = await request(app)
      .get(`/api/audit/submissions/${submissionId}`)
      .set(participantHeaders);
    expect(auditResponse.status).toBe(200);
    const actions = (auditResponse.body.events as Array<{ action: string }>).map((event) => event.action);
    expect(actions).toContain("appeal_created");
    expect(actions).toContain("appeal_claimed");
    expect(actions).toContain("appeal_resolution_decision_created");
    expect(actions).toContain("appeal_resolved");
  });
});
