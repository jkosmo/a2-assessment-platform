import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { getReportingAnalyticsConfig } from "../../config/reportingAnalytics.js";
import { reportingRepository } from "../../repositories/reportingRepository.js";
import { normalizeFilters, round2 } from "./csvExport.js";
import type { ReportFilters } from "./types.js";

export async function getReportingDataQualityReport(filters: ReportFilters) {
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

  const submissions = await reportingRepository.findSubmissionsForDataQuality(where);

  const completedSubmissions = submissions.filter((submission) => submission.submissionStatus === SubmissionStatus.COMPLETED);
  const missingDecisionCount = completedSubmissions.filter((submission) => !submission.decisions[0]).length;
  const decisionWithoutEvaluationCount = submissions.filter(
    (submission) => submission.decisions[0] && !submission.llmEvaluations[0],
  ).length;

  const missingDecisionRate =
    completedSubmissions.length > 0 ? round2(missingDecisionCount / completedSubmissions.length) : 0;
  const decisionWithoutEvaluationRate =
    submissions.length > 0 ? round2(decisionWithoutEvaluationCount / submissions.length) : 0;

  const checks = [
    {
      id: "missing_decision_on_completed_submission",
      severity: missingDecisionRate > analyticsConfig.dataQuality.maxMissingDecisionRate ? "error" : "ok",
      value: missingDecisionRate,
      threshold: analyticsConfig.dataQuality.maxMissingDecisionRate,
      count: missingDecisionCount,
    },
    {
      id: "decision_without_llm_evaluation",
      severity:
        decisionWithoutEvaluationRate > analyticsConfig.dataQuality.maxDecisionWithoutEvaluationRate ? "error" : "ok",
      value: decisionWithoutEvaluationRate,
      threshold: analyticsConfig.dataQuality.maxDecisionWithoutEvaluationRate,
      count: decisionWithoutEvaluationCount,
    },
  ];

  return {
    reportType: "analytics-data-quality",
    filters: normalizeFilters(filters),
    checks,
    totals: {
      submissionCount: submissions.length,
      completedSubmissionCount: completedSubmissions.length,
      failedCheckCount: checks.filter((check) => check.severity === "error").length,
    },
  };
}
