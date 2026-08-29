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

/**
 * #905: content written in one language and NOT YET translated into the others.
 *
 * `localizedTextSchema` accepts either a plain string or an object holding ALL three locales —
 * there is no way to say "nb is translated, nn is not". That gap made the honesty rule from
 * #892 unenforceable for anything but titles: a client whose translation partly failed had to
 * choose between a 400 (partial object) and filling every locale with the source text, which
 * stores content that looks translated and reads as the wrong language.
 *
 * This alias permits a partial map, requiring at least one locale. Reading is unaffected —
 * `localizeContentText` already falls back across locales, which is how a plain string has
 * always displayed. A missing locale becomes a fact the data can express, which is what the
 * publish gate (#896 S4) and the translation-status list (#894) need in order to measure
 * anything at all.
 *
 * Named separately from `localizedTextPatchSchema` even though the shape is identical: a patch
 * is "change these locales, leave the rest", while this is "this is the whole value, and some
 * locales are genuinely missing". Same validation, different meaning at the call site.
 */
export const localizedTextMaybeUntranslatedSchema = localizedTextPatchSchema;

/**
 * A collision-free identity for a localized value, used to check that an MCQ's correct answer is
 * one of its options.
 *
 * JSON.stringify of the locale array, not a `|`-join: the join is not injective, because the
 * separator can appear in the text. `{en-GB:"A|B", nb:"C"}` and `{en-GB:"A", nb:"B|C"}` produced
 * the same identity, so an answer that is NOT one of the options could pass validation — and a
 * question whose stored answer matches no option can never be scored correct for anyone
 * (`matchesLocalizedContentVariant` compares the real strings). The question silently became
 * unanswerable.
 */
export function localizedTextIdentity(value: LocalizedText): string {
  if (typeof value === "string") {
    return `plain:${JSON.stringify(value.trim())}`;
  }
  return `locale:${JSON.stringify([value["en-GB"] ?? "", value.nb ?? "", value.nn ?? ""])}`;
}

const safeShortString = z.string().trim().max(100).refine(
  (v) => !/[<>"'&]/.test(v),
  { message: "Value must not contain HTML special characters." },
);

export const certificationLevelInputSchema = z.union([
  safeShortString,
  z.record(z.string(), safeShortString),
]).optional();

// AA-2 (#650): agent-orchestrated create/import calls may carry a clientRef
// (the object's identity within an a2-authoring-package/v1 plan). The server
// never persists it — it is echoed back so the skill can map plan → server IDs.
export const clientRefSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/, "clientRef must match [a-z0-9-]{1,64}.");

// AA-5 (#653): one orchestration run's trace ID — stamped into the audit metadata
// of every write the run performs, so partial success is reconstructable.
export const agentRunIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9._-]{1,64}$/, "agentRunId must match [a-zA-Z0-9._-]{1,64}.");

// AA-3 (#651): utstedelse av kortlivet agent-authoring-token. TTL-grensene speiler
// konstantene i agentAuthoringTokenService (5–60 min); tjenesten klamper uansett.
export const agentTokenCreateBodySchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  ttlMinutes: z.number().int().min(5).max(60).optional(),
});

