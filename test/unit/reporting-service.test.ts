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
      difficultyMaxByLevel: { intermediate: 0.85, advanced: 0.80 },
      discriminationMin: 0.15,
      distractorPickRateMin: 0.05,
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

vi.mock("../../src/modules/certification/index.js", () => ({
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

    const { getPassRatesReport } = await import("../../src/modules/reporting/index.js");

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
    const baseQuestion = {
      id: "question-1",
      stem: "What is governance?",
      optionsJson: '["Correct answer","Wrong A","Wrong B","Wrong C"]',
      correctAnswer: "Correct answer",
      module: { id: "module-1", title: "Module One", certificationLevel: "intermediate" },
    };
    findMcqResponsesForQualityReport.mockResolvedValue([
      { questionId: "question-1", isCorrect: true, selectedAnswer: "Correct answer", question: baseQuestion, mcqAttempt: { id: "attempt-1", percentScore: 20 } },
      { questionId: "question-1", isCorrect: true, selectedAnswer: "Correct answer", question: baseQuestion, mcqAttempt: { id: "attempt-2", percentScore: 50 } },
      { questionId: "question-1", isCorrect: true, selectedAnswer: "Correct answer", question: baseQuestion, mcqAttempt: { id: "attempt-3", percentScore: 90 } },
    ]);

    const { getMcqQualityReport } = await import("../../src/modules/reporting/index.js");

    const report = await getMcqQualityReport({
      moduleId: "module-1",
      statuses: ["FLAGGED"],
    });

    expect(findMcqResponsesForQualityReport).toHaveBeenCalledWith({
      mcqAttempt: {
        completedAt: { not: null },
        submission: { moduleId: "module-1" },
      },
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      moduleId: "module-1",
      questionId: "question-1",
      certificationLevel: "intermediate",
      attemptCount: 3,
      correctCount: 3,
      difficulty: 1,
      difficultyMaxThreshold: 0.85,
      flaggedLowQuality: true,
    });
    expect(report.rows[0].qualityFlags).toContain("TOO_EASY");
    expect(report.rows[0].qualityFlags).toContain("LOW_DISCRIMINATION");
    expect(report.rows[0].distractorUsage).toHaveLength(4);
    expect(report.rows[0].distractorUsage.find((d: { option: string }) => d.option === "Correct answer")).toMatchObject({ isCorrect: true });
    expect(report.totals).toEqual({
      questionCount: 1,
      flaggedCount: 1,
      tooDifficultCount: 0,
      tooEasyCount: 1,
      lowDiscriminationCount: 1,
      insufficientSampleCount: 0,
      rarelyChosenDistractorCount: 1,
    });
  });

  it("flags RARELY_CHOSEN_DISTRACTOR when a distractor has low pick rate with sufficient sample", async () => {
    const baseQuestion = {
      id: "question-2",
      stem: "Apply the principle?",
      optionsJson: '["Right","Plausible A","Ghost option","Plausible B"]',
      correctAnswer: "Right",
      module: { id: "module-1", title: "Module One", certificationLevel: "advanced" },
    };
    // 10 attempts: 6 correct, 3 pick "Plausible A", 1 picks "Plausible B", nobody picks "Ghost option"
    const responses = [
      ...Array.from({ length: 6 }, (_, i) => ({ questionId: "question-2", isCorrect: true, selectedAnswer: "Right", question: baseQuestion, mcqAttempt: { id: `a${i}`, percentScore: 80 } })),
      ...Array.from({ length: 3 }, (_, i) => ({ questionId: "question-2", isCorrect: false, selectedAnswer: "Plausible A", question: baseQuestion, mcqAttempt: { id: `b${i}`, percentScore: 30 } })),
      { questionId: "question-2", isCorrect: false, selectedAnswer: "Plausible B", question: baseQuestion, mcqAttempt: { id: "c0", percentScore: 20 } },
    ];
    findMcqResponsesForQualityReport.mockResolvedValue(responses);

    const { getMcqQualityReport } = await import("../../src/modules/reporting/index.js");
    const report = await getMcqQualityReport({ moduleId: "module-1", statuses: ["FLAGGED"] });

    expect(report.rows[0].qualityFlags).toContain("RARELY_CHOSEN_DISTRACTOR");
    const ghost = report.rows[0].distractorUsage.find((d: { option: string }) => d.option === "Ghost option");
    expect(ghost).toMatchObject({ pickCount: 0, pickRate: 0, isCorrect: false, flaggedRarelyChosen: true });
    expect(report.totals.rarelyChosenDistractorCount).toBe(1);
  });

  it("exports CSV with escaping for commas, quotes, and null values", async () => {
    const { toCsv } = await import("../../src/modules/reporting/index.js");

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
