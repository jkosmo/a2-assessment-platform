import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantAHeaders = {
  "x-user-id": "participant-history-a",
  "x-user-email": "participant.history.a@company.com",
  "x-user-name": "Participant History A",
  "x-user-department": "Engineering",
  "x-user-roles": "PARTICIPANT",
};

const participantBHeaders = {
  "x-user-id": "participant-history-b",
  "x-user-email": "participant.history.b@company.com",
  "x-user-name": "Participant History B",
  "x-user-department": "Finance",
  "x-user-roles": "PARTICIPANT",
};

describe("MVP participant result and history", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns score components + guidance and keeps history scoped to current user", async () => {
    const modulesResponse = await request(app).get("/api/modules").set(participantAHeaders);
    expect(modulesResponse.status).toBe(200);
    const moduleId = modulesResponse.body.modules[0].id as string;

    const completedSubmissionId = await createSubmissionAndAssessment({
      moduleId,
      headers: participantAHeaders,
      rawText: "Normal submission without sensitive marker.",
      reflectionText: "I validated output and improved prompt structure.",
      promptExcerpt: "Summarize and improve the text quality.",
    });

    const underReviewSubmissionId = await createSubmissionAndAssessment({
      moduleId,
      headers: participantAHeaders,
      rawText: "Contains sensitive client data marker for manual review.",
      reflectionText: "Potentially sensitive handling should trigger manual review.",
      promptExcerpt: "Evaluate risk and route if uncertain.",
    });

    await createSubmissionAndAssessment({
      moduleId,
      headers: participantBHeaders,
      rawText: "Other user's submission.",
      reflectionText: "Other user reflection for history isolation test.",
      promptExcerpt: "Other user prompt excerpt.",
    });

    const completedResultResponse = await request(app)
      .get(`/api/submissions/${completedSubmissionId}/result`)
      .set(participantAHeaders);
    expect(completedResultResponse.status).toBe(200);
    expect(["COMPLETED", "UNDER_REVIEW", "PROCESSING", "SUBMITTED"]).toContain(completedResultResponse.body.status);
    expect(typeof completedResultResponse.body.statusExplanation).toBe("string");
    expect(completedResultResponse.body.scoreComponents.totalScore).not.toBeNull();
    expect(completedResultResponse.body.participantGuidance.improvementAdvice.length).toBeGreaterThan(0);

    const underReviewResultResponse = await request(app)
      .get(`/api/submissions/${underReviewSubmissionId}/result`)
      .set(participantAHeaders);
    expect(underReviewResultResponse.status).toBe(200);
    expect(underReviewResultResponse.body.status).toBe("UNDER_REVIEW");
    expect(underReviewResultResponse.body.statusExplanation).toContain("manual review");

    const ownHistoryResponse = await request(app).get("/api/submissions/history").set(participantAHeaders);
    expect(ownHistoryResponse.status).toBe(200);
    const ownSubmissionIds = (ownHistoryResponse.body.history as Array<{ submissionId: string }>).map(
      (item) => item.submissionId,
    );
    expect(ownSubmissionIds).toContain(completedSubmissionId);
    expect(ownSubmissionIds).toContain(underReviewSubmissionId);

    const otherHistoryResponse = await request(app).get("/api/submissions/history").set(participantBHeaders);
    expect(otherHistoryResponse.status).toBe(200);
    const otherSubmissionIds = (otherHistoryResponse.body.history as Array<{ submissionId: string }>).map(
      (item) => item.submissionId,
    );
    expect(otherSubmissionIds).not.toContain(completedSubmissionId);
    expect(otherSubmissionIds).not.toContain(underReviewSubmissionId);
  });
});

async function createSubmissionAndAssessment(input: {
  moduleId: string;
  headers: Record<string, string>;
  rawText: string;
  reflectionText: string;
  promptExcerpt: string;
}) {
  const submissionResponse = await request(app)
    .post("/api/submissions")
    .set(input.headers)
    .send({
      moduleId: input.moduleId,
      deliveryType: "text",
      rawText: input.rawText,
      reflectionText: input.reflectionText,
      promptExcerpt: input.promptExcerpt,
      responsibilityAcknowledged: true,
    });
  expect(submissionResponse.status).toBe(201);
  const submissionId = submissionResponse.body.submission.id as string;

  const startMcqResponse = await request(app)
    .get(`/api/modules/${input.moduleId}/mcq/start`)
    .query({ submissionId })
    .set(input.headers);
  expect(startMcqResponse.status).toBe(200);

  const responses = startMcqResponse.body.questions.map((question: { id: string; stem: string }) => ({
    questionId: question.id,
    selectedAnswer:
      question.stem === "What is the recommended model ownership boundary?"
        ? "Backend owns final decision"
        : "Prompt versions and thresholds",
  }));

  const submitMcqResponse = await request(app)
    .post(`/api/modules/${input.moduleId}/mcq/submit`)
    .set(input.headers)
    .send({
      submissionId,
      attemptId: startMcqResponse.body.attemptId,
      responses,
    });
  expect(submitMcqResponse.status).toBe(200);

  const runAssessmentResponse = await request(app)
    .post(`/api/assessments/${submissionId}/run`)
    .set(input.headers)
    .send({ sync: true });
  expect(runAssessmentResponse.status).toBe(202);

  return submissionId;
}
