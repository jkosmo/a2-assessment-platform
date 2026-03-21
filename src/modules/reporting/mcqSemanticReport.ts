import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { localizeContentText } from "../../i18n/content.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { getReportingAnalyticsConfig } from "../../config/reportingAnalytics.js";
import { reportingRepository } from "../../repositories/reportingRepository.js";
import { normalizeFilters, round2 } from "./csvExport.js";
import type { ReportFilters } from "./types.js";

type McqQualityRow = {
  moduleId: string;
  moduleTitle: string;
  questionId: string;
  questionStem: string;
  attemptCount: number;
  correctCount: number;
  difficulty: number | null;
  discrimination: number | null;
  flaggedLowQuality: boolean;
  qualityFlags: string;
};

type AnalyticsTrendRow = {
  periodStart: string;
  submissions: number;
  completed: number;
  underReview: number;
  decisionCount: number;
  passCount: number;
  failCount: number;
  completionRate: number;
  passRate: number | null;
};

type AnalyticsCohortRow = {
  cohort: string;
  participants: number;
  submissions: number;
  completed: number;
  underReview: number;
  passCount: number;
  failCount: number;
  completionRate: number;
  passRate: number | null;
};

export async function getMcqQualityReport(filters: ReportFilters) {
  const rules = getAssessmentRules();
  const submissionWhere = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const where = {
    mcqAttempt: {
      completedAt: { not: null },
      submission: submissionWhere,
    },
  } as const;

  const responses = await reportingRepository.findMcqResponsesForQualityReport(where);

  const perQuestion = new Map<string, {
    moduleId: string;
    moduleTitle: string;
    questionId: string;
    questionStem: string;
    responses: Array<{ isCorrect: boolean; attemptScore: number | null }>;
  }>();

  for (const response of responses) {
    const existing = perQuestion.get(response.questionId) ?? {
      moduleId: response.question.module.id,
      moduleTitle: localizeContentText("en-GB", response.question.module.title) ?? response.question.module.title,
      questionId: response.question.id,
      questionStem: response.question.stem,
      responses: [],
    };

    existing.responses.push({
      isCorrect: response.isCorrect,
      attemptScore: typeof response.mcqAttempt.percentScore === "number" ? response.mcqAttempt.percentScore : null,
    });
    perQuestion.set(response.questionId, existing);
  }

  const rows: McqQualityRow[] = Array.from(perQuestion.values()).map((entry) => {
    const attemptCount = entry.responses.length;
    const correctCount = entry.responses.filter((value) => value.isCorrect).length;
    const difficulty = attemptCount > 0 ? round2(correctCount / attemptCount) : null;

    const scoresForDiscrimination = entry.responses
      .filter((value) => typeof value.attemptScore === "number")
      .map((value) => ({
        correct: value.isCorrect ? 1 : 0,
        score: value.attemptScore as number,
      }));

    const qualityFlags: string[] = [];
    if (difficulty !== null && difficulty < rules.mcqQuality.difficultyMin) {
      qualityFlags.push("TOO_DIFFICULT");
    }
    if (difficulty !== null && difficulty > rules.mcqQuality.difficultyMax) {
      qualityFlags.push("TOO_EASY");
    }

    let discrimination: number | null = null;
    if (scoresForDiscrimination.length >= rules.mcqQuality.minAttemptCount) {
      discrimination = round2(computePointBiserial(scoresForDiscrimination));
      if (discrimination < rules.mcqQuality.discriminationMin) {
        qualityFlags.push("LOW_DISCRIMINATION");
      }
    } else {
      qualityFlags.push("INSUFFICIENT_SAMPLE");
    }

    return {
      moduleId: entry.moduleId,
      moduleTitle: entry.moduleTitle,
      questionId: entry.questionId,
      questionStem: entry.questionStem,
      attemptCount,
      correctCount,
      difficulty,
      discrimination,
      flaggedLowQuality: qualityFlags.length > 0,
      qualityFlags: qualityFlags.join("|"),
    };
  });

  const statusFilter = new Set((filters.statuses ?? []).map((value) => value.toUpperCase()));
  const filteredRows = rows.filter((row) => {
    if (statusFilter.size === 0) {
      return true;
    }
    if (statusFilter.has("FLAGGED") && row.flaggedLowQuality) {
      return true;
    }
    if (statusFilter.has("OK") && !row.flaggedLowQuality) {
      return true;
    }
    return false;
  });

  return {
    reportType: "mcq-quality",
    filters: normalizeFilters(filters),
    thresholds: {
      minAttemptCount: rules.mcqQuality.minAttemptCount,
      difficultyMin: rules.mcqQuality.difficultyMin,
      difficultyMax: rules.mcqQuality.difficultyMax,
      discriminationMin: rules.mcqQuality.discriminationMin,
    },
    totals: {
      questionCount: filteredRows.length,
      flaggedCount: filteredRows.filter((row) => row.flaggedLowQuality).length,
      tooDifficultCount: filteredRows.filter((row) => row.qualityFlags.includes("TOO_DIFFICULT")).length,
      tooEasyCount: filteredRows.filter((row) => row.qualityFlags.includes("TOO_EASY")).length,
      lowDiscriminationCount: filteredRows.filter((row) => row.qualityFlags.includes("LOW_DISCRIMINATION")).length,
      insufficientSampleCount: filteredRows.filter((row) => row.qualityFlags.includes("INSUFFICIENT_SAMPLE")).length,
    },
    rows: filteredRows,
  };
}

