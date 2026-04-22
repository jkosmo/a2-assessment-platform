import { Router } from "express";
import {
  createModule,
  updateModuleTitle,
  createBenchmarkExampleVersion,
  createMcqSetVersion,
  createModuleVersion,
  deleteModule,
  getModuleContentBundle,
  listAdminModules,
  listArchivedModules,
  listLibraryModules,
  createPromptTemplateVersion,
  createRubricVersion,
  publishModuleVersion,
  unpublishModule,
  archiveModule,
  restoreModule,
  adminContentRepository,
} from "../modules/adminContent/index.js";
import {
  moduleCreateBodySchema,
  moduleTitleUpdateBodySchema,
  rubricBodySchema,
  promptTemplateBodySchema,
  mcqSetBodySchema,
  moduleVersionBodySchema,
  benchmarkExampleVersionBodySchema,
  moduleDraftGenerationBodySchema,
  moduleDraftLocalizationBodySchema,
  moduleDraftRevisionBodySchema,
  mcqGenerationBodySchema,
  mcqLocalizationBodySchema,
  mcqRevisionBodySchema,
  sourceMaterialUploadBodySchema,
  parseRequest,
  parseOptionalDate,
} from "../modules/adminContent/adminContentSchemas.js";
import {
  generateModuleDraft,
  localizeModuleDraft,
  localizeMcqQuestions,
  generateMcqQuestions,
  reviseModuleDraft,
  reviseMcqQuestions,
} from "../modules/adminContent/llmContentGenerationService.js";
import {
  submitParseJob,
  getParsedResult,
} from "../clients/parserWorkerClient.js";
import {
  toCreateModuleInput,
  toCreatePromptTemplateVersionInput,
  toCreateMcqSetVersionInput,
  toCreateModuleVersionInput,
} from "../modules/adminContent/adminContentMapper.js";
import { adminCoursesRouter } from "./adminCourses.js";
import { generateLimiter } from "../middleware/rateLimiting.js";
import { ForbiddenError, NotFoundError, AppError } from "../errors/AppError.js";

const adminContentRouter = Router();

async function assertModuleOwnership(moduleId: string, actorId: string, roles: string[]) {
  if (roles.includes("ADMINISTRATOR")) return;
  const module = await adminContentRepository.findModuleOwner(moduleId);
  if (!module) throw new NotFoundError("Module");
  if (module.createdById === null) {
    throw new ForbiddenError("This module was created before ownership tracking. Only an ADMINISTRATOR can modify it.", "legacy_module");
  }
  if (module.createdById !== actorId) {
    throw new ForbiddenError("You can only modify modules you created.", "module_ownership");
  }
}

adminContentRouter.use("/courses", adminCoursesRouter);

adminContentRouter.post("/modules", async (request, response) => {
  const { data, error } = parseRequest(moduleCreateBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  const validFrom = parseOptionalDate(data.validFrom);
  const validTo = parseOptionalDate(data.validTo);
  if ((data.validFrom && !validFrom) || (data.validTo && !validTo)) {
    response.status(400).json({
      error: "validation_error",
      message: "validFrom/validTo must be valid ISO date or datetime values.",
    });
    return;
  }

  try {
    const module = await createModule(
      toCreateModuleInput(data, validFrom ?? undefined, validTo ?? undefined, request.context?.userId),
    );
    response.status(201).json({ module });
  } catch (error) {
    response.status(400).json({ error: "create_module_failed", message: "Could not create module." });
  }
});

adminContentRouter.get("/modules/library", async (request, response) => {
  const locale = (request.query.locale as string) || request.context?.locale || "en-GB";
  try {
    const modules = await listLibraryModules(locale as Parameters<typeof listLibraryModules>[0]);
    response.json({ modules });
  } catch {
    response.status(500).json({ error: "list_library_failed" });
  }
});

adminContentRouter.get("/modules", async (request, response) => {
  const modules = await listAdminModules(request.context?.locale ?? "en-GB");
  response.json({ modules });
});

adminContentRouter.patch("/modules/:moduleId/title", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const { data, error } = parseRequest(moduleTitleUpdateBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }
  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const module = await updateModuleTitle(request.params.moduleId, data.title, actorId);
    response.json({ module });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    response.status(400).json({ error: "update_title_failed", message: "Could not update module title." });
  }
});

adminContentRouter.delete("/modules/:moduleId", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const courseCount = await adminContentRepository.countModuleCourses(request.params.moduleId);
    if (courseCount > 0) {
      response.status(409).json({
        error: "module_in_use",
        message: `Cannot delete module: it is used in ${courseCount} course(s). Remove it from all courses first.`,
        courseCount,
      });
      return;
    }
    const deletedModule = await deleteModule(request.params.moduleId, actorId);
    response.json({ deletedModule });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    response.status(400).json({ error: "delete_module_failed", message: "Could not delete module." });
  }
});

adminContentRouter.get("/modules/:moduleId/export", async (request, response) => {
  try {
    const moduleExport = await getModuleContentBundle(request.params.moduleId);
    response.json({ moduleExport });
  } catch (error) {
    response.status(404).json({ error: "module_export_failed", message: "Could not export module." });
  }
});

adminContentRouter.post("/modules/:moduleId/rubric-versions", async (request, response) => {
  const { data, error } = parseRequest(rubricBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const rubricVersion = await createRubricVersion({
      moduleId: request.params.moduleId,
      criteria: data.criteria,
      scalingRule: data.scalingRule,
      passRule: data.passRule,
      active: data.active ?? true,
    });
    response.status(201).json({ rubricVersion });
  } catch (error) {
    response.status(400).json({ error: "create_rubric_version_failed", message: "Could not create rubric version." });
  }
});

