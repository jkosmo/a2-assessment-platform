import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { resetRateLimitState } from "../src/middleware/rateLimiting.js";

const participantHeaders = {
  "x-user-id": "rate-limit-participant",
  "x-user-email": "rate.limit.participant@company.com",
  "x-user-name": "Rate Limit Participant",
  "x-user-roles": "PARTICIPANT",
};

describe("API rate limiting", () => {
  beforeEach(async () => {
    await resetRateLimitState();
  });

  afterEach(async () => {
    await resetRateLimitState();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns 429 and Retry-After after repeated assessment queue requests", async () => {
    const modulesResponse = await request(app).get("/api/modules?includeCompleted=true").set(participantHeaders);
    expect(modulesResponse.status).toBe(200);
    const seedModule = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }

    const submissionResponse = await request(app)
      .post("/api/submissions")
      .set(participantHeaders)
      .send({
        moduleId: seedModule.id,
        deliveryType: "text",
        responseJson: {
          response: "Rate limit test content for queued assessments.",
          reflection: "This submission is used to verify request throttling.",
          promptExcerpt: "Queue the assessment repeatedly.",
        },
      });
    expect(submissionResponse.status).toBe(201);
    const submissionId = submissionResponse.body.submission.id as string;

    const startMcqResponse = await request(app)
      .get(`/api/modules/${seedModule.id}/mcq/start`)
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
      .post(`/api/modules/${seedModule.id}/mcq/submit`)
      .set(participantHeaders)
      .send({
        submissionId,
        attemptId: startMcqResponse.body.attemptId,
        responses,
      });
    expect(submitMcqResponse.status).toBe(200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post(`/api/assessments/${submissionId}/run`)
        .set(participantHeaders)
        .send({});
      expect(response.status).toBe(202);
    }

    const rateLimitedResponse = await request(app)
      .post(`/api/assessments/${submissionId}/run`)
      .set(participantHeaders)
      .send({});

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.headers["retry-after"]).toBeDefined();
    expect(rateLimitedResponse.body).toMatchObject({
      error: "rate_limited",
      message: "Too many assessment requests. Retry in 60 seconds.",
    });

    // #983: sekundene som DATA, ikke bare i den engelske setningen og i en HTTP-header.
    //
    // ⚠️ Uten denne raden måler klienttesten bare seg selv: den mater inn et tall og sjekker at
    // setningen kommer ut på riktig språk, men ingenting sa at serveren faktisk SENDER tallet.
    //
    // ⚠️ Merk at det ekte tallet ikke er 60. Det regnes fra når vinduet nullstilles, så den
    // engelske setningen løy allerede om det — den sa alltid 60.
    const retryAfterSeconds = rateLimitedResponse.body.details?.retryAfterSeconds;
    expect(typeof retryAfterSeconds).toBe("number");
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBe(Number(rateLimitedResponse.headers["retry-after"]));
  }, 20000);
});
