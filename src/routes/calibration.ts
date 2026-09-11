import { Router } from "express";
import { z } from "zod";
import type { SubmissionStatus as SubmissionStatusType } from "@prisma/client";
import { SubmissionStatus } from "../db/prismaRuntime.js";
import { getParticipantConsoleRuntimeConfig } from "../config/participantConsole.js";
import { hasAnyRole, CONTENT_AUTHORS } from "../auth/roleSets.js";
import { getCalibrationWorkspaceSnapshot } from "../modules/calibration/index.js";
import { publishModuleVersionWithThresholds } from "../modules/adminContent/index.js";
import { assertContentOwnership } from "../modules/content/contentOwnershipService.js";
import { parseCsvFilter, parseQueryDate } from "./helpers/queryParsing.js";

const calibrationRouter = Router();

const allowedSubmissionStatuses = new Set<SubmissionStatusType>(Object.values(SubmissionStatus));

// #999: FILTERKRAVENE HØRER I SKJEMAET, IKKE ETTER DET.
//
// ⚠️ De to kontrollene under svarte tidligere med en håndbygget `{ error: "validation_error",
// message }` UTEN `issues`. `api-error.js` tolker fraværet av `issues` som «en domeneregel sa nei»
// og viser serverens setning ordrett — engelsk prosa i et norsk grensesnitt. Men dette er
// formvalidering: forespørselen har feil form, ingen har brutt en regel om innholdet. Flyttet hit
// bærer avslaget `issues`, får den generiske overskriften, og detaljene havner i detaljfeltet.
//
// ⚠️ Tom streng slipper gjennom for datoene, som før: `parseQueryDate("")` gir `null`, og
// kontrollen etterpå var `parsed.data.dateFrom && !dateFrom` — altså «tom betyr ikke satt».
const erGyldigDatoParameter = (verdi: string) =>
  verdi.length === 0 || !Number.isNaN(new Date(verdi).getTime());

const calibrationQuerySchema = z.object({
  moduleId: z.string().trim().min(1),
  moduleVersionId: z.string().trim().min(1).optional(),
  status: z
    .string()
    .trim()
    .optional()
    .refine(
      (verdi) =>
        parseCsvFilter(verdi).every((s) => allowedSubmissionStatuses.has(s as SubmissionStatusType)),
      { message: "Use comma-separated submission statuses." },
    ),
  dateFrom: z.string().trim().optional().refine((v) => v === undefined || erGyldigDatoParameter(v), {
    message: "Use ISO date/time values.",
  }),
  dateTo: z.string().trim().optional().refine((v) => v === undefined || erGyldigDatoParameter(v), {
    message: "Use ISO date/time values.",
  }),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// Skjemaet har allerede avvist ukjente statuser, så denne oversetter bare — den kan ikke feile.
function parseStatuses(input: string | undefined, fallback: SubmissionStatusType[]) {
  const values = parseCsvFilter(input) as SubmissionStatusType[];
  if (values.length === 0) return fallback;
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

  // #999: begge avslagene ligger nå i `calibrationQuerySchema` over og bærer `issues`.
  const statuses = parseStatuses(parsed.data.status, defaults.statuses);
  const dateFrom = parseQueryDate(parsed.data.dateFrom, false);
  const dateTo = parseQueryDate(parsed.data.dateTo, true);

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
  mcqMinPercent: z.number().min(0).max(100).optional(),
  practicalMinPercent: z.number().min(0).max(100).optional(),
});

calibrationRouter.post("/workspace/publish-thresholds", async (request, response, next) => {
  const roles = request.context?.roles ?? [];
  const isAllowed = hasAnyRole(roles, CONTENT_AUTHORS);

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
    // #787 slice 4b: publishing thresholds cuts a new module version, so it's a module-owner action.
    // The role gate above only proves SMO/ADMIN; this enforces ownership of THIS module (audit finding:
    // an SMO could previously publish thresholds for modules they don't own).
    await assertContentOwnership({ contentType: "MODULE", contentId: parsed.data.moduleId, actorUserId: actorId, roles });
    const published = await publishModuleVersionWithThresholds({
      moduleId: parsed.data.moduleId,
      totalMin: parsed.data.totalMin,
      mcqMinPercent: parsed.data.mcqMinPercent,
      practicalMinPercent: parsed.data.practicalMinPercent,
      actorId,
    });
    response.status(200).json({ moduleVersion: published });
  } catch (error) {
    next(error);
  }
});

export { calibrationRouter };
