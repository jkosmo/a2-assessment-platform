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
  ensureRubricVersion,
  syncActiveRubricBlueprintHash,
  publishModuleVersion,
  unpublishModule,
  archiveModule,
  restoreModule,
  adminContentRepository,
  buildModuleExportEnvelope,
  listUnpublishedPurgeCandidates,
  purgeUnpublishedModules,
} from "../modules/adminContent/index.js";
import {
  moduleCreateBodySchema,
  moduleTitleUpdateBodySchema,
  rubricBodySchema,
  rubricEnsureBodySchema,
  rubricSyncBlueprintBodySchema,
  promptTemplateBodySchema,
  mcqSetBodySchema,
  moduleVersionBodySchema,
  benchmarkExampleVersionBodySchema,
  blueprintGenerationBodySchema,
  rubricGenerationBodySchema,
  moduleDraftGenerationBodySchema,
  moduleDraftLocalizationBodySchema,
  moduleDraftRevisionBodySchema,
  mcqGenerationBodySchema,
  mcqLocalizationBodySchema,
  mcqRevisionBodySchema,
  sourceMaterialUploadBodySchema,
  importBodySchema,
  parseRequest,
  parseOptionalDate,
} from "../modules/adminContent/adminContentSchemas.js";
import { importModuleFromEnvelope } from "../modules/adminContent/contentImportService.js";
import {
  condenseSourceMaterial,
  generateAssessmentBlueprint,
  generateModuleDraft,
  generateModuleRubric,
  localizeModuleDraft,
  localizeMcqQuestions,
  generateMcqQuestions,
  normalizeAssessmentBlueprint,
  reviseModuleDraft,
  reviseMcqQuestions,
  checkScenarioAnswerability,
} from "../modules/adminContent/llmContentGenerationService.js";
import { validateMcqDistractors, validateScenarioDraft, validateModuleVersionForPublish } from "../modules/adminContent/contentValidationService.js";
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
import { adminSectionsRouter } from "./adminSections.js";
import { generateLimiter, extractLimiter, intentLogLimiter } from "../middleware/rateLimiting.js";
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
adminContentRouter.use("/sections", adminSectionsRouter);

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

// v1.2.11: bulk-purge for "Rydd stage"-knappen i modul-bibliotek-toolbaren. Lister og
// sletter alle uplubliserte moduler (activeVersionId=null, ikke arkivert, ingen kurs/
// submissions). ADMINISTRATOR-only fordi det er en destruktiv batch-operasjon.
adminContentRouter.get("/modules/purge-unpublished/preview", async (request, response) => {
  if (!request.context?.roles?.includes("ADMINISTRATOR")) {
    response.status(403).json({ error: "forbidden", message: "Only ADMINISTRATOR can preview the bulk purge list." });
    return;
  }
  try {
    const candidates = await listUnpublishedPurgeCandidates();
    response.json({ candidates });
  } catch (error) {
    response.status(500).json({ error: "purge_preview_failed", message: error instanceof Error ? error.message : "unknown" });
  }
});

adminContentRouter.post("/modules/purge-unpublished", async (request, response) => {
  if (!request.context?.roles?.includes("ADMINISTRATOR")) {
    response.status(403).json({ error: "forbidden", message: "Only ADMINISTRATOR can purge unpublished modules." });
    return;
  }
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  // Krev typed bekreftelse "SLETT" i bodyen — beskytter mot tilfeldig POST.
  const confirmation = typeof request.body?.confirmation === "string" ? request.body.confirmation.trim() : "";
  if (confirmation !== "SLETT") {
    response.status(400).json({ error: "confirmation_required", message: "Body must include { confirmation: 'SLETT' }." });
    return;
  }
  try {
    const result = await purgeUnpublishedModules(actorId);
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: "purge_failed", message: error instanceof Error ? error.message : "unknown" });
  }
});

