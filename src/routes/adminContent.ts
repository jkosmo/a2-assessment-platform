import { Router } from "express";
import { z } from "zod";
import {
  createModule,
  createBenchmarkExampleVersion,
  createMcqSetVersion,
  createModuleVersion,
  createPromptTemplateVersion,
  createRubricVersion,
  publishModuleVersion,
} from "../services/adminContentService.js";

const adminContentRouter = Router();

const moduleCreateBodySchema = z.object({
  title: z.string().trim().min(3),
  description: z.string().trim().min(1).optional(),
  certificationLevel: z.string().trim().min(1).optional(),
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
  systemPrompt: z.string().trim().min(5),
  userPromptTemplate: z.string().trim().min(5),
  examples: z.array(z.record(z.unknown())).optional().default([]),
  active: z.boolean().optional().default(true),
});

const mcqQuestionSchema = z
  .object({
    stem: z.string().trim().min(5),
    options: z.array(z.string().trim().min(1)).min(2),
    correctAnswer: z.string().trim().min(1),
    rationale: z.string().trim().min(1).optional(),
  })
  .superRefine((question, context) => {
    if (!question.options.includes(question.correctAnswer)) {
      context.addIssue({
        code: "custom",
        message: "correctAnswer must be one of options.",
        path: ["correctAnswer"],
      });
    }
  });

const mcqSetBodySchema = z.object({
  title: z.string().trim().min(3),
  questions: z.array(mcqQuestionSchema).min(1),
  active: z.boolean().optional().default(true),
});

const moduleVersionBodySchema = z.object({
  taskText: z.string().trim().min(5),
  guidanceText: z.string().trim().min(1).optional(),
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
      title: parsed.data.title,
      description: parsed.data.description,
      certificationLevel: parsed.data.certificationLevel,
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
      systemPrompt: parsed.data.systemPrompt,
      userPromptTemplate: parsed.data.userPromptTemplate,
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
      title: parsed.data.title,
      questions: parsed.data.questions,
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
      ...parsed.data,
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
