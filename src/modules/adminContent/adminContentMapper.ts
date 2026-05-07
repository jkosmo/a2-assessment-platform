import { z } from "zod";
import { localizedTextCodec } from "../../codecs/localizedTextCodec.js";
import { submissionSchemaCodec } from "../../codecs/submissionSchemaCodec.js";
import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
import type {
  moduleCreateBodySchema,
  promptTemplateBodySchema,
  mcqSetBodySchema,
  moduleVersionBodySchema,
} from "./adminContentSchemas.js";

type ModuleCreateBody = z.infer<typeof moduleCreateBodySchema>;
type PromptTemplateBody = z.infer<typeof promptTemplateBodySchema>;
type McqSetBody = z.infer<typeof mcqSetBodySchema>;
type ModuleVersionBody = z.infer<typeof moduleVersionBodySchema>;

export function toCreateModuleInput(data: ModuleCreateBody, validFrom: Date | undefined, validTo: Date | undefined, actorId?: string) {
  return {
    title: localizedTextCodec.serialize(data.title),
    description: data.description ? localizedTextCodec.serialize(data.description) : undefined,
    certificationLevel: data.certificationLevel ? localizedTextCodec.serialize(data.certificationLevel) : undefined,
    validFrom,
    validTo,
    actorId,
  };
}

export function toCreatePromptTemplateVersionInput(data: PromptTemplateBody, moduleId: string) {
  return {
    moduleId,
    systemPrompt: localizedTextCodec.serialize(data.systemPrompt),
    userPromptTemplate: localizedTextCodec.serialize(data.userPromptTemplate),
    examples: data.examples ?? [],
    active: data.active ?? true,
  };
}

export function toCreateMcqSetVersionInput(data: McqSetBody, moduleId: string) {
  return {
    moduleId,
    title: localizedTextCodec.serialize(data.title),
    questions: data.questions.map((question) => ({
      stem: localizedTextCodec.serialize(question.stem),
      options: question.options.map((option) => localizedTextCodec.serialize(option)),
      correctAnswer: localizedTextCodec.serialize(question.correctAnswer),
      rationale: question.rationale ? localizedTextCodec.serialize(question.rationale) : undefined,
    })),
    active: data.active ?? true,
  };
}

export function toCreateModuleVersionInput(data: ModuleVersionBody, moduleId: string) {
  const submissionSchema = data.submissionSchema
    ? {
        fields: data.submissionSchema.fields.map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          ...(f.placeholder !== undefined ? { placeholder: f.placeholder } : {}),
        })),
      }
    : undefined;
  return {
    moduleId,
    taskText: localizedTextCodec.serialize(data.taskText),
    guidanceText: data.guidanceText ? localizedTextCodec.serialize(data.guidanceText) : undefined,
    candidateTaskConstraints: data.candidateTaskConstraints ? localizedTextCodec.serialize(data.candidateTaskConstraints) : undefined,
    rubricVersionId: data.rubricVersionId,
    promptTemplateVersionId: data.promptTemplateVersionId,
    mcqSetVersionId: data.mcqSetVersionId,
    submissionSchemaJson: submissionSchema ? submissionSchemaCodec.serialize(submissionSchema) : undefined,
    assessmentPolicyJson: data.assessmentPolicy ? assessmentPolicyCodec.serialize(data.assessmentPolicy) : undefined,
  };
}