// v1.2.23 (#357 Phase A): instrumentering for intent-detection i Samtale-shell. Logger
// hver klassifisering med raw-input + decision så vi kan samle ekte pilot-bruker-ordbruk
// for å informere Phase B (hybrid LLM-fallback). Payload er fritt format — vi vil endre
// shape mens vi lærer hvilke felt som faktisk er nyttige.
adminContentRouter.post("/intent-log", intentLogLimiter, async (request, response) => {
  const actorId = request.context?.userId ?? "anonymous";
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const truncate = (s: unknown) => (typeof s === "string" ? s.slice(0, 500) : s);
  const record = {
    ts: new Date().toISOString(),
    actorId,
    rawInput: truncate(body.rawInput),
    intentKind: body.intentKind ?? null,
    targets: body.targets ?? null,
    locale: body.locale ?? null,
    moduleId: body.moduleId ?? null,
    hasDraft: body.hasDraft ?? null,
    hasMcq: body.hasMcq ?? null,
  };
  // Bevisst console.log — ingen DB-tabell ennå. App Service log stream / Application
  // Insights fanger structured JSON. Prefiks gjør det lett å grep-e ut.
  console.log("[intent-log]", JSON.stringify(record));
  response.status(204).end();
});

type McqSetVersionBundle = Awaited<ReturnType<typeof getModuleContentBundle>>["versions"]["mcqSetVersions"][number];

function redactMcqAnswerKeys(bundle: Awaited<ReturnType<typeof getModuleContentBundle>>) {
  const stripAnswers = (v: McqSetVersionBundle) => ({
    ...v,
    questions: v.questions.map(({ correctAnswer: _c, rationale: _r, ...rest }) => rest),
  });
  return {
    ...bundle,
    selectedConfiguration: {
      ...bundle.selectedConfiguration,
      mcqSetVersion: bundle.selectedConfiguration.mcqSetVersion
        ? stripAnswers(bundle.selectedConfiguration.mcqSetVersion)
        : null,
    },
    versions: {
      ...bundle.versions,
      mcqSetVersions: bundle.versions.mcqSetVersions.map(stripAnswers),
    },
  };
}

adminContentRouter.get("/modules/:moduleId/export", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const bundle = await getModuleContentBundle(request.params.moduleId);
    const moduleExport = request.context?.roles?.includes("ADMINISTRATOR")
      ? bundle
      : redactMcqAnswerKeys(bundle);
    response.json({ moduleExport });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    response.status(404).json({ error: "module_export_failed", message: "Could not export module." });
  }
});

// Module import from a2-content-export/v1 envelope (#433). Counterpart to
// /modules/:id/export-package. mode=createNew creates a fresh module; mode=
// replaceExisting appends a new active version to the existing targetId
// (history preserved; never silently overwrites).
adminContentRouter.post("/modules/import", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const { data, error } = parseRequest(importBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }
  if (data.payload.scope !== "module") {
    response.status(400).json({ error: "scope_mismatch", message: "Envelope scope must be 'module' for this endpoint." });
    return;
  }
  try {
    // Cast through unknown: zod-inferred OUTPUT types from the import side and the
    // schema-builder side are structurally identical but nominally unrelated when
    // they cross module boundaries via different re-export chains. Runtime payload
    // is what the schema validated.
    const envelope = data.payload as unknown as Parameters<typeof importModuleFromEnvelope>[0];
    const result = await importModuleFromEnvelope(envelope, {
      actorId,
      mode: data.mode ?? "createNew",
      targetModuleId: data.targetId,
      autoPublish: data.autoPublish,
    });
    response.status(201).json({ moduleId: result.moduleId, moduleVersionId: result.moduleVersionId });
  } catch (err) {
    if (err instanceof AppError) {
      response.status(err.httpStatus).json({ error: err.code, message: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    if (/not found/i.test(message)) {
      response.status(404).json({ error: "import_target_not_found", message });
      return;
    }
    response.status(400).json({ error: "module_import_failed", message });
  }
});

// Versioned export envelope for cross-environment transfer / file backup (#433).
// Distinct from /export above which returns the bundle for live editing in the
// admin UI. This one returns the a2-content-export/v1 envelope: a self-contained
// portable file that the matching /import endpoint can re-hydrate elsewhere.
adminContentRouter.get("/modules/:moduleId/export-package", async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const envelope = await buildModuleExportEnvelope(request.params.moduleId, {
      userId: actorId,
    });
    response.json({ envelope });
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Could not build module export envelope.";
    // Module exists but is missing content needed to build a portable envelope
    // (no active version, no rubric/prompt/MCQ). 422 surfaces an actionable
    // message to the UI; 404 is reserved for "module does not exist".
    if (/no (versions|rubric|prompt|MCQ)/i.test(message)) {
      response.status(422).json({ error: "module_not_exportable", message });
      return;
    }
    response.status(404).json({ error: "module_export_failed", message });
  }
});

