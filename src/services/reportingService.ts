// Re-export facade — implementation has been split into sub-modules under ./reporting/
// This file exists for backwards compatibility with all existing imports.

export type { ReportFilters } from "./reporting/types.js";

export { toCsv } from "./reporting/csvExport.js";

export {
  getCompletionReport,
  getPassRatesReport,
} from "./reporting/completionReport.js";

export {
  getManualReviewQueueReport,
  getAppealsReport,
  getRecertificationStatusReport,
} from "./reporting/reviewAppealReport.js";

export {
  getMcqQualityReport,
  getAnalyticsSemanticModel,
  getAnalyticsTrendsReport,
  getAnalyticsCohortsReport,
} from "./reporting/mcqSemanticReport.js";

export { getReportingDataQualityReport } from "./reporting/dataQualityReport.js";