export async function getAnalyticsSemanticModel(filters: ReportFilters) {
  const analyticsConfig = getReportingAnalyticsConfig();
  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForAnalyticsSemanticModel(where);

  const totalSubmissions = submissions.length;
  const completedSubmissions = submissions.filter((submission) => submission.submissionStatus === SubmissionStatus.COMPLETED).length;
  const underReviewSubmissions = submissions.filter((submission) => submission.submissionStatus === SubmissionStatus.UNDER_REVIEW).length;
  const decisionCount = submissions.filter((submission) => submission.decisions[0]).length;
  const passCount = submissions.filter((submission) => submission.decisions[0]?.passFailTotal === true).length;
  const failCount = submissions.filter((submission) => submission.decisions[0]?.passFailTotal === false).length;
  const appealCount = submissions.reduce((sum, submission) => sum + submission.appeals.length, 0);

  const kpiValues = {
    submissions_total: totalSubmissions,
    completion_rate: totalSubmissions > 0 ? round2(completedSubmissions / totalSubmissions) : 0,
    pass_rate: decisionCount > 0 ? round2(passCount / decisionCount) : null,
    manual_review_rate: totalSubmissions > 0 ? round2(underReviewSubmissions / totalSubmissions) : 0,
    appeal_rate: totalSubmissions > 0 ? round2(appealCount / totalSubmissions) : 0,
  } as Record<string, number | null>;

  return {
    reportType: "analytics-semantic-model",
    filters: normalizeFilters(filters),
    kpiDefinitions: analyticsConfig.kpiDefinitions,
    kpiValues,
    totals: {
      totalSubmissions,
      completedSubmissions,
      underReviewSubmissions,
      decisionCount,
      passCount,
      failCount,
      appealCount,
    },
  };
}

export async function getAnalyticsTrendsReport(
  filters: ReportFilters,
  input?: { granularity?: "day" | "week" | "month" },
) {
  const analyticsConfig = getReportingAnalyticsConfig();
  const granularity = input?.granularity ?? analyticsConfig.trends.defaultGranularity;

  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForAnalyticsTrends(where);

  const buckets = new Map<string, AnalyticsTrendRow>();
  for (const submission of submissions) {
    const periodStart = periodKey(submission.submittedAt, granularity);
    const current = buckets.get(periodStart) ?? {
      periodStart,
      submissions: 0,
      completed: 0,
      underReview: 0,
      decisionCount: 0,
      passCount: 0,
      failCount: 0,
      completionRate: 0,
      passRate: null,
    };

    current.submissions += 1;
    if (submission.submissionStatus === SubmissionStatus.COMPLETED) {
      current.completed += 1;
    }
    if (submission.submissionStatus === SubmissionStatus.UNDER_REVIEW) {
      current.underReview += 1;
    }
    if (submission.decisions[0]) {
      current.decisionCount += 1;
      if (submission.decisions[0].passFailTotal) {
        current.passCount += 1;
      } else {
        current.failCount += 1;
      }
    }
    buckets.set(periodStart, current);
  }

  const rows = Array.from(buckets.values())
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map((row) => ({
      ...row,
      completionRate: row.submissions > 0 ? round2(row.completed / row.submissions) : 0,
      passRate: row.decisionCount > 0 ? round2(row.passCount / row.decisionCount) : null,
    }));

  return {
    reportType: "analytics-trends",
    filters: normalizeFilters(filters),
    granularity,
    rows,
  };
}

