import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionStatus } from "../../src/db/prismaRuntime.js";

const findSubmissionsForPassRatesReport = vi.fn();
const findMcqResponsesForQualityReport = vi.fn();

vi.mock("../../src/repositories/reportingRepository.js", () => ({
  reportingRepository: {
    findSubmissionsForPassRatesReport,
    findMcqResponsesForQualityReport,
  },
}));

vi.mock("../../src/config/assessmentRules.js", () => ({
  getAssessmentRules: () => ({
    mcqQuality: {
      minAttemptCount: 3,
      difficultyMin: 0.3,
      difficultyMax: 0.9,
      discriminationMin: 0.15,
    },
    recertification: {
      dueSoonDays: 30,
    },
  }),
}));

vi.mock("../../src/config/reportingAnalytics.js", () => ({
  getReportingAnalyticsConfig: () => ({
    kpiDefinitions: [],
    trends: { defaultGranularity: "week" },
    cohorts: { defaultCohortBy: "month" },
    dataQuality: {
      maxMissingDecisionRate: 0.05,
      maxDecisionWithoutEvaluationRate: 0.05,
    },
  }),
}));

vi.mock("../../src/services/recertificationService.js", () => ({
  deriveRecertificationStatus: vi.fn(),
}));

describe("reporting service", () => {
  beforeEach(() => {
    findSubmissionsForPassRatesReport.mockReset();
    findMcqResponsesForQualityReport.mockReset();
  });

  it("filters pass-rates rows by requested outcome and computes module totals", async () => {
    findSubmissionsForPassRatesReport.mockResolvedValue([
      {
        id: "submission-1",
        submissionStatus: SubmissionStatus.COMPLETED,
        module: { id: "module-1", title: "Module One" },
        decisions: [{ passFailTotal: true }],
      },
      {
        id: "submission-2",
        submissionStatus: SubmissionStatus.COMPLETED,
        module: { id: "module-1", title: "Module One" },
        decisions: [{ passFailTotal: false }],
      },
      {
        id: "submission-3",
        submissionStatus: SubmissionStatus.UNDER_REVIEW,
        module: { id: "module-1", title: "Module One" },
        decisions: [],
      },
    ]);

    const { getPassRatesReport } = await import("../../src/services/reportingService.js");

    const report = await getPassRatesReport({
      moduleId: "module-1",
      statuses: ["PASS"],
    });

    expect(findSubmissionsForPassRatesReport).toHaveBeenCalledWith({
      moduleId: "module-1",
    });
    expect(report.reportType).toBe("pass-rates");
    expect(report.rows).toEqual([
      {
        moduleId: "module-1",
        moduleTitle: "Module One",
        totalSubmissions: 1,
        decisionCount: 1,
        passCount: 1,
        failCount: 0,
        underReviewCount: 0,
        passRate: 1,
      },
    ]);
    expect(report.totals).toEqual({
      totalSubmissions: 1,
      decisionCount: 1,
      passCount: 1,
      failCount: 0,
      underReviewCount: 0,
      passRate: 1,
    });
  });

  it("flags MCQ quality issues for easy and low-discrimination questions", async () => {
    findMcqResponsesForQualityReport.mockResolvedValue([
      {
        questionId: "question-1",
        isCorrect: true,
        question: {
          id: "question-1",
          stem: "What is governance?",
          module: { id: "module-1", title: "Module One" },
        },
        mcqAttempt: { id: "attempt-1", percentScore: 20 },
      },
      {
        questionId: "question-1",
        isCorrect: true,
        question: {
          id: "question-1",
          stem: "What is governance?",
          module: { id: "module-1", title: "Module One" },
        },
        mcqAttempt: { id: "attempt-2", percentScore: 50 },
      },
      {
        questionId: "question-1",
        isCorrect: true,
        question: {
          id: "question-1",
          stem: "What is governance?",
          module: { id: "module-1", title: "Module One" },
        },
        mcqAttempt: { id: "attempt-3", percentScore: 90 },
      },
    ]);

    const { getMcqQualityReport } = await import("../../src/services/reportingService.js");

    const report = await getMcqQualityReport({
      moduleId: "module-1",
      statuses: ["FLAGGED"],
    });

    expect(findMcqResponsesForQualityReport).toHaveBeenCalledWith({
      mcqAttempt: {
        completedAt: { not: null },
        submission: {
          moduleId: "module-1",
        },
      },
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      moduleId: "module-1",
      questionId: "question-1",
      attemptCount: 3,
      correctCount: 3,
      difficulty: 1,
      flaggedLowQuality: true,
    });
    expect(report.rows[0].qualityFlags).toContain("TOO_EASY");
    expect(report.rows[0].qualityFlags).toContain("LOW_DISCRIMINATION");
    expect(report.totals).toEqual({
      questionCount: 1,
      flaggedCount: 1,
      tooDifficultCount: 0,
      tooEasyCount: 1,
      lowDiscriminationCount: 1,
      insufficientSampleCount: 0,
    });
  });

  it("exports CSV with escaping for commas, quotes, and null values", async () => {
    const { toCsv } = await import("../../src/services/reportingService.js");

    const csv = toCsv(
      [
        {
          moduleId: "module-1",
          title: 'One, "Quoted" Module',
          note: null,
        },
      ],
      ["moduleId", "title", "note"],
    );

    expect(csv).toBe('moduleId,title,note\nmodule-1,"One, ""Quoted"" Module",');
  });
});
