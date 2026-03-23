import { z } from "zod";
import type { LocalizedText } from "../../codecs/localizedTextCodec.js";

export const localizedTextObjectSchema = z.object({
  "en-GB": z.string().trim().min(1),
  nb: z.string().trim().min(1),
  nn: z.string().trim().min(1),
});

export const localizedTextSchema = z.union([z.string().trim().min(1), localizedTextObjectSchema]);

export function localizedTextIdentity(value: LocalizedText): string {
  if (typeof value === "string") {
    return `plain:${value.trim()}`;
  }
  return `locale:${value["en-GB"] ?? ""}|${value.nb ?? ""}|${value.nn ?? ""}`;
}

export const moduleCreateBodySchema = z.object({
  title: localizedTextSchema,
  description: localizedTextSchema.optional(),
  certificationLevel: localizedTextSchema.optional(),
  validFrom: z.string().trim().optional(),
  validTo: z.string().trim().optional(),
});

export const rubricBodySchema = z.object({
  criteria: z.record(z.unknown()),
  scalingRule: z.record(z.unknown()),
  passRule: z.record(z.unknown()),
  active: z.boolean().default(true),
});

export const promptTemplateBodySchema = z.object({
  systemPrompt: localizedTextSchema,
  userPromptTemplate: localizedTextSchema,
  examples: z.array(z.record(z.unknown())).optional(),
  active: z.boolean().optional(),
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

export const mcqSetBodySchema = z.object({
  title: localizedTextSchema,
  questions: z.array(mcqQuestionSchema).min(1),
  active: z.boolean().optional(),
});

export const submissionSchemaFieldSchema = z.object({
  id: z.string().min(1),
  label: localizedTextSchema,
  type: z.enum(["textarea", "text"]),
  required: z.boolean().optional(),
  placeholder: localizedTextSchema.optional(),
});

export const submissionSchemaBodySchema = z.object({
  fields: z.array(submissionSchemaFieldSchema).min(1),
});

export const assessmentPolicyBodySchema = z.object({
  scoring: z
    .object({
      practicalWeight: z.number().min(0).max(100),
      mcqWeight: z.number().min(0).max(100),
    })
    .optional(),
  passRules: z
    .object({
      totalMin: z.number().min(0).max(100),
    })
    .optional(),
});

export const moduleVersionBodySchema = z.object({
  taskText: localizedTextSchema,
  guidanceText: localizedTextSchema.optional(),
  rubricVersionId: z.string().min(1),
  promptTemplateVersionId: z.string().min(1),
  mcqSetVersionId: z.string().min(1),
  submissionSchema: submissionSchemaBodySchema.optional(),
  assessmentPolicy: assessmentPolicyBodySchema.optional(),
});

export const benchmarkExampleVersionBodySchema = z.object({
  basePromptTemplateVersionId: z.string().min(1),
  linkedModuleVersionId: z.string().min(1).optional(),
  examples: z.array(z.record(z.unknown())).min(1),
  active: z.boolean().default(true),
});

export const generationLocaleSchema = z.enum(["en-GB", "nb", "nn"]);
export const certificationLevelSchema = z.enum(["basic", "intermediate", "advanced"]);

export const moduleDraftGenerationBodySchema = z.object({
  sourceMaterial: z.string().trim().min(1),
  certificationLevel: certificationLevelSchema,
  locale: generationLocaleSchema,
});

export const mcqGenerationBodySchema = z.object({
  sourceMaterial: z.string().trim().min(1),
  certificationLevel: certificationLevelSchema,
  locale: generationLocaleSchema,
  questionCount: z.number().int().min(1).max(20).default(10),
});

export function parseRequest<T>(schema: z.ZodType<T>, body: unknown): { data: T; error?: never } | { data?: never; error: z.ZodIssue[] } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error.issues };
  }
  return { data: parsed.data };
}

export function parseOptionalDate(input?: string): Date | null | undefined {
  if (!input) return undefined;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
