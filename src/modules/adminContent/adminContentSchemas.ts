import { z } from "zod";
import type { LocalizedText } from "../../codecs/localizedTextCodec.js";

export const localizedTextObjectSchema = z.object({
  "en-GB": z.string().trim().min(1),
  nb: z.string().trim().min(1),
  nn: z.string().trim().min(1),
});

export const localizedTextSchema = z.union([z.string().trim().min(1), localizedTextObjectSchema]);
export const localizedTextPatchObjectSchema = localizedTextObjectSchema.partial().refine(
  (value) => Object.values(value).some((entry) => typeof entry === "string" && entry.trim().length > 0),
  { message: "At least one locale value is required." },
);
export const localizedTextPatchSchema = z.union([z.string().trim().min(1), localizedTextPatchObjectSchema]);

export function localizedTextIdentity(value: LocalizedText): string {
  if (typeof value === "string") {
    return `plain:${value.trim()}`;
  }
  return `locale:${value["en-GB"] ?? ""}|${value.nb ?? ""}|${value.nn ?? ""}`;
}

const safeShortString = z.string().trim().max(100).refine(
  (v) => !/[<>"'&]/.test(v),
  { message: "Value must not contain HTML special characters." },
);

export const certificationLevelInputSchema = z.union([
  safeShortString,
  z.record(z.string(), safeShortString),
]).optional();

export const moduleCreateBodySchema = z.object({
  title: localizedTextSchema,
  description: localizedTextSchema.optional(),
  certificationLevel: certificationLevelInputSchema,
  validFrom: z.string().trim().optional(),
  validTo: z.string().trim().optional(),
});

export const moduleTitleUpdateBodySchema = z.object({
  title: localizedTextPatchSchema,
});

// B3 (#450): "Behold kriteriene" sync — accepts the current blueprint hash. Null is allowed
// so caller can also clear the stored hash if blueprint was deleted.
export const rubricSyncBlueprintBodySchema = z.object({
  blueprintHash: z.string().trim().max(64).nullable(),
});

export const rubricBodySchema = z.object({
  criteria: z.record(z.unknown()),
  scalingRule: z.record(z.unknown()),
  // passRule was dropped in #446 (dead field — never read by decisionService).
  // Accept it on input for backwards compatibility with older JSON exports but ignore the value.
  passRule: z.record(z.unknown()).optional(),
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

// v1.2.21 (#464 fix): passRules schema utvidet til å inkludere alle feltene UI-en
// faktisk samler inn. Tidligere strippa zod borderlineWindow, mcqMinPercent og
// practicalMinPercent silent fordi de ikke fantes i schemaet — derfor virket
// borderline-vinduet aldri i decisionService.
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
      mcqMinPercent: z.number().min(0).max(100).optional(),
      practicalMinPercent: z.number().min(0).max(100).optional(),
      borderlineWindow: z
        .object({
          min: z.number().min(0).max(100),
          max: z.number().min(0).max(100),
        })
        .optional(),
    })
    .optional(),
});

