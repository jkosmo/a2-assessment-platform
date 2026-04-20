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

const reviewerHeaders = {
  "x-user-id": "reviewer-audit-1",
  "x-user-email": "reviewer@company.com",
  "x-user-name": "Audit Reviewer",
  "x-user-roles": "REVIEWER",
};

describe("MVP audit event pipeline", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("captures audit trail across submission -> mcq -> assessment decision and supports retrieval by submission", async () => {
    const modulesResponse = await request(app).get("/api/modules?includeCompleted=true").set(participantHeaders);
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
        responseJson: {
          response: "Submission with sensitive client data references for manual review trigger.",
          reflection: "I iterated and included sensitive snippets to validate manual routing.",
          promptExcerpt: "Assess and identify potential policy risks.",
        },
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
    expect(actions).toContain("sensitive_data_preprocessed");
    expect(actions).toContain("secondary_assessment_triggered");
    expect(actions).toContain("secondary_assessment_completed");
    expect(actions).toContain("llm_evaluation_created");
    expect(actions).toContain("decision_created");
    expect(actions).toContain("manual_review_opened");
    expect(actions.filter((action) => action === "llm_evaluation_created").length).toBeGreaterThanOrEqual(2);

    const auditResponse = await request(app).get(`/api/audit/submissions/${submissionId}`).set(participantHeaders);
    expect(auditResponse.status).toBe(200);
    const createdEvent = (auditResponse.body.events as Array<{ action: string; metadata: Record<string, unknown> }>).find(
      (event) => event.action === "submission_created",
    );
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.metadata.parser).toBeTruthy();
  });

  it("blocks non-owner participant from reading submission audit trail while allowing admin", async () => {
    const ownerModulesResponse = await request(app).get("/api/modules?includeCompleted=true").set(participantHeaders);
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
        responseJson: {
          response: "Owner-only submission text.",
          reflection: "Owner-only reflection for audit access control.",
          promptExcerpt: "Owner-only prompt excerpt.",
        },
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

  it("API-005: strips actor.email from audit events for participants; retains it for privileged callers", async () => {
    const modulesResponse = await request(app).get("/api/modules?includeCompleted=true").set(participantHeaders);
    expect(modulesResponse.status).toBe(200);
    const seedModule = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (m) => m.title === "Generative AI Foundations",
    );
    if (!seedModule) throw new Error("Seed module not found.");

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set(participantHeaders)
      .send({
        moduleId: seedModule.id,
        deliveryType: "text",
        responseJson: {
          response: "API-005 audit privacy test submission.",
          reflection: "Checking email exposure in audit trail.",
          promptExcerpt: "Privacy test.",
        },
      });
    expect(submissionResponse.status).toBe(201);
    const submissionId = submissionResponse.body.submission.id as string;

    // Participant reads their own audit trail — actor.email must be absent
    const participantAudit = await request(app)
      .get(`/api/audit/submissions/${submissionId}`)
      .set(participantHeaders);
    expect(participantAudit.status).toBe(200);
    const participantEvents = participantAudit.body.events as Array<{ actor: { email?: string } | null }>;
    const actorsWithEmail = participantEvents.filter((e) => e.actor && "email" in e.actor);
    expect(actorsWithEmail).toHaveLength(0);

    // Reviewer reads the same audit trail — actor.email must be present for events with actors
    const reviewerAudit = await request(app)
      .get(`/api/audit/submissions/${submissionId}`)
      .set(reviewerHeaders);
    expect(reviewerAudit.status).toBe(200);
    const reviewerEvents = reviewerAudit.body.events as Array<{ actor: { email?: string } | null }>;
    const eventsWithActor = reviewerEvents.filter((e) => e.actor !== null);
    expect(eventsWithActor.length).toBeGreaterThan(0);
    eventsWithActor.forEach((e) => {
      expect(e.actor).toHaveProperty("email");
    });
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
      actions.includes("sensitive_data_preprocessed") &&
      actions.includes("secondary_assessment_triggered") &&
      actions.includes("secondary_assessment_completed") &&
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
