import { Router } from "express";
import { z } from "zod";
import { parseCsvFilter, parseQueryDate } from "./helpers/queryParsing.js";
import {
  getAppealsReport,
  getAnalyticsCohortsReport,
  getAnalyticsSemanticModel,
  getAnalyticsTrendsReport,
  getCompletionReport,
  getCompletionLearnerReport,
  getMcqQualityReport,
  getManualReviewQueueReport,
  getModuleLearnersReport,
  getPassRatesReport,
  getReportingDataQualityReport,
  getRecertificationStatusReport,
  toCsv,
  type ReportFilters,
} from "../modules/reporting/index.js";
import { runRecertificationReminderSchedule } from "../modules/certification/index.js";
import { getCourseLearnerReport, getCourseReport } from "../modules/course/index.js";

const reportsRouter = Router();

const reportQuerySchema = z.object({
  moduleId: z.string().trim().min(1).optional(),
  courseId: z.string().trim().min(1).optional(),
  status: z.string().trim().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  orgUnit: z.string().trim().min(1).optional(),
});

const detailQuerySchema = reportQuerySchema.extend({
  selectedModuleId: z.string().trim().min(1).optional(),
  selectedCourseId: z.string().trim().min(1).optional(),
});

const exportQuerySchema = reportQuerySchema.extend({
  type: z.enum([
    "completion",
    "pass-rates",
    "manual-review-queue",
    "appeals",
    "mcq-quality",
    "recertification",
    "analytics-trends",
    "analytics-cohorts",
    // v1.2.24 (#358): nye scoped learner-level eksporter. module-summary er essentially
    // completion men eksponert under nytt navn for konsistens med course-summary. Course-
    // eksportene krever courseId-filter (returnerer tom CSV uten).
    "module-summary",
    "module-learners",
    "course-summary",
    "course-learners",
  ]),
  format: z.literal("csv"),
});

const reminderRunQuerySchema = z.object({
  asOf: z.string().trim().optional(),
});
const trendQuerySchema = z.object({
  granularity: z.enum(["day", "week", "month"]).optional(),
});
const cohortQuerySchema = z.object({
  cohortBy: z.enum(["month", "department"]).optional(),
});

reportsRouter.get("/courses", async (request, response, next) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  try {
    const report = await getCourseReport(filters, request.context?.locale ?? "nb");
    response.json(report);
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/courses/details", async (request, response, next) => {
  const filters = parseReportFilters(request.query);
  const parsed = detailQuerySchema.safeParse(request.query);
  if (!filters || !parsed.success || !parsed.data.selectedCourseId) {
    response.status(400).json({ error: "validation_error", message: "A selectedCourseId is required." });
    return;
  }

  try {
    const report = await getCourseLearnerReport(
      parsed.data.selectedCourseId,
      filters,
      request.context?.locale ?? "nb",
    );
    response.json(report);
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/completion", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getCompletionReport(filters);
  response.json(report);
});

reportsRouter.get("/completion/details", async (request, response, next) => {
  const filters = parseReportFilters(request.query);
  const parsed = detailQuerySchema.safeParse(request.query);
  if (!filters || !parsed.success || !parsed.data.selectedModuleId) {
    response.status(400).json({ error: "validation_error", message: "A selectedModuleId is required." });
    return;
  }

  try {
    const report = await getCompletionLearnerReport(
      filters,
      parsed.data.selectedModuleId,
      request.context?.locale ?? "nb",
    );
    response.json(report);
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/pass-rates", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getPassRatesReport(filters);
  response.json(report);
});

reportsRouter.get("/manual-review-queue", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getManualReviewQueueReport(filters);
  response.json(report);
});

reportsRouter.get("/appeals", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getAppealsReport(filters);
  response.json(report);
});

reportsRouter.get("/mcq-quality", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getMcqQualityReport(filters);
  response.json(report);
});

reportsRouter.get("/recertification", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getRecertificationStatusReport(filters);
  response.json(report);
});

reportsRouter.get("/analytics/semantic-model", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getAnalyticsSemanticModel(filters);
  response.json(report);
});

reportsRouter.get("/analytics/trends", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }
  const parsed = trendQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const report = await getAnalyticsTrendsReport(filters, {
    granularity: parsed.data.granularity,
  });
  response.json(report);
});

reportsRouter.get("/analytics/cohorts", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }
  const parsed = cohortQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const report = await getAnalyticsCohortsReport(filters, {
    cohortBy: parsed.data.cohortBy,
  });
  response.json(report);
});

reportsRouter.get("/analytics/data-quality", async (request, response) => {
  const filters = parseReportFilters(request.query);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  const report = await getReportingDataQualityReport(filters);
  response.json(report);
});

