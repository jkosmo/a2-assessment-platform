import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
};

const reviewerHeaders = {
  "x-user-id": "reviewer-user-1",
  "x-user-email": "reviewer1@company.com",
  "x-user-name": "Platform Reviewer",
  "x-user-roles": "REVIEWER",
};

describe("MVP manual review workspace", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exposes at least one seeded pending manual review in the reviewer queue", async () => {
    const queueResponse = await request(app).get("/api/reviews?status=OPEN").set(reviewerHeaders);
    expect(queueResponse.status).toBe(200);
    expect(Array.isArray(queueResponse.body.reviews)).toBe(true);
    expect(queueResponse.body.reviews.length).toBeGreaterThan(0);
    expect(queueResponse.body.reviews[0].reviewStatus).toBe("OPEN");
    expect(queueResponse.body.reviews[0].submission?.id).toBeTruthy();
  });

  it("creates immutable override decision layer through reviewer workspace", async () => {
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
        rawText: "Submission contains sensitive client data references.",
        reflectionText: "Manual review should be triggered due to sensitive handling concerns.",
        promptExcerpt: "Assess risk and route if uncertain.",
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

    const queueResponse = await request(app).get("/api/reviews?status=OPEN").set(reviewerHeaders);
    expect(queueResponse.status).toBe(200);
    const review = (queueResponse.body.reviews as Array<{ id: string; submission: { id: string } }>).find(
      (item) => item.submission.id === submissionId,
    );
    expect(review).toBeDefined();
    const reviewId = review!.id;

    const detailResponse = await request(app).get(`/api/reviews/${reviewId}`).set(reviewerHeaders);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.review.submission.llmEvaluations.length).toBeGreaterThan(0);
    expect(detailResponse.body.review.submission.mcqAttempts.length).toBeGreaterThan(0);
    expect(detailResponse.body.review.submission.decisions.length).toBeGreaterThan(0);

    const forbiddenOverrideResponse = await request(app)
      .post(`/api/reviews/${reviewId}/override`)
      .set(participantHeaders)
      .send({
        passFailTotal: true,
        decisionReason: "Participant should not be allowed to override.",
        overrideReason: "Unauthorized attempt",
      });
    expect(forbiddenOverrideResponse.status).toBe(403);

    const claimResponse = await request(app).post(`/api/reviews/${reviewId}/claim`).set(reviewerHeaders);
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.body.review.reviewStatus).toBe("IN_REVIEW");

    const overrideResponse = await request(app)
      .post(`/api/reviews/${reviewId}/override`)
      .set(reviewerHeaders)
      .send({
        passFailTotal: false,
        decisionReason: "Manual reviewer overrode decision due to quality concerns.",
        overrideReason: "Insufficient practical depth despite automatic score.",
      });
    expect(overrideResponse.status).toBe(200);
    expect(overrideResponse.body.overrideDecision.decisionType).toBe("MANUAL_OVERRIDE");
    expect(overrideResponse.body.overrideDecision.parentDecisionId).toBeTruthy();

    const decisions = await prisma.assessmentDecision.findMany({
      where: { submissionId },
      orderBy: { finalisedAt: "desc" },
    });
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    expect(decisions[0].decisionType).toBe("MANUAL_OVERRIDE");
    expect(decisions[0].parentDecisionId).toBe(decisions[1].id);

    const resolvedReview = await prisma.manualReview.findUniqueOrThrow({ where: { id: reviewId } });
    expect(resolvedReview.reviewStatus).toBe("RESOLVED");
    expect(resolvedReview.overrideDecision).toBe("FAIL");
    expect(resolvedReview.overrideReason).toContain("Insufficient practical depth");
  });
});
