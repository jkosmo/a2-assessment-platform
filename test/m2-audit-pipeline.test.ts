import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
};

const otherParticipantHeaders = {
  "x-user-id": "participant-2",
  "x-user-email": "participant2@company.com",
  "x-user-name": "Second Participant",
  "x-user-roles": "PARTICIPANT",
};

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

describe("MVP audit event pipeline", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("captures audit trail across submission -> mcq -> assessment decision and supports retrieval by submission", async () => {
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
        rawText: "Submission with sensitive client data references for manual review trigger.",
        reflectionText: "I iterated and included sensitive snippets to validate manual routing.",
        promptExcerpt: "Assess and identify potential policy risks.",
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

    const actions = await getAuditActionsForSubmission(submissionId, participantHeaders);
    expect(actions).toContain("submission_created");
    expect(actions).toContain("mcq_submitted");
    expect(actions).toContain("assessment_job_enqueued");
    expect(actions).toContain("llm_evaluation_created");
    expect(actions).toContain("decision_created");
    expect(actions).toContain("manual_review_opened");
  });

  it("blocks non-owner participant from reading submission audit trail while allowing admin", async () => {
    const ownerModulesResponse = await request(app).get("/api/modules").set(participantHeaders);
    expect(ownerModulesResponse.status).toBe(200);
    const seedModule = (ownerModulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }
    const moduleId = seedModule.id;

    const ownerSubmissionResponse = await request(app)
      .post("/api/submissions")
      .set(participantHeaders)
      .send({
        moduleId,
        deliveryType: "text",
        rawText: "Owner-only submission text.",
        reflectionText: "Owner-only reflection for audit access control.",
        promptExcerpt: "Owner-only prompt excerpt.",
        responsibilityAcknowledged: true,
      });
    expect(ownerSubmissionResponse.status).toBe(201);
    const submissionId = ownerSubmissionResponse.body.submission.id as string;

    const forbiddenResponse = await request(app)
      .get(`/api/audit/submissions/${submissionId}`)
      .set(otherParticipantHeaders);
    expect(forbiddenResponse.status).toBe(403);

    const adminResponse = await request(app)
      .get(`/api/audit/submissions/${submissionId}`)
      .set(adminHeaders);
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.submissionId).toBe(submissionId);
  });
});

async function getAuditActionsForSubmission(
  submissionId: string,
  headers: Record<string, string>,
): Promise<string[]> {
  const maxAttempts = 15;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const auditResponse = await request(app)
      .get(`/api/audit/submissions/${submissionId}`)
      .set(headers);

    if (auditResponse.status !== 200) {
      throw new Error(`Expected audit response 200, got ${auditResponse.status}`);
    }

    const actions = (auditResponse.body.events as Array<{ action: string }>).map((event) => event.action);
    if (
      actions.includes("llm_evaluation_created") &&
      actions.includes("decision_created") &&
      actions.includes("manual_review_opened")
    ) {
      return actions;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  const finalResponse = await request(app).get(`/api/audit/submissions/${submissionId}`).set(headers);
  return (finalResponse.body.events as Array<{ action: string }>).map((event) => event.action);
}