adminContentRouter.post("/modules/:moduleId/rubric-versions", async (request, response) => {
  const { data, error } = parseRequest(rubricBodySchema, request.body);
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
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
    const rubricVersion = await createRubricVersion({
      moduleId: request.params.moduleId,
      criteria: data.criteria,
      scalingRule: data.scalingRule,
      active: data.active ?? true,
    });
    response.status(201).json({ rubricVersion });
  } catch (error) {
    response.status(400).json({ error: "create_rubric_version_failed", message: "Could not create rubric version." });
  }
});

// POST /modules/:moduleId/rubric-versions/ensure — idempotent auto-rubric (#447).
// Returns the module's latest RubricVersion if one exists. Otherwise generates a
// task-specific rubric via LLM (falling back to generic defaults on failure) and persists
// it as a new RubricVersion. Centralises the "auto-rubric when missing" logic that was
// previously shell-only — Avansert-save now gets the same behaviour as shell-save.
//
// Response: { rubricVersion, autoGenerated: boolean, reused: boolean }
//   - autoGenerated=true means LLM generation succeeded and produced this rubric
//   - autoGenerated=false + reused=false means LLM failed and fell back to generic defaults
//   - reused=true means an existing rubric was returned (no work done)
adminContentRouter.post("/modules/:moduleId/rubric-versions/ensure", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(rubricEnsureBodySchema, request.body);
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
    const moduleId = String(request.params.moduleId);
    await assertModuleOwnership(moduleId, actorId, request.context?.roles ?? []);
    const result = await ensureRubricVersion({
      moduleId,
      taskText: data.taskText,
      assessorExpectedContent: data.assessorExpectedContent,
      candidateTaskConstraints: data.candidateTaskConstraints,
      certificationLevel: data.certificationLevel,
      locale: data.locale,
      blueprint: normalizeAssessmentBlueprint(data.blueprint),
      force: data.force,
    });
    response.status(result.reused ? 200 : 201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "ensure_rubric_failed", message });
  }
});

// B3 (#450): POST /modules/:moduleId/rubric-versions/sync-blueprint — "Behold kriteriene".
// Updates the active rubric's stored blueprint-hash so drift-banner hides. Does NOT change
// criteria or bump versionNo. Returns { rubricVersionId, previousHash, nextHash } or 404
// when no rubric exists yet.
adminContentRouter.post("/modules/:moduleId/rubric-versions/sync-blueprint", async (request, response) => {
  const { data, error } = parseRequest(rubricSyncBlueprintBodySchema, request.body);
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
    const moduleId = String(request.params.moduleId);
    await assertModuleOwnership(moduleId, actorId, request.context?.roles ?? []);
    const result = await syncActiveRubricBlueprintHash(moduleId, data.blueprintHash);
    if (!result) {
      response.status(404).json({ error: "no_rubric_to_sync" });
      return;
    }
    response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "sync_blueprint_failed", message });
  }
});

