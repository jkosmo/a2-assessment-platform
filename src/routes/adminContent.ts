import { Router } from "express";
import {
  createModule,
  createBenchmarkExampleVersion,
  createMcqSetVersion,
  createModuleVersion,
  deleteModule,
  getModuleContentBundle,
  listAdminModules,
  listArchivedModules,
  createPromptTemplateVersion,
  createRubricVersion,
  publishModuleVersion,
  unpublishModule,
  archiveModule,
  restoreModule,
} from "../modules/adminContent/index.js";
import {
  moduleCreateBodySchema,
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
  extractSourceMaterialText,
  SourceMaterialExtractionError,
  SourceMaterialTooLargeError,
  UnsupportedSourceMaterialFormatError,
} from "../modules/adminContent/sourceMaterialExtractionService.js";
import {
  toCreateModuleInput,
  toCreatePromptTemplateVersionInput,
  toCreateMcqSetVersionInput,
  toCreateModuleVersionInput,
} from "../modules/adminContent/adminContentMapper.js";
import { adminCoursesRouter } from "./adminCourses.js";

const adminContentRouter = Router();

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

adminContentRouter.get("/modules", async (request, response) => {
  const modules = await listAdminModules(request.context?.locale ?? "en-GB");
  response.json({ modules });
});

adminContentRouter.delete("/modules/:moduleId", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const deletedModule = await deleteModule(request.params.moduleId, actorId);
    response.json({ deletedModule });
  } catch (error) {
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
    const moduleVersion = await publishModuleVersion(
      request.params.moduleId,
      request.params.moduleVersionId,
      actorId,
    );
    response.json({ moduleVersion });
  } catch (error) {
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
    const result = await unpublishModule(request.params.moduleId, actorId);
    response.json({ moduleId: result.moduleId, previousActiveVersionId: result.previousActiveVersionId });
  } catch (error) {
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
    const result = await archiveModule(request.params.moduleId, actorId);
    response.json({ moduleId: result.id, archivedAt: result.archivedAt });
  } catch (error) {
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
    const result = await restoreModule(request.params.moduleId, actorId);
    response.json({ moduleId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not restore module.";
    response.status(400).json({ error: "restore_module_failed", message });
  }
});

// ---------------------------------------------------------------------------
// LLM content generation
// ---------------------------------------------------------------------------

adminContentRouter.post("/source-material/extract", async (request, response) => {
  const { data, error } = parseRequest(sourceMaterialUploadBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const result = await extractSourceMaterialText(data);
    response.json(result);
  } catch (err) {
    if (err instanceof UnsupportedSourceMaterialFormatError) {
      response.status(400).json({
        error: "unsupported_file_type",
        message: "Supported file formats: .txt, .md, .pdf, .docx, .doc, .pptx, .ppt, .rtf, .odt, .odp, .ods.",
      });
      return;
    }
    if (err instanceof SourceMaterialTooLargeError) {
      response.status(400).json({
        error: "file_too_large",
        message: "The uploaded file is too large. Use a file up to 2 MB.",
      });
      return;
    }
    if (err instanceof SourceMaterialExtractionError) {
      response.status(400).json({ error: "source_material_extract_failed", message: err.message });
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "source_material_extract_failed", message });
  }
});

adminContentRouter.post("/generate/module-draft", async (request, response) => {
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

adminContentRouter.post("/generate/module-draft/revise", async (request, response) => {
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

adminContentRouter.post("/generate/module-draft/localize", async (request, response) => {
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

adminContentRouter.post("/generate/mcq", async (request, response) => {
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

adminContentRouter.post("/generate/mcq/revise", async (request, response) => {
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

adminContentRouter.post("/generate/mcq/localize", async (request, response) => {
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
