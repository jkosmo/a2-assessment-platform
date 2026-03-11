import { Router } from "express";
import { z } from "zod";
import {
  createModule,
  createBenchmarkExampleVersion,
  createMcqSetVersion,
  createModuleVersion,
  deleteModule,
  getModuleContentBundle,
  createPromptTemplateVersion,
  createRubricVersion,
  publishModuleVersion,
} from "../services/adminContentService.js";

const adminContentRouter = Router();

const localizedTextObjectSchema = z.object({
  "en-GB": z.string().trim().min(1),
  nb: z.string().trim().min(1),
  nn: z.string().trim().min(1),
});
const localizedTextSchema = z.union([z.string().trim().min(1), localizedTextObjectSchema]);
type LocalizedTextInput = z.infer<typeof localizedTextSchema>;

function serializeLocalizedText(value: LocalizedTextInput): string {
  if (typeof value === "string") {
    return value.trim();
  }

  return JSON.stringify({
    "en-GB": value["en-GB"].trim(),
    nb: value.nb.trim(),
    nn: value.nn.trim(),
  });
}

function localizedTextIdentity(value: LocalizedTextInput): string {
  if (typeof value === "string") {
    return `plain:${value.trim()}`;
  }

  return `locale:${value["en-GB"].trim()}|${value.nb.trim()}|${value.nn.trim()}`;
}

const moduleCreateBodySchema = z.object({
  title: localizedTextSchema,
  description: localizedTextSchema.optional(),
  certificationLevel: localizedTextSchema.optional(),
  validFrom: z.string().trim().optional(),
  validTo: z.string().trim().optional(),
});

const rubricBodySchema = z.object({
  criteria: z.record(z.unknown()),
  scalingRule: z.record(z.unknown()),
  passRule: z.record(z.unknown()),
  active: z.boolean().optional().default(true),
});

const promptTemplateBodySchema = z.object({
  systemPrompt: localizedTextSchema,
  userPromptTemplate: localizedTextSchema,
  examples: z.array(z.record(z.unknown())).optional().default([]),
  active: z.boolean().optional().default(true),
});

const mcqQuestionSchema = z
  .object({
    stem: localizedTextSchema,
    options: z.array(localizedTextSchema).min(2),
    correctAnswer: localizedTextSchema,
    rationale: localizedTextSchema.optional(),
  })
  .superRefine((question, context) => {
    const normalizedOptions = question.options.map((option) => localizedTextIdentity(option));
    if (!normalizedOptions.includes(localizedTextIdentity(question.correctAnswer))) {
      context.addIssue({
        code: "custom",
        message: "correctAnswer must be one of options.",
        path: ["correctAnswer"],
      });
    }
  });

const mcqSetBodySchema = z.object({
  title: localizedTextSchema,
  questions: z.array(mcqQuestionSchema).min(1),
  active: z.boolean().optional().default(true),
});

const moduleVersionBodySchema = z.object({
  taskText: localizedTextSchema,
  guidanceText: localizedTextSchema.optional(),
  rubricVersionId: z.string().min(1),
  promptTemplateVersionId: z.string().min(1),
  mcqSetVersionId: z.string().min(1),
});

const benchmarkExampleVersionBodySchema = z.object({
  basePromptTemplateVersionId: z.string().min(1),
  linkedModuleVersionId: z.string().min(1).optional(),
  examples: z.array(z.record(z.unknown())).min(1),
  active: z.boolean().optional().default(true),
});

function parseRequest<T>(schema: z.ZodType<T>, body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error.issues };
  }
  return { data: parsed.data };
}