export const moduleVersionBodySchema = z.object({
  taskText: localizedTextSchema,
  assessorExpectedContent: localizedTextSchema.optional(),
  candidateTaskConstraints: localizedTextSchema.optional(),
  assessmentBlueprint: z.string().trim().optional(),
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
export const generationModeSchema = z.enum(["ordinary", "thorough"]);

export const sourceMaterialUploadBodySchema = z.object({
  fileName: z.string().trim().min(1),
  mimeType: z.string().trim().optional(),
  contentBase64: z.string().trim().min(1),
});

export const blueprintGenerationBodySchema = z.object({
  sourceMaterial: z.string().trim().min(1),
  certificationLevel: certificationLevelSchema,
  locale: generationLocaleSchema,
});

// Schema mirrors the AssessmentBlueprint shape in llmContentGenerationService.ts.
// Kept here (in the route-input layer) so we validate incoming JSON before it reaches the generator.
const assessmentBlueprintSchema = z.object({
  learningObjectives: z.array(z.string().trim().min(1)).default([]),
  keyTopics: z.array(z.string().trim().min(1)).default([]),
  complexityBudget: z.object({
    actors: z.number().int().min(0).default(0),
    concepts: z.number().int().min(0).default(0),
    tradeoffs: z.number().int().min(0).default(0),
  }).default({ actors: 0, concepts: 0, tradeoffs: 0 }),
  mcqProfile: z.object({
    suggestedCount: z.number().int().min(1).max(20).default(10),
    topicDistribution: z.record(z.string(), z.number().min(0).max(1)).default({}),
  }).default({ suggestedCount: 10, topicDistribution: {} }),
  notes: z.string().default(""),
});

// v1.2.8: scenarioMode lets the author choose whether the generated task uses a scenario.
// "auto" preserves the legacy LLM-decides behaviour; "include" forces a scenario; "exclude"
// suppresses scenario framing. See buildModuleDraftPrompts for the prompt-level effect.
export const scenarioModeSchema = z.enum(["auto", "include", "exclude"]);

export const moduleDraftGenerationBodySchema = z.object({
  sourceMaterial: z.string().trim().min(1),
  certificationLevel: certificationLevelSchema,
  locale: generationLocaleSchema,
  generationMode: generationModeSchema.default("ordinary"),
  blueprint: assessmentBlueprintSchema.optional(),
  scenarioMode: scenarioModeSchema.default("auto"),
});

export const rubricGenerationBodySchema = z.object({
  taskText: z.string().trim().min(1),
  candidateTaskConstraints: z.string().trim().optional(),
  assessorExpectedContent: z.string().trim().min(1),
  certificationLevel: certificationLevelSchema,
  locale: generationLocaleSchema,
  blueprint: assessmentBlueprintSchema.optional(),
});

// B3 (#450): /rubric-versions/ensure also accepts `force: true` to bypass the "existing
// rubric" short-circuit. Used by the drift-banner regenerate flow.
export const rubricEnsureBodySchema = rubricGenerationBodySchema.extend({
  force: z.boolean().optional(),
});

export const moduleDraftRevisionBodySchema = z.object({
  taskText: z.string().trim().min(1),
  assessorExpectedContent: z.string().trim().min(1),
  candidateTaskConstraints: z.string().trim().optional(),
  instruction: z.string().trim().min(1),
  locale: generationLocaleSchema,
});

export const mcqGenerationBodySchema = z.object({
  sourceMaterial: z.string().trim().min(1),
  certificationLevel: certificationLevelSchema,
  locale: generationLocaleSchema,
  generationMode: generationModeSchema.default("ordinary"),
  questionCount: z.number().int().min(1).max(20).default(10),
  optionCount: z.number().int().min(2).max(6).default(4),
  blueprint: assessmentBlueprintSchema.optional(),
});

export const mcqRevisionBodySchema = z.object({
  questions: z.array(mcqQuestionSchema).min(1),
  instruction: z.string().trim().min(1),
  locale: generationLocaleSchema,
  questionCount: z.number().int().min(1).max(20).optional(),
  optionCount: z.number().int().min(2).max(6).optional(),
});

export const moduleDraftLocalizationBodySchema = z.object({
  taskText: z.string().trim().min(1),
  assessorExpectedContent: z.string().trim().min(1),
  candidateTaskConstraints: z.string().trim().optional(),
  title: z.string().trim().min(1).optional(),
  sourceLocale: generationLocaleSchema,
  targetLocale: generationLocaleSchema,
});

export const generatedMcqQuestionBodySchema = z.object({
  stem: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(2).max(6),
  correctAnswer: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
});

export const mcqLocalizationBodySchema = z.object({
  questions: z.array(generatedMcqQuestionBodySchema).min(1),
  sourceLocale: generationLocaleSchema,
  targetLocale: generationLocaleSchema,
});

// =========================================================================
// Export / import (#433)
// =========================================================================
// Versioned envelope so we can evolve the on-disk format without breaking
// older files. Bump EXPORT_FORMAT_VERSION on any incompatible change and
// add a migrator from the previous version.

export const EXPORT_FORMAT_VERSION = "a2-content-export/v1" as const;

// Audit attribution carried from the source environment. The publishedBy /
// exportedBy fields are OPAQUE strings (likely UUIDs from a different user
// table) — the destination must NEVER try to match them to local user IDs.
// Display only.
const exportAuditSchema = z.object({
  publishedAt: z.string().datetime().nullable().optional(),
  publishedBy: z.string().nullable().optional(),
  publishedByEmail: z.string().email().nullable().optional(),
  sourceVersionNo: z.number().int().min(1).nullable().optional(),
});

// One module's full active-version payload — enough to recreate the module
// in another environment without external dependencies. Does NOT include
// historical versions; only the currently active one is exported.
export const moduleExportPayloadSchema = z.object({
  module: z.object({
    title: localizedTextSchema,
    description: localizedTextSchema.nullable().optional(),
    certificationLevel: certificationLevelInputSchema,
  }),
  activeVersion: z.object({
    taskText: localizedTextSchema,
    assessorExpectedContent: localizedTextSchema.nullable().optional(),
    candidateTaskConstraints: localizedTextSchema.nullable().optional(),
    assessmentBlueprint: z.string().nullable().optional(),
    submissionSchema: submissionSchemaBodySchema.nullable().optional(),
    assessmentPolicy: assessmentPolicyBodySchema.nullable().optional(),
    rubric: rubricBodySchema,
    promptTemplate: promptTemplateBodySchema,
    mcqSet: mcqSetBodySchema,
    audit: exportAuditSchema,
  }),
});

// One learning section's payload — title + active-version markdown, both
// localized. Assets (#483/F4) are not yet inlined; markdown-only for now (#512).
export const sectionExportPayloadSchema = z.object({
  title: localizedTextSchema,
  bodyMarkdown: localizedTextSchema,
  audit: exportAuditSchema.optional(),
});

// Course export inlines each module's full payload so the file is
// self-contained (chosen 2026-05-19 over reference-only). #512 adds an optional
// `items` array carrying the full mixed module/section sequence; `modules` is
// kept (now optional) so v1 importers that only understand modules still work.
export const courseExportPayloadSchema = z.object({
  course: z.object({
    title: localizedTextSchema,
    description: localizedTextSchema.nullable().optional(),
    certificationLevel: certificationLevelInputSchema,
    audit: exportAuditSchema,
    modules: z.array(z.object({
      sortOrder: z.number().int().min(0),
      module: moduleExportPayloadSchema,
    })).optional(),
    items: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("MODULE"), sortOrder: z.number().int().min(0), module: moduleExportPayloadSchema }),
      z.object({ type: z.literal("SECTION"), sortOrder: z.number().int().min(0), section: sectionExportPayloadSchema }),
    ])).optional(),
  }).refine(
    (c) => (c.modules?.length ?? 0) > 0 || (c.items?.length ?? 0) > 0,
    { message: "Course export must contain at least one module or item." },
  ),
});