export async function getAnalyticsCohortsReport(
  filters: ReportFilters,
  input?: { cohortBy?: "month" | "department" },
) {
  const analyticsConfig = getReportingAnalyticsConfig();
  const cohortBy = input?.cohortBy ?? analyticsConfig.cohorts.defaultCohortBy;

  const where = {
    ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
    ...(filters.orgUnit ? { user: { department: filters.orgUnit } } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          submittedAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  } as const;

  const submissions = await reportingRepository.findSubmissionsForAnalyticsCohorts(where);

  const cohorts = new Map<string, AnalyticsCohortRow>();
  const cohortParticipantSets = new Map<string, Set<string>>();

  for (const submission of submissions) {
    const cohort =
      cohortBy === "department"
        ? submission.user.department ?? "UNSPECIFIED"
        : submission.submittedAt.toISOString().slice(0, 7);

    const current = cohorts.get(cohort) ?? {
      cohort,
      participants: 0,
      submissions: 0,
      completed: 0,
      underReview: 0,
      passCount: 0,
      failCount: 0,
      completionRate: 0,
      passRate: null,
    };

    current.submissions += 1;
    if (submission.submissionStatus === SubmissionStatus.COMPLETED) {
      current.completed += 1;
    }
    if (submission.submissionStatus === SubmissionStatus.UNDER_REVIEW) {
      current.underReview += 1;
    }
    if (submission.decisions[0]?.passFailTotal === true) {
      current.passCount += 1;
    }
    if (submission.decisions[0]?.passFailTotal === false) {
      current.failCount += 1;
    }

    const participants = cohortParticipantSets.get(cohort) ?? new Set<string>();
    participants.add(submission.userId);
    cohortParticipantSets.set(cohort, participants);

    cohorts.set(cohort, current);
  }

  const rows = Array.from(cohorts.values())
    .sort((a, b) => a.cohort.localeCompare(b.cohort))
    .map((row) => {
      const decisionCount = row.passCount + row.failCount;
      return {
        ...row,
        participants: cohortParticipantSets.get(row.cohort)?.size ?? 0,
        completionRate: row.submissions > 0 ? round2(row.completed / row.submissions) : 0,
        passRate: decisionCount > 0 ? round2(row.passCount / decisionCount) : null,
      };
    });

  return {
    reportType: "analytics-cohorts",
    filters: normalizeFilters(filters),
    cohortBy,
    rows,
  };
}

function computePointBiserial(values: Array<{ correct: number; score: number }>) {
  if (values.length < 2) {
    return 0;
  }

  const meanScore = values.reduce((sum, value) => sum + value.score, 0) / values.length;
  const variance =
    values.reduce((sum, value) => {
      const delta = value.score - meanScore;
      return sum + delta * delta;
    }, 0) / values.length;

  if (variance <= 0) {
    return 0;
  }

  const stdDev = Math.sqrt(variance);
  const correctGroup = values.filter((value) => value.correct === 1).map((value) => value.score);
  const incorrectGroup = values.filter((value) => value.correct === 0).map((value) => value.score);

  if (correctGroup.length === 0 || incorrectGroup.length === 0) {
    return 0;
  }

  const meanCorrect = correctGroup.reduce((sum, score) => sum + score, 0) / correctGroup.length;
  const meanIncorrect = incorrectGroup.reduce((sum, score) => sum + score, 0) / incorrectGroup.length;
  const p = correctGroup.length / values.length;
  const q = 1 - p;

  return ((meanCorrect - meanIncorrect) / stdDev) * Math.sqrt(p * q);
}

function periodKey(input: Date, granularity: "day" | "week" | "month") {
  if (granularity === "day") {
    return input.toISOString().slice(0, 10);
  }
  if (granularity === "month") {
    return input.toISOString().slice(0, 7);
  }

  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay();
  const isoWeekDay = day === 0 ? 7 : day;
  date.setUTCDate(date.getUTCDate() - (isoWeekDay - 1));
  return date.toISOString().slice(0, 10);
}
