import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantAHeaders = {
  "x-user-id": "report-participant-a",
  "x-user-email": "report.participant.a@company.com",
  "x-user-name": "Report Participant A",
  "x-user-department": "Engineering",
  "x-user-roles": "PARTICIPANT",
};

const participantBHeaders = {
  "x-user-id": "report-participant-b",
  "x-user-email": "report.participant.b@company.com",
  "x-user-name": "Report Participant B",
  "x-user-department": "HR",
  "x-user-roles": "PARTICIPANT",
};

const reportReaderHeaders = {
  "x-user-id": "report-reader-1",
  "x-user-email": "report.reader@company.com",
  "x-user-name": "Report Reader",
  "x-user-roles": "REPORT_READER",
};

const appealHandlerHeaders = {
  "x-user-id": "report-appeal-1",
  "x-user-email": "report.appeal@company.com",
  "x-user-name": "Report Appeal Handler",
  "x-user-roles": "APPEAL_HANDLER",
};

describe("MVP reporting endpoints", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("provides completion/pass-rate/manual-review/appeals reports with filter support and csv export", async () => {
    const modulesResponse = await request(app).get("/api/modules").set(participantAHeaders);
    expect(modulesResponse.status).toBe(200);
    const seedModule = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }
    const moduleId = seedModule.id;

    const completedSubmissionId = await createSubmissionAndAssessment({
      moduleId,
      headers: participantAHeaders,
      responseJson: {
        response: "A normal practical submission with no sensitive data indicators.",
        reflection: "I validated responses and improved prompt quality iteratively.",
        promptExcerpt: "Summarize findings in a clear professional style.",
      },
    });

    const underReviewSubmissionId = await createSubmissionAndAssessment({
      moduleId,
      headers: participantBHeaders,
      responseJson: {
        response: "Contains sensitive client data snippets for manual routing.",
        reflection: "This should route to manual review due to sensitive data concerns.",
        promptExcerpt: "Assess policy risk and route for review if uncertain.",
      },
    });

    const createAppealResponse = await request(app)
      .post(`/api/submissions/${completedSubmissionId}/appeals`)
      .set(participantAHeaders)
      .send({
        appealReason: "Requesting second review for certification outcome.",
      });
    expect(createAppealResponse.status).toBe(201);
    const appealId = createAppealResponse.body.appeal.id as string;

    const createOpenAppealResponse = await request(app)
      .post(`/api/submissions/${underReviewSubmissionId}/appeals`)
      .set(participantBHeaders)
      .send({
        appealReason: "Open appeal used for overdue SLA visibility checks.",
      });
    expect(createOpenAppealResponse.status).toBe(201);
    const openAppealId = createOpenAppealResponse.body.appeal.id as string;

    await prisma.appeal.update({
      where: { id: openAppealId },
      data: {
        createdAt: new Date(Date.now() - 96 * 60 * 60 * 1000),
      },
    });

    const claimAppealResponse = await request(app)
      .post(`/api/appeals/${appealId}/claim`)
      .set(appealHandlerHeaders);
    expect(claimAppealResponse.status).toBe(200);

    const resolveAppealResponse = await request(app)
      .post(`/api/appeals/${appealId}/resolve`)
      .set(appealHandlerHeaders)
      .send({
        passFailTotal: true,
        decisionReason: "Appeal resolved and decision confirmed after second review.",
        resolutionNote: "Confirmed based on complete evidence package.",
      });
    expect(resolveAppealResponse.status).toBe(200);

    const completionResponse = await request(app)
      .get(`/api/reports/completion?moduleId=${encodeURIComponent(moduleId)}&orgUnit=Engineering`)
      .set(reportReaderHeaders);
    expect(completionResponse.status).toBe(200);
    expect(completionResponse.body.rows.length).toBeGreaterThan(0);
    expect(completionResponse.body.totals.totalSubmissions).toBeGreaterThanOrEqual(1);
    expect(completionResponse.body.rows[0].moduleId).toBe(moduleId);

    const passRatesResponse = await request(app)
      .get(`/api/reports/pass-rates?moduleId=${encodeURIComponent(moduleId)}`)
      .set(reportReaderHeaders);
    expect(passRatesResponse.status).toBe(200);
    expect(passRatesResponse.body.totals.decisionCount).toBeGreaterThanOrEqual(1);
    expect(passRatesResponse.body.totals.passCount + passRatesResponse.body.totals.failCount).toBe(
      passRatesResponse.body.totals.decisionCount,
    );

    const manualReviewQueueResponse = await request(app)
      .get("/api/reports/manual-review-queue?status=OPEN")
      .set(reportReaderHeaders);
    expect(manualReviewQueueResponse.status).toBe(200);
    expect(
      (manualReviewQueueResponse.body.rows as Array<{ submissionId: string }>).some(
        (row) => row.submissionId === underReviewSubmissionId,
      ),
    ).toBe(true);

    const appealsReportResponse = await request(app)
      .get("/api/reports/appeals")
      .set(reportReaderHeaders);
    expect(appealsReportResponse.status).toBe(200);
    expect(
      (appealsReportResponse.body.rows as Array<{ appealId: string }>).some((row) => row.appealId === appealId),
    ).toBe(true);
    expect(appealsReportResponse.body.totals.overdueAppeals).toBeGreaterThanOrEqual(1);
    const overdueRow = (
      appealsReportResponse.body.rows as Array<{
        appealId: string;
        slaState: string;
        firstResponseSlaHours: number;
        firstResponseDurationHours: number | null;
        firstResponseOverdue: boolean;
        claimedAt: string | null;
      }>
    ).find((row) => row.appealId === openAppealId);
    expect(overdueRow).toBeDefined();
    expect(overdueRow?.slaState).toBe("OVERDUE");
    expect(overdueRow?.firstResponseSlaHours).toBeGreaterThan(0);
    expect(overdueRow?.firstResponseDurationHours).toBeNull();
    expect(overdueRow?.firstResponseOverdue).toBe(true);
    expect(overdueRow?.claimedAt).toBeNull();

    const mcqQualityResponse = await request(app)
      .get(`/api/reports/mcq-quality?moduleId=${encodeURIComponent(moduleId)}`)
      .set(reportReaderHeaders);
    expect(mcqQualityResponse.status).toBe(200);
    expect(mcqQualityResponse.body.reportType).toBe("mcq-quality");
    expect(mcqQualityResponse.body.rows.length).toBeGreaterThan(0);
    expect(mcqQualityResponse.body.rows[0].moduleId).toBe(moduleId);
    expect(typeof mcqQualityResponse.body.rows[0].attemptCount).toBe("number");
    expect(typeof mcqQualityResponse.body.rows[0].difficulty === "number" || mcqQualityResponse.body.rows[0].difficulty === null).toBe(true);
    expect(typeof mcqQualityResponse.body.rows[0].qualityFlags).toBe("string");

    const semanticModelResponse = await request(app)
      .get(`/api/reports/analytics/semantic-model?moduleId=${encodeURIComponent(moduleId)}`)
      .set(reportReaderHeaders);
    expect(semanticModelResponse.status).toBe(200);
    expect(semanticModelResponse.body.reportType).toBe("analytics-semantic-model");
    expect(semanticModelResponse.body.kpiDefinitions.length).toBeGreaterThan(0);
    expect(typeof semanticModelResponse.body.kpiValues.submissions_total).toBe("number");

    const trendsResponse = await request(app)
      .get(`/api/reports/analytics/trends?moduleId=${encodeURIComponent(moduleId)}&granularity=week`)
      .set(reportReaderHeaders);
    expect(trendsResponse.status).toBe(200);
    expect(trendsResponse.body.reportType).toBe("analytics-trends");
    expect(trendsResponse.body.granularity).toBe("week");
    expect(Array.isArray(trendsResponse.body.rows)).toBe(true);

    const cohortsResponse = await request(app)
      .get(`/api/reports/analytics/cohorts?moduleId=${encodeURIComponent(moduleId)}&cohortBy=department`)
      .set(reportReaderHeaders);
    expect(cohortsResponse.status).toBe(200);
    expect(cohortsResponse.body.reportType).toBe("analytics-cohorts");
    expect(cohortsResponse.body.cohortBy).toBe("department");
    expect(Array.isArray(cohortsResponse.body.rows)).toBe(true);

    const dataQualityResponse = await request(app)
      .get(`/api/reports/analytics/data-quality?moduleId=${encodeURIComponent(moduleId)}`)
      .set(reportReaderHeaders);
    expect(dataQualityResponse.status).toBe(200);
    expect(dataQualityResponse.body.reportType).toBe("analytics-data-quality");
    expect(dataQualityResponse.body.checks.length).toBeGreaterThan(0);

    const completionCsvResponse = await request(app)
      .get("/api/reports/export?type=completion&format=csv")
      .set(reportReaderHeaders);
    expect(completionCsvResponse.status).toBe(200);
    expect(completionCsvResponse.headers["content-type"]).toContain("text/csv");
    expect(completionCsvResponse.text).toContain("moduleId,moduleTitle");
    expect(completionCsvResponse.text).toContain(moduleId);

    const mcqQualityCsvResponse = await request(app)
      .get("/api/reports/export?type=mcq-quality&format=csv")
      .set(reportReaderHeaders);
    expect(mcqQualityCsvResponse.status).toBe(200);
    expect(mcqQualityCsvResponse.headers["content-type"]).toContain("text/csv");
    expect(mcqQualityCsvResponse.text).toContain("questionId,questionStem");

    const trendsCsvResponse = await request(app)
      .get("/api/reports/export?type=analytics-trends&format=csv")
      .set(reportReaderHeaders);
    expect(trendsCsvResponse.status).toBe(200);
    expect(trendsCsvResponse.headers["content-type"]).toContain("text/csv");
    expect(trendsCsvResponse.text).toContain("periodStart,submissions");

    const forbiddenResponse = await request(app).get("/api/reports/completion").set(participantAHeaders);
    expect(forbiddenResponse.status).toBe(403);
  }, 30000);
});

async function createSubmissionAndAssessment(input: {
  moduleId: string;
  headers: Record<string, string>;
  responseJson: Record<string, unknown>;
}) {
  const submissionResponse = await request(app)
    .post("/api/submissions")
    .set(input.headers)
    .send({
      moduleId: input.moduleId,
      deliveryType: "text",
      responseJson: input.responseJson,
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