function parseOptionalDate(input?: string) {
  if (!input) {
    return undefined;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

adminContentRouter.post("/modules", async (request, response) => {
  const parsed = parseRequest(moduleCreateBodySchema, request.body);
  if (parsed.error) {
    response.status(400).json({ error: "validation_error", issues: parsed.error });
    return;
  }

  const validFrom = parseOptionalDate(parsed.data.validFrom);
  const validTo = parseOptionalDate(parsed.data.validTo);
  if ((parsed.data.validFrom && !validFrom) || (parsed.data.validTo && !validTo)) {
    response.status(400).json({
      error: "validation_error",
      message: "validFrom/validTo must be valid ISO date or datetime values.",
    });
    return;
  }

  try {
    const module = await createModule({
      title: serializeLocalizedText(parsed.data.title),
      description: parsed.data.description ? serializeLocalizedText(parsed.data.description) : undefined,
      certificationLevel: parsed.data.certificationLevel
        ? serializeLocalizedText(parsed.data.certificationLevel)
        : undefined,
      validFrom: validFrom ?? undefined,
      validTo: validTo ?? undefined,
      actorId: request.context?.userId,
    });
    response.status(201).json({ module });
  } catch (error) {
    response.status(400).json({
      error: "create_module_failed",
      message: error instanceof Error ? error.message : "Could not create module.",
    });
  }
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
    response.status(400).json({
      error: "delete_module_failed",
      message: error instanceof Error ? error.message : "Could not delete module.",
    });
  }
});

adminContentRouter.get("/modules/:moduleId/export", async (request, response) => {
  try {
    const moduleExport = await getModuleContentBundle(request.params.moduleId);
    response.json({ moduleExport });
  } catch (error) {
    response.status(404).json({
      error: "module_export_failed",
      message: error instanceof Error ? error.message : "Could not export module.",
    });
  }
});

adminContentRouter.post("/modules/:moduleId/rubric-versions", async (request, response) => {
  const parsed = parseRequest(rubricBodySchema, request.body);
  if (parsed.error) {
    response.status(400).json({ error: "validation_error", issues: parsed.error });
    return;
  }

  try {
    const rubricVersion = await createRubricVersion({
      moduleId: request.params.moduleId,
      criteria: parsed.data.criteria,
      scalingRule: parsed.data.scalingRule,
      passRule: parsed.data.passRule,
      active: parsed.data.active ?? true,
    });
    response.status(201).json({ rubricVersion });
  } catch (error) {
    response.status(400).json({
      error: "create_rubric_version_failed",
      message: error instanceof Error ? error.message : "Could not create rubric version.",
    });
  }
});

adminContentRouter.post("/modules/:moduleId/prompt-template-versions", async (request, response) => {
  const parsed = parseRequest(promptTemplateBodySchema, request.body);
  if (parsed.error) {
    response.status(400).json({ error: "validation_error", issues: parsed.error });
    return;
  }

  try {
    const promptTemplateVersion = await createPromptTemplateVersion({
      moduleId: request.params.moduleId,
      systemPrompt: serializeLocalizedText(parsed.data.systemPrompt),
      userPromptTemplate: serializeLocalizedText(parsed.data.userPromptTemplate),
      examples: parsed.data.examples ?? [],
      active: parsed.data.active ?? true,
    });
    response.status(201).json({ promptTemplateVersion });
  } catch (error) {
    response.status(400).json({
      error: "create_prompt_template_version_failed",
      message: error instanceof Error ? error.message : "Could not create prompt template version.",
    });
  }
});

adminContentRouter.post("/modules/:moduleId/mcq-set-versions", async (request, response) => {
  const parsed = parseRequest(mcqSetBodySchema, request.body);
  if (parsed.error) {
    response.status(400).json({ error: "validation_error", issues: parsed.error });
    return;
  }

  try {
    const mcqSetVersion = await createMcqSetVersion({
      moduleId: request.params.moduleId,
      title: serializeLocalizedText(parsed.data.title),
      questions: parsed.data.questions.map((question) => ({
        stem: serializeLocalizedText(question.stem),
        options: question.options.map((option) => serializeLocalizedText(option)),
        correctAnswer: serializeLocalizedText(question.correctAnswer),
        rationale: question.rationale ? serializeLocalizedText(question.rationale) : undefined,
      })),
      active: parsed.data.active ?? true,
    });
    response.status(201).json({ mcqSetVersion });
  } catch (error) {
    response.status(400).json({
      error: "create_mcq_set_version_failed",
      message: error instanceof Error ? error.message : "Could not create MCQ set version.",
    });
  }
});

adminContentRouter.post("/modules/:moduleId/module-versions", async (request, response) => {
  const parsed = parseRequest(moduleVersionBodySchema, request.body);
  if (parsed.error) {
    response.status(400).json({ error: "validation_error", issues: parsed.error });
    return;
  }

  try {
    const moduleVersion = await createModuleVersion({
      moduleId: request.params.moduleId,
      taskText: serializeLocalizedText(parsed.data.taskText),
      guidanceText: parsed.data.guidanceText ? serializeLocalizedText(parsed.data.guidanceText) : undefined,
      rubricVersionId: parsed.data.rubricVersionId,
      promptTemplateVersionId: parsed.data.promptTemplateVersionId,
      mcqSetVersionId: parsed.data.mcqSetVersionId,
    });
    response.status(201).json({ moduleVersion });
  } catch (error) {
    response.status(400).json({
      error: "create_module_version_failed",
      message: error instanceof Error ? error.message : "Could not create module version.",
    });
  }
});

adminContentRouter.post("/modules/:moduleId/benchmark-example-versions", async (request, response) => {
  const parsed = parseRequest(benchmarkExampleVersionBodySchema, request.body);
  if (parsed.error) {
    response.status(400).json({ error: "validation_error", issues: parsed.error });
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
      basePromptTemplateVersionId: parsed.data.basePromptTemplateVersionId,
      linkedModuleVersionId: parsed.data.linkedModuleVersionId,
      examples: parsed.data.examples,
      active: parsed.data.active ?? true,
      actorId,
    });
    response.status(201).json({ benchmarkExampleVersion });
  } catch (error) {
    response.status(400).json({
      error: "create_benchmark_example_version_failed",
      message: error instanceof Error ? error.message : "Could not create benchmark example version.",
    });
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
    response.status(400).json({
      error: "publish_module_version_failed",
      message: error instanceof Error ? error.message : "Could not publish module version.",
    });
  }
});

export { adminContentRouter };
