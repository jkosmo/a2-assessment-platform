import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import {
  createRubricVersion,
  createPromptTemplateVersion,
  createMcqSetVersion,
  createModuleVersion,
  updateModuleTitle,
} from "./adminContentCommands.js";
import type { LocalizedText } from "../../codecs/localizedTextCodec.js";
import { localizedTextCodec } from "../../codecs/localizedTextCodec.js";
import { createAdminContentRepository } from "./adminContentRepository.js";

/**
 * #906: compose a complete module version in ONE transaction.
 *
 * Saving used to be five independent HTTP calls — title PATCH, rubric, prompt template, MCQ set,
 * then the module version that ties them together. Each committed on its own, so a failure on the
 * last one left the module with a new title and orphaned component versions but no version
 * pointing at them; pressing "save" again produced a second set. #896 S2 merged the author-facing
 * steps into one button, which made that fragility easier to hit and impossible to see.
 *
 * The pieces were always composable — `importModuleFromEnvelope` has done exactly this since #796,
 * because every command already accepts a transaction client. This is that same composition,
 * exposed for ordinary authoring rather than only for import.
 *
 * All-or-nothing: either a new version exists with everything it references, or the module is
 * untouched.
 */

export interface ComposeModuleVersionInput {
  moduleId: string;
  actorId: string;
  /** Renames the module inside the same transaction as the version. */
  title?: LocalizedText;
  /**
   * Module-level fields, applied in the same transaction. They belong to the module rather than
   * the version, but an author changes them in the same breath as the rest — and until #896 S3b
   * they could not be changed at all after creation.
   */
  description?: LocalizedText | null;
  certificationLevel?: LocalizedText;
  validFrom?: Date | null;
  validTo?: Date | null;
  assessmentMode?: "FREETEXT_PLUS_MCQ" | "MCQ_ONLY" | "FREETEXT_ONLY";
  taskText?: LocalizedText;
  assessorExpectedContent?: LocalizedText;
  candidateTaskConstraints?: LocalizedText;
  assessmentBlueprint?: string;
  /** Creates a new RubricVersion. Omit to reuse the module's active rubric. */
  rubric?: { criteria: Record<string, unknown>; scalingRule: Record<string, unknown> };
  /** Creates a new PromptTemplateVersion. Omit to reuse the active one. */
  promptTemplate?: { systemPrompt: LocalizedText; userPromptTemplate: LocalizedText; examples?: Array<Record<string, unknown>> };
  /** Creates a new MCQSetVersion. Omit to reuse the active one. */
  mcqSet?: { title: LocalizedText; questions: Array<Record<string, unknown>> };
  /** Reuse existing component versions instead of creating new ones. */
  rubricVersionId?: string;
  promptTemplateVersionId?: string;
  mcqSetVersionId?: string;
  submissionSchema?: unknown;
  assessmentPolicy?: unknown;
}

function serialize(value: LocalizedText | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return localizedTextCodec.serialize(value);
}

function serializeRequired(value: LocalizedText): string {
  return localizedTextCodec.serialize(value);
}

