import { Router } from "express";
import { z } from "zod";
import {
  listModules,
  getModuleById,
  getActiveModuleVersion,
} from "../modules/module/index.js";
import { startMcqAttempt, submitMcqAttempt } from "../modules/assessment/index.js";
import { getCompletedSubmissionStatuses } from "../modules/module/index.js";
import { t } from "../i18n/messages.js";
import { hasAnyRole, CONTENT_AUTHORS } from "../auth/roleSets.js";
import { mcqSubmitLimiter } from "../middleware/rateLimiting.js";
import { requestLocale } from "../i18n/requestLocale.js";

const modulesRouter = Router();
// #952: `includeCompleted` er fjernet. Den fantes bare for den frittstående modul-lista i
// deltakerkonsollet, og den flaten er borte — deltakeren når moduler gjennom «Mine kurs».
const modulesListQuerySchema = z.object({
  adminFacing: z.string().trim().optional(),
});

/**
 * #1140 etappe 1: `?courseId=` er kurset modulen åpnes fra. Det bestemmer versjonen når leseren har modulen i det kurset
 * (participantModuleVersion.ts). En verdi som ikke er en id, regnes som utelatt: da gjelder reserven, og lista svarer som før.
 */
function openedCourseId(query: unknown): string | undefined {
  const value = (query as { courseId?: unknown } | undefined)?.courseId;
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : undefined;
}
const mcqStartQuerySchema = z.object({
  submissionId: z.string().min(1),
});
const mcqSubmitBodySchema = z.object({
  submissionId: z.string().min(1),
  attemptId: z.string().min(1),
  // #1077: ett valg (`selectedAnswer`), flere («velg alle som stemmer», `selectedAnswers`) eller alle i
  // deltakerens rekkefølge («sett i riktig rekkefølge», `orderedAnswers`, leveranse 2). Hvilket
  // spørsmålet skal ha, avgjøres av typen ved rettingen; her bare at svaret har nøyaktig én av formene.
  // ⚠️ Leveranse 2a glemte denne ruta: tjenesten tok imot rekkefølgen, men ruta avviste den før den kom
  // dit (funnet av stage-testen — testene gikk utenom ruta).
  responses: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedAnswer: z.string().min(1).optional(),
      selectedAnswers: z.array(z.string().min(1)).max(20).optional(),
      orderedAnswers: z.array(z.string().min(1)).max(20).optional(),
      // Leveranse 3: det deltakeren skrev i lukka («fyll inn»). Tomt er lov — et ubesvart spørsmål er galt,
      // ikke en ugyldig innlevering.
      textAnswer: z.string().max(200).optional(),
    }).refine((item) => [item.selectedAnswer, item.selectedAnswers, item.orderedAnswers, item.textAnswer].filter((v) => v !== undefined).length === 1, {
      message: "Each response has exactly one of selectedAnswer, selectedAnswers, orderedAnswers or textAnswer.",
    }),
  ).refine((items) => {
    const ids = items.map(i => i.questionId);
    return new Set(ids).size === ids.length;
  }, {
    message: "Duplicate question IDs are not allowed in MCQ submissions.",
  }),
});

modulesRouter.get("/", async (request, response) => {
  const parsed = modulesListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const roles = request.context?.roles ?? [];
  const userId = request.context?.userId;
  const locale = requestLocale(request);
  const adminFacingRequested = parsed.data.adminFacing === "true";
  const hasElevatedRole = hasAnyRole(roles, CONTENT_AUTHORS);
  const participantFacing = adminFacingRequested && hasElevatedRole ? false : true;
  // #1140: deltakervendt lesing får versjonen kursene til leseren viser (participantModuleVersion.ts).
  const modules = await listModules(roles, userId, locale, {
    participantFacing,
    groupIds: request.context?.principal?.groupIds,
    courseId: openedCourseId(request.query),
  });

  response.json({
    modules,
    filters: {
      completedSubmissionStatuses: getCompletedSubmissionStatuses(),
    },
  });
});

// 2.141.0 (produkteier 2026-11-07): `GET /completed` er fjernet. Profilen var eneste leser, og «Beståtte moduler»
// kommer nå med `GET /api/me/stats`. `/completed` treffer derfor `/:moduleId` og gir 404.

modulesRouter.get("/:moduleId", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const locale = requestLocale(request);
  const moduleId = request.params.moduleId as string;
  const module = await getModuleById(moduleId, roles, locale, {
    participantFacing: true,
    userId: request.context?.userId,
    groupIds: request.context?.principal?.groupIds,
    courseId: openedCourseId(request.query),
  });

  if (!module) {
    response.status(404).json({ error: "not_found", message: t(locale, "module_not_found") });
    return;
  }

  response.json({ module });
});

modulesRouter.get("/:moduleId/active-version", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const locale = requestLocale(request);
  const moduleId = request.params.moduleId as string;
  const activeVersion = await getActiveModuleVersion(moduleId, roles, locale, {
    participantFacing: true,
    userId: request.context?.userId,
    groupIds: request.context?.principal?.groupIds,
    courseId: openedCourseId(request.query),
  });

  if (!activeVersion) {
    response
      .status(404)
      .json({ error: "not_found", message: t(locale, "module_not_found") });
    return;
  }

  response.json({ activeVersion });
});

modulesRouter.get("/:moduleId/mcq/start", async (request, response, next) => {
  const userId = request.context?.userId;
  const moduleId = request.params.moduleId as string;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = mcqStartQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const locale = requestLocale(request);
    const result = await startMcqAttempt(moduleId, parsed.data.submissionId, userId, locale);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

modulesRouter.post("/:moduleId/mcq/submit", mcqSubmitLimiter, async (request, response, next) => {
  const userId = request.context?.userId;
  const moduleId = request.params.moduleId as string;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = mcqSubmitBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const result = await submitMcqAttempt({
      moduleId,
      userId,
      ...parsed.data,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { modulesRouter };
