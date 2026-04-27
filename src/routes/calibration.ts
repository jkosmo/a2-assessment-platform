import { Router } from "express";
import { z } from "zod";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { SubmissionStatus } from "../db/prismaRuntime.js";
import { getParticipantConsoleRuntimeConfig } from "../config/participantConsole.js";
import { getCalibrationWorkspaceSnapshot } from "../modules/calibration/index.js";
import { publishModuleVersionWithThresholds } from "../modules/adminContent/index.js";
import { parseCsvFilter, parseQueryDate } from "./helpers/queryParsing.js";

const calibrationRouter = Router();

const calibrationQuerySchema = z.object({
  moduleId: z.string().trim().min(1),
  moduleVersionId: z.string().trim().min(1).optional(),
  status: z.string().trim().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const allowedSubmissionStatuses = new Set<SubmissionStatusType>(Object.values(SubmissionStatus));

function parseStatuses(input: string | undefined, fallback: SubmissionStatusType[]) {
  const values = parseCsvFilter(input) as SubmissionStatusType[];
  if (values.length === 0) return fallback;
  for (const status of values) {
    if (!allowedSubmissionStatuses.has(status)) return null;
  }
  return Array.from(new Set(values));
}

calibrationRouter.get("/workspace", async (request, response, next) => {
  const parsed = calibrationQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const runtimeConfig = getParticipantConsoleRuntimeConfig();
  const defaults = runtimeConfig.calibrationWorkspace.defaults;

  const statuses = parseStatuses(parsed.data.status, defaults.statuses);
  if (!statuses) {
    response.status(400).json({
      error: "validation_error",
      message: "Invalid status filter. Use comma-separated submission statuses.",
    });
    return;
  }

  const dateFrom = parseQueryDate(parsed.data.dateFrom, false);
  const dateTo = parseQueryDate(parsed.data.dateTo, true);
  if ((parsed.data.dateFrom && !dateFrom) || (parsed.data.dateTo && !dateTo)) {
    response.status(400).json({
      error: "validation_error",
      message: "Invalid dateFrom/dateTo. Use ISO date/time values.",
    });
    return;
  }

  const resolvedDateFrom =
    dateFrom ??
    new Date(Date.now() - defaults.lookbackDays * 24 * 60 * 60 * 1000);
  const resolvedLimit = Math.min(parsed.data.limit ?? defaults.maxRows, defaults.maxRows);

  try {
    const body = await getCalibrationWorkspaceSnapshot({
      actorId: request.context?.userId,
      locale: request.context?.locale ?? "en-GB",
      filters: {
        moduleId: parsed.data.moduleId,
        moduleVersionId: parsed.data.moduleVersionId,
        statuses,
        dateFrom: resolvedDateFrom,
        dateTo: dateTo ?? undefined,
        limit: resolvedLimit,
      },
      signalThresholds: runtimeConfig.calibrationWorkspace.signalThresholds,
    });
    response.json(body);
  } catch (error) {
    next(error);
  }
});

const publishThresholdsBodySchema = z.object({
  moduleId: z.string().trim().min(1),
  totalMin: z.number().min(0).max(100),
});

calibrationRouter.post("/workspace/publish-thresholds", async (request, response, next) => {
  const roles: string[] = (request.context?.roles as string[] | undefined) ?? [];
  const isAllowed =
    roles.includes("ADMINISTRATOR") || roles.includes("SUBJECT_MATTER_OWNER");

  if (!isAllowed) {
    response.status(403).json({ error: "forbidden", message: "Only ADMINISTRATOR or SUBJECT_MATTER_OWNER may publish thresholds." });
    return;
  }

  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = publishThresholdsBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const published = await publishModuleVersionWithThresholds({
      moduleId: parsed.data.moduleId,
      totalMin: parsed.data.totalMin,
      actorId,
    });
    response.status(200).json({ moduleVersion: published });
  } catch (error) {
    next(error);
  }
});

export { calibrationRouter };
