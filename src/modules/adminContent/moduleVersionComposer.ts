import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import {
  createRubricVersion,
  createPromptTemplateVersion,
  createMcqSetVersion,
  createModuleVersion,
} from "./adminContentCommands.js";
import type { LocalizedText } from "../../codecs/localizedTextCodec.js";
import { localizedTextCodec } from "../../codecs/localizedTextCodec.js";

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
          questions: input.mcqSet.questions as never,
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