// #930: opprettelse tar imot et DELVIS spraakkart, ikke bare «alt eller en ren streng».
//
// ⚠️ En ren streng er ikke noeytral. `missingLocalesFor` leser den som bokmaal
// (`contentValidationService.ts`, `sourceLocale = "nb"`), fordi feltet ikke baerer noe spraakmerke.
// Oppretter du en modul mens arbeidsflaten staar paa engelsk, lagres «Incident response» som norsk:
// gaten melder at en-GB og nn mangler, naar det er nb og nn som mangler, og «oversett det som
// mangler» oversetter til feil spraak fra en kilde den tror er norsk.
//
// `localizedTextMaybeUntranslatedSchema` har vaert kontrakten for broedtekstfeltene siden #905/#913
// og godtar {"en-GB": "..."} alene. Ingen ny datamodell, ingen migrasjon, og rene strenger leses
// fortsatt som foer — dette gjelder hva som SKRIVES fra naa av.
export const moduleCreateBodySchema = z.object({
  title: localizedTextMaybeUntranslatedSchema,
  description: localizedTextMaybeUntranslatedSchema.optional(),
  certificationLevel: certificationLevelInputSchema,
  validFrom: z.string().trim().optional(),
  validTo: z.string().trim().optional(),
  clientRef: clientRefSchema.optional(),
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

// #930: samme skjema, samme problem — se moduleCreateBodySchema over.
export const promptTemplateBodySchema = z.object({
  systemPrompt: localizedTextMaybeUntranslatedSchema,
  userPromptTemplate: localizedTextMaybeUntranslatedSchema,
  examples: z.array(z.record(z.unknown())).optional(),
  active: z.boolean().optional(),
});

// #913 / #896 S4: MCQ fields take the same PARTIAL localized shape as the module-version text
// fields have since #905. They used to demand a plain string or all three locales, which left no
// way to say "nynorsk failed, the other two are real" — so a partly successful translation had to
// be collapsed back to the source language, discarding the locales that DID translate. The
// publish gate then blocked on gaps the author had just paid an LLM to fill.
const mcqQuestionSchema = z
  .object({
    stem: localizedTextMaybeUntranslatedSchema,
    options: z.array(localizedTextMaybeUntranslatedSchema).min(2),
    correctAnswer: localizedTextMaybeUntranslatedSchema,
    rationale: localizedTextMaybeUntranslatedSchema.optional(),
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
  // Partial too, and not only for symmetry: the client derives an absent MCQ-set title from the
  // MODULE title, which is a one-key map whenever a translation failed (#905/#896 S4). Demanding
  // all three locales here would 400 the save for exactly the modules the gate is trying to help.
  title: localizedTextMaybeUntranslatedSchema,
  questions: z.array(mcqQuestionSchema).min(1),
  active: z.boolean().optional(),
});

export const submissionSchemaFieldSchema = z.object({
  id: z.string().min(1),
  // #896 S3c: partial maps, like every other localized value since #905/#913. These demanded all
  // three locales, so clearing the Norwegian placeholder on a field that had all three produced a
  // two-locale object and a 400 — the author could add a placeholder but never remove one.
  label: localizedTextMaybeUntranslatedSchema,
  type: z.enum(["textarea", "text"]),
  required: z.boolean().optional(),
  placeholder: localizedTextMaybeUntranslatedSchema.optional(),
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
      // #547: optional — MCQ-only policies set only mcqMinPercent; decisionService defaults
      // totalMin from assessmentRules when absent.
      totalMin: z.number().min(0).max(100).optional(),
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

export const assessmentModeSchema = z.enum(["FREETEXT_PLUS_MCQ", "MCQ_ONLY", "FREETEXT_ONLY"]);

// #525: MCQ_ONLY modules have no free-text task, rubric or prompt — those fields become optional.
// mcqSetVersionId is always required. FREETEXT_PLUS_MCQ (default) keeps the original requirements.
export const moduleVersionBodySchema = z
  .object({
    assessmentMode: assessmentModeSchema.optional(),
    // #905: these are the fields an author writes in one language and has translated
    // afterwards, so they must be able to arrive partially translated.
    taskText: localizedTextMaybeUntranslatedSchema.optional(),
    assessorExpectedContent: localizedTextMaybeUntranslatedSchema.optional(),
    candidateTaskConstraints: localizedTextMaybeUntranslatedSchema.optional(),
    assessmentBlueprint: z.string().trim().optional(),
    rubricVersionId: z.string().min(1).optional(),
    promptTemplateVersionId: z.string().min(1).optional(),
    // #578: optional — FREETEXT_ONLY modules have no MCQ set. Required for the other two modes
    // via the refine below.
    mcqSetVersionId: z.string().min(1).optional(),
    submissionSchema: submissionSchemaBodySchema.optional(),
    assessmentPolicy: assessmentPolicyBodySchema.optional(),
  })
  .refine(
    (v) => {
      const hasFreeText = Boolean(v.taskText) && Boolean(v.rubricVersionId) && Boolean(v.promptTemplateVersionId);
      // FREETEXT_ONLY (#578): free-text fields required, no MCQ set.
      if (v.assessmentMode === "FREETEXT_ONLY") return hasFreeText;
      // MCQ_ONLY (#525): MCQ set required, no free-text fields.
      if (v.assessmentMode === "MCQ_ONLY") return Boolean(v.mcqSetVersionId);
      // FREETEXT_PLUS_MCQ (default): both free-text fields and an MCQ set required.
      return hasFreeText && Boolean(v.mcqSetVersionId);
    },
    {
      message:
        "FREETEXT_PLUS_MCQ requires taskText, rubricVersionId, promptTemplateVersionId and mcqSetVersionId; " +
        "FREETEXT_ONLY requires taskText, rubricVersionId and promptTemplateVersionId (no mcqSet); " +
        "MCQ_ONLY requires mcqSetVersionId.",
      path: ["assessmentMode"],
    },
  );

/**
 * #906: the whole module version in one request.
 *
 * Component versions can either be CREATED here (`rubric`, `promptTemplate`, `mcqSet`) or
 * REFERENCED by id (`rubricVersionId`, …) when the caller is keeping the existing one. Sending
 * both for the same slot is not an error — the freshly created one wins — because the common
 * case is a UI that always sends what it has.
 */
export const composeModuleVersionBodySchema = z.object({
  /** Renamed in the same transaction as the version, so a failed save leaves the name alone. */
  title: localizedTextPatchSchema.optional(),
  // #896 S3b: module-level fields. `null` on description clears it; omitting a field leaves it
  // untouched, which is what lets a settings save avoid rewriting content it never showed.
  description: localizedTextPatchSchema.nullable().optional(),
  certificationLevel: certificationLevelInputSchema.optional(),
  validFrom: z.string().trim().nullable().optional(),
  validTo: z.string().trim().nullable().optional(),
  assessmentMode: assessmentModeSchema.optional(),
  taskText: localizedTextMaybeUntranslatedSchema.optional(),
  assessorExpectedContent: localizedTextMaybeUntranslatedSchema.optional(),
  candidateTaskConstraints: localizedTextMaybeUntranslatedSchema.optional(),
  assessmentBlueprint: z.string().trim().optional(),
  rubric: rubricBodySchema.omit({ active: true }).optional(),
  promptTemplate: promptTemplateBodySchema.omit({ active: true }).optional(),
  mcqSet: mcqSetBodySchema.omit({ active: true }).optional(),
  rubricVersionId: z.string().min(1).optional(),
  promptTemplateVersionId: z.string().min(1).optional(),
  mcqSetVersionId: z.string().min(1).optional(),
  submissionSchema: submissionSchemaBodySchema.optional(),
  assessmentPolicy: assessmentPolicyBodySchema.optional(),
})
  // Mode-aware, and strict in BOTH directions. Missing pieces are an obvious error; sending
  // pieces the mode has no use for is the dangerous one — the composer would skip them and
  // answer 201, so an author with a stale screen would believe a rubric was saved when it was
  // silently dropped. Rejecting before the transaction opens is the honest answer.
  .superRefine((v, ctx) => {
    const mode = v.assessmentMode ?? "FREETEXT_PLUS_MCQ";
    const hasRubric = Boolean(v.rubric || v.rubricVersionId);
    const hasPrompt = Boolean(v.promptTemplate || v.promptTemplateVersionId);
    const hasMcq = Boolean(v.mcqSet || v.mcqSetVersionId);
    const fail = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });

    if (mode === "MCQ_ONLY") {
      if (!hasMcq) fail("MCQ_ONLY requires an MCQ set.", "mcqSet");
      if (hasRubric) fail("MCQ_ONLY modules have no rubric — remove it or change the mode.", "rubric");
      if (hasPrompt) fail("MCQ_ONLY modules have no prompt template — remove it or change the mode.", "promptTemplate");
      if (v.taskText) fail("MCQ_ONLY modules have no task text — remove it or change the mode.", "taskText");
      return;
    }

    // Both free-text modes need the task itself plus something to assess it with. The database
    // column is nullable, so without this a version saves fine and only fails at publish.
    if (!v.taskText) fail("Free-text modules require taskText.", "taskText");
    if (!hasRubric) fail("Free-text modules require a rubric.", "rubric");
    if (!hasPrompt) fail("Free-text modules require a prompt template.", "promptTemplate");

    if (mode === "FREETEXT_ONLY" && hasMcq) {
      fail("FREETEXT_ONLY modules have no MCQ set — remove it or change the mode.", "mcqSet");
    }
    if (mode === "FREETEXT_PLUS_MCQ" && !hasMcq) {
      fail("FREETEXT_PLUS_MCQ requires an MCQ set.", "mcqSet");
    }
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
  // #896 S4: optional, matching the SAVE schema (`mcqSetVersionBodySchema`). It was required here
  // only, so a question saved without a rationale — perfectly legal — could not be sent for
  // localization: the request 400'd before the model ran, and "translate what is missing" could
  // never finish for that module.
  rationale: z.string().trim().min(1).optional(),
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
    // #930: eksporten skriver tittelen slik den er lagret, og etter #930 kan den vaere et DELVIS
    // kart — «skrevet paa engelsk, ikke oversatt ennaa». Sto dette igjen paa
    // `localizedTextSchema` (streng eller alle tre), avviste importen fila eksporten nettopp
    // hadde laget.
    //
    // ⚠️ Noeyaktig samme feil som #912 rettet i dette skjemaet, se kommentaren under. Den gangen
    // gjaldt det `certificationLevel: null`; naa tittelen. Rundturen brytes hver gang skrivesiden
    // faar lov til noe lesesiden ikke.
    title: localizedTextMaybeUntranslatedSchema,
    description: localizedTextMaybeUntranslatedSchema.nullable().optional(),
    // #912: nullable, matching the COURSE export payload below and matching what the exporter
    // actually writes. `certificationLevel` is optional at module creation, the export emits
    // `null` when it was never set, and the importer already handles null — only this schema
    // disagreed. The round trip was therefore broken for exactly the modules made fastest: export
    // succeeded, import rejected the file it had just produced.
    certificationLevel: certificationLevelInputSchema.nullable(),
  }),
  activeVersion: z.object({
    // #525/#547: MCQ_ONLY exports omit taskText/rubric/promptTemplate (no free-text assessment).
    assessmentMode: assessmentModeSchema.optional(),
    // #905: must accept the same partial shape the module-version body now stores, or a
    // partially translated module can be saved but never exported, duplicated or re-imported
    // - the envelope emits what is stored, and import would reject its own export.
    taskText: localizedTextMaybeUntranslatedSchema.nullable().optional(),
    assessorExpectedContent: localizedTextMaybeUntranslatedSchema.nullable().optional(),
    candidateTaskConstraints: localizedTextMaybeUntranslatedSchema.nullable().optional(),
    assessmentBlueprint: z.string().nullable().optional(),
    submissionSchema: submissionSchemaBodySchema.nullable().optional(),
    assessmentPolicy: assessmentPolicyBodySchema.nullable().optional(),
    rubric: rubricBodySchema.nullable().optional(),
    promptTemplate: promptTemplateBodySchema.nullable().optional(),
    // #578: FREETEXT_ONLY exports have no MCQ set.
    mcqSet: mcqSetBodySchema.nullable().optional(),
    audit: exportAuditSchema,
  }),
});