adminContentRouter.post("/modules/:moduleId/prompt-template-versions", async (request, response) => {
  const { data, error } = parseRequest(promptTemplateBodySchema, request.body);
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
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
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

  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
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

  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    await assertModuleOwnership(request.params.moduleId, actorId, request.context?.roles ?? []);
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

    // #372: Run blueprint-aware pre-publish gate. Blocks if any blocking
    // issue surfaces; warnings are returned but do not block (the author
    // can choose to publish anyway via the existing UI flow).
    const bundle = await getModuleContentBundle(request.params.moduleId);
    const moduleVersionData = bundle.versions.moduleVersions.find(
      (v) => v.id === request.params.moduleVersionId,
    );
    if (moduleVersionData) {
      const mcqSetVersion = bundle.versions.mcqSetVersions.find(
        (v) => v.id === moduleVersionData.mcqSetVersionId,
      );
      let blueprint: unknown = null;
      const rawBlueprint = (moduleVersionData as { assessmentBlueprint?: string | null }).assessmentBlueprint;
      if (rawBlueprint && typeof rawBlueprint === "string") {
        try { blueprint = JSON.parse(rawBlueprint); } catch { blueprint = null; }
      }
      // taskText / assessorExpectedContent are LocalizedText (string OR
      // {en-GB, nb, nn} object after decode). The validator only needs a
      // representative string — pick the first non-empty locale value.
      const flattenLocalized = (value: unknown): string | null => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object") {
          const candidate = (value as Record<string, unknown>)["en-GB"]
            ?? (value as Record<string, unknown>).nb
            ?? (value as Record<string, unknown>).nn;
          return typeof candidate === "string" ? candidate : null;
        }
        return null;
      };
      const validation = validateModuleVersionForPublish({
        taskText: flattenLocalized(moduleVersionData.taskText) ?? "",
        candidateTaskConstraints: flattenLocalized(moduleVersionData.candidateTaskConstraints),
        assessorExpectedContent: flattenLocalized(moduleVersionData.assessorExpectedContent),
        blueprint: blueprint as never,
        mcqQuestionCount: mcqSetVersion?.questions?.length ?? 0,
      });
      if (!validation.valid) {
        response.status(422).json({
          error: "publish_blocked_by_validation",
          message: "Pre-publish validation found blocking issues. See `issues` for details.",
          issues: validation.issues,
        });
        return;
      }
      // Warnings still go through; surfaced in response so the UI can display them.
      const moduleVersion = await publishModuleVersion(
        request.params.moduleId,
        request.params.moduleVersionId,
        actorId,
      );
      response.json({ moduleVersion, validationWarnings: validation.issues });
      return;
    }

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

