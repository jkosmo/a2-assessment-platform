import { Router } from "express";
import { z } from "zod";
import {
  getAppealsReport,
  getCompletionReport,
  getMcqQualityReport,
  getManualReviewQueueReport,
  getPassRatesReport,
  toCsv,
  type ReportFilters,
} from "../services/reportingService.js";

const reportsRouter = Router();

const reportQuerySchema = z.object({
  moduleId: z.string().trim().min(1).optional(),
  status: z.string().trim().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  orgUnit: z.string().trim().min(1).optional(),
});

const exportQuerySchema = reportQuerySchema.extend({
  type: z.enum(["completion", "pass-rates", "manual-review-queue", "appeals", "mcq-quality"]),
  format: z.literal("csv"),
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

  const dateFrom = parseDate(parsed.data.dateFrom, false);
  const dateTo = parseDate(parsed.data.dateTo, true);
  if ((parsed.data.dateFrom && !dateFrom) || (parsed.data.dateTo && !dateTo)) {
    return null;
  }

  return {
    moduleId: parsed.data.moduleId,
    statuses: parseStatuses(parsed.data.status),
    dateFrom: dateFrom ?? undefined,
    dateTo: dateTo ?? undefined,
    orgUnit: parsed.data.orgUnit,
  };
}

function parseStatuses(input?: string) {
  if (!input) {
    return undefined;
  }
  const statuses = input
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
  return statuses.length > 0 ? statuses : undefined;
}

function parseDate(input: string | undefined, inclusiveEndOfDay: boolean) {
  if (!input) {
    return null;
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (inclusiveEndOfDay && input.length <= 10) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
}

export { reportsRouter };