// One section figure/image inlined into the export (#749, Layer A). The blob binary
// travels as base64 so the file is self-contained; on import it is decoded, SVG is
// re-sanitised, stored to a fresh blob, and the section's `asset:<sourceId>` markdown
// refs are remapped to the newly created SectionAsset id. `sourceId` is the SectionAsset
// id in the SOURCE environment — used ONLY to match markdown refs, never persisted as an id.
// `sourceLocale` + `localizedVariants` carry the #657 localized-SVG variants.
export const sectionAssetExportSchema = z.object({
  sourceId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  contentBase64: z.string().min(1),
  sourceLocale: z.string().min(1).nullable().optional(),
  localizedVariants: z
    .array(
      z.object({
        locale: z.string().min(1),
        contentBase64: z.string().min(1),
      }),
    )
    .optional(),
});

// One learning section's payload — title + active-version markdown, both
// localized. #749 (Layer A) adds an OPTIONAL `assets[]` carrying the section's
// figures/images inline (base64); old asset-less v1 files omit it and import
// unchanged. Sections legitimately have partial locales (an author may fill only
// nb), so the export uses the patch schema (string OR partial object), not the
// strict all-three-locale localizedTextSchema (#512 follow-up).
export const sectionExportPayloadSchema = z.object({
  title: localizedTextPatchSchema,
  bodyMarkdown: localizedTextPatchSchema,
  audit: exportAuditSchema.optional(),
  assets: z.array(sectionAssetExportSchema).optional(),
});