export async function composeModuleVersion(input: ComposeModuleVersionInput, existingTx?: DbTransactionClient) {
  const run = async (tx: DbTransactionClient) => {
    // The rename belongs to the same commitment. Saving it separately is how a failed version
    // used to leave a module renamed with nothing else to show for it.
    if (input.title !== undefined) {
      await updateModuleTitle(input.moduleId, input.title, input.actorId, tx);
    }

    const detailPatch: {
      description?: string | null;
      certificationLevel?: string;
      validFrom?: Date | null;
      validTo?: Date | null;
    } = {};
    if (input.description !== undefined) {
      detailPatch.description = input.description === null ? null : localizedTextCodec.serialize(input.description);
    }
    if (input.certificationLevel !== undefined) {
      detailPatch.certificationLevel = localizedTextCodec.serialize(input.certificationLevel);
    }
    if (input.validFrom !== undefined) detailPatch.validFrom = input.validFrom;
    if (input.validTo !== undefined) detailPatch.validTo = input.validTo;
    if (Object.keys(detailPatch).length > 0) {
      // validTo before validFrom would let a module be published into a window that can never
      // open. createModule already refuses it; an update has to refuse it too.
      const from = detailPatch.validFrom ?? undefined;
      const to = detailPatch.validTo ?? undefined;
      if (from && to && to < from) {
        throw new Error("validTo must be on or after validFrom.");
      }
      await createAdminContentRepository(tx).updateModuleDetails(input.moduleId, detailPatch);
    }

    const isMcqOnly = input.assessmentMode === "MCQ_ONLY";
    const isFreetextOnly = input.assessmentMode === "FREETEXT_ONLY";

    // MCQ_ONLY has no rubric or prompt; FREETEXT_ONLY has no MCQ set (#525/#578). Passing one
    // anyway is a caller mistake, not something to silently drop — createModuleVersion below
    // enforces the same rules, so an inconsistent request fails before anything is written.
    const rubric = !isMcqOnly && input.rubric
      ? await createRubricVersion({
          moduleId: input.moduleId,
          criteria: input.rubric.criteria,
          scalingRule: input.rubric.scalingRule,
          active: true,
        }, tx)
      : null;

    const promptTemplate = !isMcqOnly && input.promptTemplate
      ? await createPromptTemplateVersion({
          moduleId: input.moduleId,
          systemPrompt: serializeRequired(input.promptTemplate.systemPrompt),
          userPromptTemplate: serializeRequired(input.promptTemplate.userPromptTemplate),
          examples: input.promptTemplate.examples ?? [],
          active: true,
        }, tx)
      : null;

    const mcqSet = !isFreetextOnly && input.mcqSet
      ? await createMcqSetVersion({
          moduleId: input.moduleId,
          title: serializeRequired(input.mcqSet.title),
          active: true,
          // Every field is serialized, not cast. The schema accepts locale objects here — which
          // is exactly what arrives after translation — and Prisma stores strings. The earlier
          // `as never` sailed past the compiler and would have failed at runtime on any real,
          // translated MCQ; the tests only used plain strings and so never saw it.
          questions: input.mcqSet.questions.map((question) => {
            const q = question as {
              stem: LocalizedText;
              options: LocalizedText[];
              correctAnswer: LocalizedText;
              rationale?: LocalizedText;
            };
            return {
              stem: serializeRequired(q.stem),
              options: q.options.map((option) => serializeRequired(option)),
              correctAnswer: serializeRequired(q.correctAnswer),
              rationale: q.rationale ? serializeRequired(q.rationale) : undefined,
            };
          }),
        }, tx)
      : null;

    const moduleVersion = await createModuleVersion({
      moduleId: input.moduleId,
      assessmentMode: input.assessmentMode,
      taskText: isMcqOnly ? undefined : serialize(input.taskText),
      assessorExpectedContent: isMcqOnly ? undefined : serialize(input.assessorExpectedContent),
      candidateTaskConstraints: isMcqOnly ? undefined : serialize(input.candidateTaskConstraints),
      assessmentBlueprint: input.assessmentBlueprint,
      // A freshly created component wins over an id the caller passed for the same slot.
      rubricVersionId: rubric?.id ?? input.rubricVersionId,
      promptTemplateVersionId: promptTemplate?.id ?? input.promptTemplateVersionId,
      mcqSetVersionId: mcqSet?.id ?? input.mcqSetVersionId,
      submissionSchemaJson: input.submissionSchema ? JSON.stringify(input.submissionSchema) : undefined,
      assessmentPolicyJson: input.assessmentPolicy ? JSON.stringify(input.assessmentPolicy) : undefined,
    }, tx);

    return {
      moduleVersion,
      rubricVersion: rubric,
      promptTemplateVersion: promptTemplate,
      mcqSetVersion: mcqSet,
    };
  };

  // Callers already inside a transaction (import) compose into it rather than nesting.
  return existingTx ? run(existingTx) : runInTransaction(run);
}
