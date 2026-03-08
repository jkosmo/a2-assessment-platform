import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { collectAppealSlaMonitorSnapshot } from "../src/services/appealSlaMonitorService.js";

const participantAHeaders = {
  "x-user-id": "appeal-sla-participant-a",
  "x-user-email": "appeal.sla.participant.a@company.com",
  "x-user-name": "Appeal SLA Participant A",
  "x-user-department": "Engineering",
  "x-user-roles": "PARTICIPANT",
};

const participantBHeaders = {
  "x-user-id": "appeal-sla-participant-b",
  "x-user-email": "appeal.sla.participant.b@company.com",
  "x-user-name": "Appeal SLA Participant B",
  "x-user-department": "Engineering",
  "x-user-roles": "PARTICIPANT",
};

const appealHandlerHeaders = {
  "x-user-id": "appeal-sla-handler-1",
  "x-user-email": "appeal.sla.handler@company.com",
  "x-user-name": "Appeal SLA Handler",
  "x-user-roles": "APPEAL_HANDLER",
};

describe("Appeal SLA monitor snapshot", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("classifies backlog and threshold breach for overdue appeals", async () => {
    const modulesResponse = await request(app).get("/api/modules").set(participantAHeaders);
    expect(modulesResponse.status).toBe(200);
    const seedModule = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }
    const moduleId = seedModule.id;

    const overdueSubmissionId = await createSubmissionAndAssessment({
      moduleId,
      headers: participantAHeaders,
      rawText: "Appeal SLA overdue case content.",
      reflectionText: "Overdue case should exceed first-response SLA.",
      promptExcerpt: "Assess and classify this case.",
    });

    const createOverdueAppealResponse = await request(app)
      .post(`/api/submissions/${overdueSubmissionId}/appeals`)
      .set(participantAHeaders)
      .send({
        appealReason: "This overdue appeal is used for monitor classification checks.",
      });
    expect(createOverdueAppealResponse.status).toBe(201);
    const overdueAppealId = createOverdueAppealResponse.body.appeal.id as string;
    const now = new Date();

    await prisma.appeal.update({
      where: { id: overdueAppealId },
      data: {
        createdAt: new Date(now.getTime() - 96 * 60 * 60 * 1000),
      },
    });

    const atRiskSubmissionId = await createSubmissionAndAssessment({
      moduleId,
      headers: participantBHeaders,
      rawText: "Appeal SLA at-risk case content.",
      reflectionText: "Claimed case near resolution SLA.",
      promptExcerpt: "Assess and classify this second case.",
    });

    const createAtRiskAppealResponse = await request(app)
      .post(`/api/submissions/${atRiskSubmissionId}/appeals`)
      .set(participantBHeaders)
      .send({
        appealReason: "This at-risk appeal is used for monitor classification checks.",
      });
    expect(createAtRiskAppealResponse.status).toBe(201);
    const atRiskAppealId = createAtRiskAppealResponse.body.appeal.id as string;

    const claimAtRiskAppealResponse = await request(app)
      .post(`/api/appeals/${atRiskAppealId}/claim`)
      .set(appealHandlerHeaders);
    expect(claimAtRiskAppealResponse.status).toBe(200);

    await prisma.appeal.update({
      where: { id: atRiskAppealId },
      data: {
        createdAt: new Date(now.getTime() - 60 * 60 * 60 * 1000),
        claimedAt: new Date(now.getTime() - 59 * 60 * 60 * 1000),
      },
    });

    const snapshot = await collectAppealSlaMonitorSnapshot(now);
    expect(snapshot.overdueAppeals).toBeGreaterThanOrEqual(1);
    expect(snapshot.atRiskAppeals).toBeGreaterThanOrEqual(1);
    expect(snapshot.openAppeals + snapshot.inReviewAppeals).toBeGreaterThanOrEqual(2);
    expect(snapshot.thresholdBreached).toBe(snapshot.overdueAppeals >= snapshot.overdueThreshold);
    expect(snapshot.oldestOverdueHours).not.toBeNull();
    expect(snapshot.checkedAt).toBe(now.toISOString());
  }, 20000);
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