reportsRouter.post("/recertification/reminders/run", async (request, response) => {
  const roles = request.context?.roles ?? [];
  if (!roles.includes("ADMINISTRATOR") && !roles.includes("SUBJECT_MATTER_OWNER")) {
    response.status(403).json({ error: "forbidden", message: "Only administrators can run recertification reminders." });
    return;
  }

  const parsed = reminderRunQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const asOf = parsed.data.asOf ? parseQueryDate(parsed.data.asOf, false) : null;
  if (parsed.data.asOf && !asOf) {
    response.status(400).json({ error: "validation_error", message: "Invalid asOf date." });
    return;
  }

  const result = await runRecertificationReminderSchedule({
    asOf: asOf ?? undefined,
  });
  response.json({ run: result });
});

reportsRouter.get("/export", async (request, response) => {
  const parsed = exportQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const filters = parseReportFilters(parsed.data);
  if (!filters) {
    response.status(400).json({ error: "validation_error", message: "Invalid report query filters." });
    return;
  }

  let rows: Array<Record<string, unknown>>;
  let filenameBase = parsed.data.type;

  if (parsed.data.type === "completion") {
    rows = (await getCompletionReport(filters)).rows;
  } else if (parsed.data.type === "pass-rates") {
    rows = (await getPassRatesReport(filters)).rows;
  } else if (parsed.data.type === "manual-review-queue") {
    rows = (await getManualReviewQueueReport(filters)).rows;
  } else if (parsed.data.type === "mcq-quality") {
    rows = (await getMcqQualityReport(filters)).rows;
  } else if (parsed.data.type === "recertification") {
    rows = (await getRecertificationStatusReport(filters)).rows;
  } else if (parsed.data.type === "analytics-trends") {
    rows = (await getAnalyticsTrendsReport(filters)).rows;
  } else if (parsed.data.type === "analytics-cohorts") {
    rows = (await getAnalyticsCohortsReport(filters)).rows;
  } else if (parsed.data.type === "module-summary") {
    // v1.2.24 (#358): alias for completion (én rad per modul, aggregert).
    rows = (await getCompletionReport(filters)).rows;
  } else if (parsed.data.type === "module-learners") {
    // v1.2.24 (#358): learner-level på tvers av moduler i aktive filters. Bruker
    // getModuleLearnersReport som tolererer manglende moduleId-filter.
    rows = (await getModuleLearnersReport(filters)).rows;
  } else if (parsed.data.type === "course-summary") {
    // v1.2.24 (#358): aggregert per kurs. Eksisterende getCourseReport flatset for CSV —
    // moduleBreakdown serialiseres som komma-separert liste i én kolonne for å holde
    // CSV-format flatt. Kunder som vil ha modul-detaljer bruker module-summary i tillegg.
    const courseReport = await getCourseReport({
      courseId: filters.courseId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      orgUnit: filters.orgUnit,
    });
    rows = courseReport.rows.map((row) => ({
      scopeType: "course" as const,
      courseId: row.courseId,
      courseTitle: row.courseTitle,
      enrolledParticipants: row.enrolledParticipants,
      completedParticipants: row.completedParticipants,
      completionRate: row.completionRate,
      moduleCount: row.moduleBreakdown.length,
    }));
  } else if (parsed.data.type === "course-learners") {
    // v1.2.24 (#358): course-learners krever courseId-filter (én rad per learner per
    // kurs). Uten courseId returnerer vi tom CSV — alternativet hadde vært å iterere
    // alle kurs, men det blir potensielt N+1 queries og er ikke spec'd ennå.
    if (!filters.courseId) {
      rows = [];
    } else {
      const courseLearnerReport = await getCourseLearnerReport(filters.courseId, {
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        orgUnit: filters.orgUnit,
      });
      rows = courseLearnerReport.rows.map((row) => ({
        scopeType: "course" as const,
        courseId: courseLearnerReport.selectedCourseId,
        ...row,
      }));
    }
  } else {
    rows = (await getAppealsReport(filters)).rows;
  }

  const csv = toCsv(rows);
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
  response.status(200).send(csv);
});

function parseReportFilters(input: unknown): ReportFilters | null {
  const parsed = reportQuerySchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }

  const dateFrom = parseQueryDate(parsed.data.dateFrom, false);
  const dateTo = parseQueryDate(parsed.data.dateTo, true);
  if ((parsed.data.dateFrom && !dateFrom) || (parsed.data.dateTo && !dateTo)) {
    return null;
  }

  return {
    moduleId: parsed.data.moduleId,
    courseId: parsed.data.courseId,
    statuses: parseStatuses(parsed.data.status),
    dateFrom: dateFrom ?? undefined,
    dateTo: dateTo ?? undefined,
    orgUnit: parsed.data.orgUnit,
  };
}

function parseStatuses(input?: string) {
  const values = parseCsvFilter(input);
  return values.length > 0 ? values : undefined;
}

export { reportsRouter };
