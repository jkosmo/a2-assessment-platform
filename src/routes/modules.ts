import { Router } from "express";
import { z } from "zod";
import {
  listModules,
  getModuleById,
  getActiveModuleVersion,
  listCompletedModulesForUser,
} from "../repositories/moduleRepository.js";
import { startMcqAttempt, submitMcqAttempt } from "../services/mcqService.js";
import {
  getCompletedSubmissionStatuses,
  resolveCompletedHistoryLimit,
  resolveIncludeCompletedForAvailableModules,
} from "../services/moduleCompletionPolicyService.js";
import { t } from "../i18n/messages.js";
import { mcqSubmitLimiter } from "../middleware/rateLimiting.js";

const modulesRouter = Router();
const modulesListQuerySchema = z.object({
  includeCompleted: z.string().trim().optional(),
  adminFacing: z.string().trim().optional(),
});
const completedModulesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});
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
  const parsed = modulesListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  let requestedIncludeCompleted: boolean | undefined;
  if (parsed.data.includeCompleted !== undefined) {
    const normalized = parsed.data.includeCompleted.toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      response.status(400).json({
        error: "validation_error",
        message: "includeCompleted must be true or false.",
      });
      return;
    }
    requestedIncludeCompleted = normalized === "true";
  }

  const includeCompleted = resolveIncludeCompletedForAvailableModules(requestedIncludeCompleted);
  const roles = request.context?.roles ?? [];
  const userId = request.context?.userId;
  const locale = request.context?.locale ?? "en-GB";
  const adminFacingRequested = parsed.data.adminFacing === "true";
  const hasElevatedRole = roles.some((r) => r === "ADMINISTRATOR" || r === "SUBJECT_MATTER_OWNER");
  const participantFacing = adminFacingRequested && hasElevatedRole ? false : true;
  const modules = await listModules(roles, userId, locale, {
    includeCompleted,
    participantFacing,
  });
  response.json({
    modules,
    filters: {
      includeCompleted,
      completedSubmissionStatuses: getCompletedSubmissionStatuses(),
    },
  });
});

modulesRouter.get("/completed", async (request, response) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = completedModulesQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const locale = request.context?.locale ?? "en-GB";
  const limit = resolveCompletedHistoryLimit(parsed.data.limit);
  const modules = await listCompletedModulesForUser(userId, locale, limit);
  response.json({
    modules,
    filters: {
      limit,
      completedSubmissionStatuses: getCompletedSubmissionStatuses(),
    },
  });
});

modulesRouter.get("/:moduleId", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const locale = request.context?.locale ?? "en-GB";
  const moduleId = request.params.moduleId as string;
  const module = await getModuleById(moduleId, roles, locale, { participantFacing: true });

  if (!module) {
    response.status(404).json({ error: "not_found", message: t(locale, "module_not_found") });
    return;
  }

  response.json({ module });
});

modulesRouter.get("/:moduleId/active-version", async (request, response) => {
  const roles = request.context?.roles ?? [];
  const locale = request.context?.locale ?? "en-GB";
  const moduleId = request.params.moduleId as string;
  const activeVersion = await getActiveModuleVersion(moduleId, roles, locale, { participantFacing: true });

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
    const locale = request.context?.locale ?? "en-GB";
    const result = await startMcqAttempt(moduleId, parsed.data.submissionId, userId, locale);
    response.json(result);
  } catch (error) {
    response.status(400).json({
      error: "mcq_start_failed",
      message: error instanceof Error ? error.message : "Could not start MCQ attempt.",
    });
  }
});

modulesRouter.post("/:moduleId/mcq/submit", mcqSubmitLimiter, async (request, response) => {
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
    response.status(400).json({
      error: "mcq_submit_failed",
      message: error instanceof Error ? error.message : "Could not submit MCQ attempt.",
    });
  }
});

export { modulesRouter };
