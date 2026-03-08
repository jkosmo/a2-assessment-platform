import { Router } from "express";
import { z } from "zod";
import { listModules, getModuleById, getActiveModuleVersion } from "../repositories/moduleRepository.js";
import { startMcqAttempt, submitMcqAttempt } from "../services/mcqService.js";
import { t } from "../i18n/messages.js";

const modulesRouter = Router();
const mcqStartQuerySchema = z.object({
  submissionId: z.string().min(1),
});
const mcqSubmitBodySchema = z.object({
  submissionId: z.string().min(1),
  attemptId: z.string().min(1),
  responses: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedAnswer: z.string().min(1),
    }),
  ),
});

modulesRouter.get("/", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const userId = request.context?.userId;
  const modules = await listModules(roles, userId);
  response.json({ modules });
});

modulesRouter.get("/:moduleId", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const module = await getModuleById(request.params.moduleId, roles);
  const locale = request.context?.locale ?? "en-GB";

  if (!module) {
    response.status(404).json({ error: "not_found", message: t(locale, "module_not_found") });
    return;
  }

  response.json({ module });
});

modulesRouter.get("/:moduleId/active-version", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const activeVersion = await getActiveModuleVersion(request.params.moduleId, roles);
  const locale = request.context?.locale ?? "en-GB";

  if (!activeVersion) {
    response
      .status(404)
      .json({ error: "not_found", message: t(locale, "module_not_found") });
    return;
  }

  response.json({ activeVersion });
});

modulesRouter.get("/:moduleId/mcq/start", async (request, response) => {
  const userId = request.context?.userId;
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
    const result = await startMcqAttempt(request.params.moduleId, parsed.data.submissionId, userId);
    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: "mcq_start_failed",
      message: error instanceof Error ? error.message : "Could not start MCQ attempt.",
    });
  }
});

modulesRouter.post("/:moduleId/mcq/submit", async (request, response) => {
  const userId = request.context?.userId;
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
      moduleId: request.params.moduleId,
      userId,
      ...parsed.data,
    });
    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: "mcq_submit_failed",
      message: error instanceof Error ? error.message : "Could not submit MCQ attempt.",
    });
  }
});

export { modulesRouter };