adminContentRouter.post("/modules/:moduleId/prompt-template-versions", async (request, response) => {
  const { data, error } = parseRequest(promptTemplateBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const promptTemplateVersion = await createPromptTemplateVersion(
      toCreatePromptTemplateVersionInput(data, request.params.moduleId),
    );
    response.status(201).json({ promptTemplateVersion });
  } catch (error) {
    response.status(400).json({ error: "create_prompt_template_version_failed", message: "Could not create prompt template version." });
  }
});

adminContentRouter.post("/modules/:moduleId/mcq-set-versions", async (request, response) => {
  const { data, error } = parseRequest(mcqSetBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const mcqSetVersion = await createMcqSetVersion(
      toCreateMcqSetVersionInput(data, request.params.moduleId),
    );
    response.status(201).json({ mcqSetVersion });
  } catch (error) {
    response.status(400).json({ error: "create_mcq_set_version_failed", message: "Could not create MCQ set version." });
  }
});

adminContentRouter.post("/modules/:moduleId/module-versions", async (request, response) => {
  const { data, error } = parseRequest(moduleVersionBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const moduleVersion = await createModuleVersion(
      toCreateModuleVersionInput(data, request.params.moduleId),
    );
    response.status(201).json({ moduleVersion });
  } catch (error) {
    response.status(400).json({ error: "create_module_version_failed", message: "Could not create module version." });
  }
});

adminContentRouter.post("/modules/:moduleId/benchmark-example-versions", async (request, response) => {
  const { data, error } = parseRequest(benchmarkExampleVersionBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const benchmarkExampleVersion = await createBenchmarkExampleVersion({
      moduleId: request.params.moduleId,
      basePromptTemplateVersionId: data.basePromptTemplateVersionId,
      linkedModuleVersionId: data.linkedModuleVersionId,
      examples: data.examples,
      active: data.active ?? true,
      actorId,
    });
    response.status(201).json({ benchmarkExampleVersion });
  } catch (error) {
    response.status(400).json({ error: "create_benchmark_example_version_failed", message: "Could not create benchmark example version." });
  }
});

adminContentRouter.post("/modules/:moduleId/module-versions/:moduleVersionId/publish", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const moduleVersion = await publishModuleVersion(
      request.params.moduleId,
      request.params.moduleVersionId,
      actorId,
    );
    response.json({ moduleVersion });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    response.status(400).json({ error: "publish_module_version_failed", message: "Could not publish module version." });
  }
});

adminContentRouter.post("/modules/:moduleId/unpublish", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const result = await unpublishModule(request.params.moduleId, actorId);
    response.json({ moduleId: result.moduleId, previousActiveVersionId: result.previousActiveVersionId });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Could not unpublish module.";
    response.status(400).json({ error: "unpublish_module_failed", message });
  }
});

// ---------------------------------------------------------------------------
// Module archive / restore
// ---------------------------------------------------------------------------

adminContentRouter.get("/modules/archive", async (request, response) => {
  const locale = (request.query.locale as string) || "en-GB";
  const search = request.query.search as string | undefined;

  try {
    const modules = await listArchivedModules(locale as Parameters<typeof listArchivedModules>[0], search);
    response.json({ modules });
  } catch {
    response.status(500).json({ error: "list_archive_failed" });
  }
});

adminContentRouter.post("/modules/:moduleId/archive", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const result = await archiveModule(request.params.moduleId, actorId);
    response.json({ moduleId: result.id, archivedAt: result.archivedAt });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Could not archive module.";
    response.status(400).json({ error: "archive_module_failed", message });
  }
});

adminContentRouter.post("/modules/:moduleId/restore", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const result = await restoreModule(request.params.moduleId, actorId);
    response.json({ moduleId: result.id });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Could not restore module.";
    response.status(400).json({ error: "restore_module_failed", message });
  }
});

// ---------------------------------------------------------------------------
// LLM content generation
// ---------------------------------------------------------------------------

adminContentRouter.post("/source-material/extract", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(sourceMaterialUploadBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const jobId = await submitParseJob(data);
    response.status(202).json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "source_material_extract_failed", message });
  }
});

adminContentRouter.get("/source-material/extract/:jobId", generateLimiter, async (request, response) => {
  try {
    const result = await getParsedResult(request.params.jobId as string);
    if (!result) {
      response.status(404).json({ error: "job_not_found" });
      return;
    }
    response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "source_material_extract_failed", message });
  }
});

adminContentRouter.post("/generate/module-draft", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(moduleDraftGenerationBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const draft = await generateModuleDraft({
      ...data,
      generationMode: data.generationMode ?? "ordinary",
    });
    response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
  }
});

adminContentRouter.post("/generate/module-draft/revise", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(moduleDraftRevisionBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const draft = await reviseModuleDraft(data);
    response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
  }
});

adminContentRouter.post("/generate/module-draft/localize", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(moduleDraftLocalizationBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const draft = await localizeModuleDraft(data);
    response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
  }
});

adminContentRouter.post("/generate/mcq", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(mcqGenerationBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const result = await generateMcqQuestions({
      ...data,
      generationMode: data.generationMode ?? "ordinary",
      questionCount: data.questionCount ?? 10,
      optionCount: data.optionCount ?? 4,
    });
    response.json({ questions: result.questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
  }
});

adminContentRouter.post("/generate/mcq/revise", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(mcqRevisionBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const result = await reviseMcqQuestions({
      ...data,
      questionCount: data.questionCount ?? data.questions.length,
      optionCount: data.optionCount ?? Math.max(...data.questions.map((question) => question.options.length)),
    });
    response.json({ questions: result.questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
  }
});

adminContentRouter.post("/generate/mcq/localize", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(mcqLocalizationBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const result = await localizeMcqQuestions(data);
    response.json({ questions: result.questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
  }
});

export { adminContentRouter };