export const exportEnvelopeSchema = z.object({
  exportFormat: z.literal(EXPORT_FORMAT_VERSION),
  exportedAt: z.string().datetime(),
  exportedBy: z.string().nullable().optional(),
  exportedByEmail: z.string().email().nullable().optional(),
  scope: z.enum(["module", "course"]),
  module: moduleExportPayloadSchema.optional(),
  course: courseExportPayloadSchema.optional(),
}).refine(
  (env) => (env.scope === "module") === (env.module !== undefined),
  { message: "envelope.scope must match payload (module envelopes need a module field)" },
).refine(
  (env) => (env.scope === "course") === (env.course !== undefined),
  { message: "envelope.scope must match payload (course envelopes need a course field)" },
);

export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>;
export type ModuleExportPayload = z.infer<typeof moduleExportPayloadSchema>;
export type SectionExportPayload = z.infer<typeof sectionExportPayloadSchema>;
export type CourseExportPayload = z.infer<typeof courseExportPayloadSchema>;

export const importBodySchema = z.object({
  payload: exportEnvelopeSchema,
  // Explicit collision handling — import never silently overwrites (#433 ACL).
  mode: z.enum(["createNew", "replaceExisting"]).default("createNew"),
  // When mode=replaceExisting: ID of the existing module/course to attach the
  // imported content to as a NEW active version (history is preserved in the
  // destination's normal version chain; the source's history is NOT replayed).
  targetId: z.string().min(1).optional(),
  // v1.2.14 (#456): når false, auto-publiser ikke selv om kildens audit.publishedAt er
  // satt. In-app duplisering sender false; fil-import lar default (true) stå.
  autoPublish: z.boolean().optional(),
}).refine(
  (body) => body.mode !== "replaceExisting" || !!body.targetId,
  { message: "targetId is required when mode is replaceExisting", path: ["targetId"] },
);

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