// Course export inlines each module's full payload so the file is
// self-contained (chosen 2026-05-19 over reference-only). #512 adds an optional
// `items` array carrying the full mixed module/section sequence; `modules` is
// kept (now optional) so v1 importers that only understand modules still work.
export const courseExportPayloadSchema = z.object({
  course: z.object({
    // #930: eksporten skriver tittelen slik den er lagret, og etter #930 kan den vaere et DELVIS
    // kart — «skrevet paa engelsk, ikke oversatt ennaa». Sto dette igjen paa
    // `localizedTextSchema` (streng eller alle tre), avviste importen fila eksporten nettopp
    // hadde laget.
    //
    // ⚠️ Noeyaktig samme feil som #912 rettet i dette skjemaet, se kommentaren under. Den gangen
    // gjaldt det `certificationLevel: null`; naa tittelen. Rundturen brytes hver gang skrivesiden
    // faar lov til noe lesesiden ikke.
    title: localizedTextMaybeUntranslatedSchema,
    description: localizedTextMaybeUntranslatedSchema.nullable().optional(),
    certificationLevel: certificationLevelInputSchema.nullable(),
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
  // #916: a section can now travel on its own, not only inlined in a course package. The payload
  // shape is the SAME `sectionExportPayloadSchema` the course envelope already carries, so a
  // section lifted out of a course file and a standalone export are byte-compatible.
  scope: z.enum(["module", "course", "section"]),
  module: moduleExportPayloadSchema.optional(),
  course: courseExportPayloadSchema.optional(),
  section: sectionExportPayloadSchema.optional(),
}).refine(
  (env) => (env.scope === "module") === (env.module !== undefined),
  { message: "envelope.scope must match payload (module envelopes need a module field)" },
).refine(
  (env) => (env.scope === "course") === (env.course !== undefined),
  { message: "envelope.scope must match payload (course envelopes need a course field)" },
).refine(
  (env) => (env.scope === "section") === (env.section !== undefined),
  { message: "envelope.scope must match payload (section envelopes need a section field)" },
);

export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>;
export type ModuleExportPayload = z.infer<typeof moduleExportPayloadSchema>;
export type SectionExportPayload = z.infer<typeof sectionExportPayloadSchema>;
export type SectionAssetExport = z.infer<typeof sectionAssetExportSchema>;
export type CourseExportPayload = z.infer<typeof courseExportPayloadSchema>;

// #937: en forfatter som løfter én seksjon ut av en kursfil sitter igjen med kurselementet
// `{ type: "SECTION", sortOrder, section }` — ett nivå OVER konvolutten. Kommentaren på
// `exportEnvelopeSchema` sier at «a section lifted out of a course file and a standalone export are
// byte-compatible», og det stemmer om *payloaden*. Det er bare innpakningen som mangler, og å be
// forfatteren skrive tre felt for hånd i en teksteditor er et dårlig svar på et problem vi kan løse
// selv.
//
// Tar imot tre former og returnerer alltid en konvolutt:
//   1. ferdig konvolutt          -> uendret
//   2. kurselement (SECTION)     -> pakkes inn
//   3. bar seksjons-payload      -> pakkes inn
//
// `wrapped: true` sier at opphavet var et fragment. Det MÅ bæres videre: en innpakket fil har ingen
// ekte `exportedAt`, og revisjonssporet skal føre det ærlig i stedet for å påstå et
// eksporttidspunkt vi har funnet på.
export type NormalizedImport =
  | { ok: true; envelope: unknown; wrapped: boolean }
  | { ok: false; reason: "not_recognisable" };

// ⚠️ Gjelder ALLE tre importflatene, ikke bare seksjoner. Vår egen kurseksport skriver
// `items[]` som `{ type: "MODULE" | "SECTION", sortOrder, ... }` (adminContentQueries.ts:244-248),
// så en forfatter som løfter ut et MODULE-element treffer nøyaktig samme vegg som produkteier
// gjorde med et SECTION-element. Å fikse bare seksjonssiden ville vært «riktig fiks, ufullstendig
// flate» — repoets vanligste feilklasse — med defekten liggende igjen én side unna.
function looksLikePayload(value: unknown, scope: "module" | "course" | "section"): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // Bevisst grunn sjekk: her avgjøres BARE hvilken form fila har. Om innholdet er gyldig avgjør
  // det ekte skjemaet etterpå — og det gir en langt bedre feilmelding for et ekte innholdsproblem
  // enn en formgjetning ville gjort.
  if (scope === "section") return v.title !== undefined && v.bodyMarkdown !== undefined;
  if (scope === "course") return typeof v.course === "object" && v.course !== null;
  // ⚠️ Sto tidligere som `v.module || v.versions || v.title`. To feil: `versions` finnes ikke i
  // det vi eksporterer (feltet heter `activeVersion`), og `title` alene fanger enhver JSON med en
  // tittel — inkludert en seksjonsfil valgt på Moduler-siden. Den ble da pakket inn som modul og
  // fikk en Zod-dump om `payload.module.module`, altså en DÅRLIGERE melding enn de tre manglende
  // konvoluttfeltene den fikk før. Toleranse skal aldri gjøre feilmeldingen verre.
  // `moduleExportPayloadSchema` krever begge feltene, så det er begge vi kjenner den igjen på.
  return v.module !== undefined && v.activeVersion !== undefined;
}

export function normalizeImportPayload(
  raw: unknown,
  scope: "module" | "course" | "section",
  now: () => string = () => new Date().toISOString(),
): NormalizedImport {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not_recognisable" };
  const value = raw as Record<string, unknown>;

  // Allerede en konvolutt — send den videre urørt. Er `exportFormat` feil, skal forfatteren få
  // FORMAT-feilen, ikke en forvirrende innpakking av noe som utga seg for å være en konvolutt.
  if (value.exportFormat !== undefined || value.scope !== undefined) {
    return { ok: true, envelope: raw, wrapped: false };
  }

  // Kurselement løftet ut av en kursfil. `type` er MODULE/SECTION — kurs finnes ikke som element.
  const itemType = scope === "section" ? "SECTION" : "MODULE";
  const inner = scope === "section" ? value.section : value.module;
  if (scope !== "course" && value.type === itemType && looksLikePayload(inner, scope)) {
    return {
      ok: true,
      wrapped: true,
      envelope: { exportFormat: EXPORT_FORMAT_VERSION, exportedAt: now(), scope, [scope]: inner },
    };
  }

  // Bar payload.
  if (looksLikePayload(value, scope)) {
    return {
      ok: true,
      wrapped: true,
      envelope: {
        exportFormat: EXPORT_FORMAT_VERSION,
        exportedAt: now(),
        scope,
        [scope]: raw,
      },
    };
  }

  return { ok: false, reason: "not_recognisable" };
}

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
  // AA-2 (#650): echoed back in the response for agent plan→ID mapping; never persisted.
  clientRef: clientRefSchema.optional(),
  // AA-5 (#653): stamped into the import's audit event (source: agent_authoring).
  agentRunId: agentRunIdSchema.optional(),
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