// v1.2.5: bruker extractLimiter (60/min) i stedet for generateLimiter (10/min). Multi-fil-
// flyten (Phase 2+) submitter flere filer i én batch — 10/min ble blåst gjennom raskt.
adminContentRouter.post("/source-material/extract", extractLimiter, async (request, response) => {
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

// v1.2.5: GET-poll-endepunkt har ingen dedikert rate-limit. Poll er bare in-memory job-status-
// lookup uten ekstern cost. Tidligere generateLimiter delte budsjett med LLM-generation —
// multi-fil-flyt med 30 polls/fil × 5 filer blåste gjennom 10/min på sekunder.
adminContentRouter.get("/source-material/extract/:jobId", async (request, response) => {
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

// #454 Phase 1: server-side URL fetcher. Fetches the URL, extracts main text via Mozilla
// Readability (HTML) or plain UTF-8 (text/plain), and returns it as source material.
// Synchronous since URL fetch + parse is typically <2s. SSRF-protected via DNS lookup
// against private IP ranges. Rate-limited per user (in-memory, 10/min).
adminContentRouter.post("/source-material/fetch-url", generateLimiter, async (request, response) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";
  if (!url) {
    response.status(400).json({ error: "validation_error", message: "url is required" });
    return;
  }
  // Lazy-imported so the module's deps (jsdom + readability) don't load unless used
  const { fetchUrlAsSourceMaterial, UrlFetchError, checkAndConsumeRateLimit } = await import(
    "../modules/adminContent/urlFetchService.js"
  );
  const rateCheck = checkAndConsumeRateLimit(actorId);
  if (!rateCheck.allowed) {
    const retryAfterSec = Math.ceil((rateCheck.retryAfterMs ?? 60_000) / 1000);
    response.setHeader("Retry-After", String(retryAfterSec));
    response.status(429).json({
      error: "rate_limited",
      message: `Too many URL fetches. Retry in ~${retryAfterSec}s.`,
    });
    return;
  }
  try {
    const result = await fetchUrlAsSourceMaterial(url);
    response.json(result);
  } catch (err) {
    if (err instanceof UrlFetchError) {
      // Map known error codes to appropriate HTTP statuses
      const status =
        err.code === "private_address" || err.code === "unsupported_protocol" || err.code === "invalid_url"
          ? 400
          : err.code === "timeout" || err.code === "dns_failed"
            ? 504
            : err.code === "too_large" || err.code === "unsupported_content_type"
              ? 415
              : err.code === "http_error"
                ? 502
                : 500;
      response.status(status).json({ error: err.code, message: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "url_fetch_failed", message });
  }
});

// #454 Phase 4 (v1.2.4): condensation step before blueprint/draft/MCQ pipeline. Frontend
// calls this automatically when combined source material exceeds 50K chars. Trades one
// LLM call (~10-30s) for significantly reduced context cost in the 4 downstream LLM calls.
adminContentRouter.post("/source-material/condense", generateLimiter, async (request, response) => {
  const sourceMaterial = typeof request.body?.sourceMaterial === "string" ? request.body.sourceMaterial : "";
  const certificationLevel = typeof request.body?.certificationLevel === "string" ? request.body.certificationLevel : "intermediate";
  const locale = typeof request.body?.locale === "string" ? request.body.locale : "nb";
  if (!sourceMaterial.trim()) {
    response.status(400).json({ error: "validation_error", message: "sourceMaterial is required" });
    return;
  }
  if (!["basic", "intermediate", "advanced"].includes(certificationLevel)) {
    response.status(400).json({ error: "validation_error", message: "invalid certificationLevel" });
    return;
  }
  if (!["nb", "nn", "en-GB"].includes(locale)) {
    response.status(400).json({ error: "validation_error", message: "invalid locale" });
    return;
  }
  try {
    const result = await condenseSourceMaterial({
      sourceMaterial,
      certificationLevel: certificationLevel as "basic" | "intermediate" | "advanced",
      locale: locale as "nb" | "nn" | "en-GB",
    });
    response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "condensation_failed", message });
  }
});

adminContentRouter.post("/generate/blueprint", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(blueprintGenerationBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const blueprint = await generateAssessmentBlueprint(data);
    response.json({ blueprint });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
  }
});

adminContentRouter.post("/generate/rubric", generateLimiter, async (request, response) => {
  const { data, error } = parseRequest(rubricGenerationBodySchema, request.body);
  if (error) {
    response.status(400).json({ error: "validation_error", issues: error });
    return;
  }

  try {
    const rubric = await generateModuleRubric({
      ...data,
      blueprint: normalizeAssessmentBlueprint(data.blueprint),
    });
    response.json({ rubric });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    response.status(500).json({ error: "generation_failed", message });
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
      blueprint: normalizeAssessmentBlueprint(data.blueprint),
    });
    const scenarioValidation = validateScenarioDraft(
      draft.taskText,
      draft.candidateTaskConstraints,
      draft.assessorExpectedContent,
    );
    const answerability = await checkScenarioAnswerability({
      taskText: draft.taskText,
      candidateTaskConstraints: draft.candidateTaskConstraints,
      assessorExpectedContent: draft.assessorExpectedContent,
      certificationLevel: data.certificationLevel,
    });
    const answerabilityIssues = answerability.warnings.map((w) => ({ severity: "warning" as const, code: "ANSWERABILITY_WARNING", message: w }));
    if (!answerability.answerableWithoutHiddenInfo) {
      answerabilityIssues.push({ severity: "warning" as const, code: "SCENARIO_NOT_SELF_CONTAINED", message: "Scenario may not be answerable from visible task alone. Review candidateTaskConstraints and taskText." });
    }
    if (answerability.hiddenExpectationFlags.length > 1) {
      answerabilityIssues.push({ severity: "warning" as const, code: "HIDDEN_EXPECTATIONS", message: `${answerability.hiddenExpectationFlags.length} expectations in assessorExpectedContent may not be derivable from visible task: ${answerability.hiddenExpectationFlags.join("; ")}` });
    }
    response.json({
      draft,
      validation: {
        valid: scenarioValidation.valid,
        issues: [...scenarioValidation.issues, ...answerabilityIssues],
      },
    });
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
      blueprint: normalizeAssessmentBlueprint(data.blueprint),
    });
    const validation = validateMcqDistractors(result.questions);
    response.json({
      questions: result.questions,
      validation: {
        valid: validation.valid,
        // #551: include the deterministic length-cue warning alongside distractor-quality issues.
        issues: [...validation.issues, ...(result.validationWarnings ?? [])],
      },
    });
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
