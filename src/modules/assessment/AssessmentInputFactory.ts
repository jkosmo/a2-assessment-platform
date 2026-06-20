import { preprocessSensitiveDataForLlm, type SensitiveDataPreprocessResult } from "./sensitiveDataMaskingService.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { assessmentPolicyCodec, type ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";

export type AssessmentInputContext = {
  /** Rubric criterion IDs extracted from the module rubric configuration. */
  rubricCriteriaIds: string[];
  /** Maximum possible rubric total score from the scaling rule. */
  rubricMaxTotal: number;
  /** Human-readable field labels from the submission schema, used in LLM prompt. */
  submissionFieldLabels: string[];
  /** Parsed assessment policy or null if not configured. */
  assessmentPolicy: ModuleAssessmentPolicy | null;
  /** Locale to use for prompt text and LLM response language. */
  submissionLocale: SupportedLocale;
  /** Sensitive data preprocessing result — contains the safe payload and masking metadata. */
  sensitiveDataPreprocess: SensitiveDataPreprocessResult;
  /** Task text, localized to the submission locale. */
  moduleTaskText: string;
  /** Optional guidance text, localized to the submission locale. */
  moduleGuidanceText: string | undefined;
  /** System prompt template for the LLM. */
  promptTemplateSystem: string;
  /** User prompt template for the LLM. */
  promptTemplateUserTemplate: string;
  /** Examples JSON string for the LLM prompt. */
  promptTemplateExamplesJson: string;
};

type SubmissionVersionShape = {
  assessmentPolicyJson: string | null;
  submissionSchemaJson?: string | null;
  // null for MCQ_ONLY modules (#525). buildAssessmentInputContext is only called for
  // FREETEXT_PLUS_MCQ modules, where these are guaranteed set — guarded at runtime below.
  taskText: string | null;
  assessorExpectedContent?: string | null;
  promptTemplateVersion: {
    systemPrompt: string;
    userPromptTemplate: string;
    examplesJson: string;
  } | null;
  rubricVersion: {
    criteriaJson: string;
    scalingRuleJson: string;
  } | null;
};

type SubmissionShape = {
  moduleId: string;
  responseJson: string;
  moduleVersion: SubmissionVersionShape;
};

/**
 * Builds the full AssessmentInputContext from a submission record.
 * Handles sensitive data masking, locale-aware text resolution,
 * and JSON parsing of rubric/policy/schema configuration.
 */
export function buildAssessmentInputContext(
  submission: SubmissionShape,
  submissionLocale: SupportedLocale,
): AssessmentInputContext {
  const { taskText, rubricVersion, promptTemplateVersion } = submission.moduleVersion;
  // Defensive: this builder is only reached for FREETEXT_PLUS_MCQ modules (MCQ_ONLY is gated out
  // earlier in runAssessment). These must be present for a free-text assessment.
  if (taskText == null || rubricVersion == null || promptTemplateVersion == null) {
    throw new Error("Free-text assessment requires taskText, rubric and prompt template configuration.");
  }

  const assessmentPolicy = assessmentPolicyCodec.parse(submission.moduleVersion.assessmentPolicyJson);

  const rubricCriteriaIds = parseRubricCriteriaIds(rubricVersion.criteriaJson);
  const rubricMaxTotal = parseRubricMaxTotal(rubricVersion.scalingRuleJson);
  const submissionFieldLabels = parseSubmissionFieldLabels(submission.moduleVersion.submissionSchemaJson, submissionLocale);

  const sensitiveDataPreprocess = preprocessSensitiveDataForLlm({
    moduleId: submission.moduleId,
    responseJson: JSON.parse(submission.responseJson) as Record<string, unknown>,
  });

  const moduleTaskText =
    localizeContentText(submissionLocale, taskText) ?? taskText;
  const moduleGuidanceText =
    localizeContentText(submissionLocale, submission.moduleVersion.assessorExpectedContent ?? "") ?? undefined;

  return {
    rubricCriteriaIds,
    rubricMaxTotal,
    submissionFieldLabels,
    assessmentPolicy,
    submissionLocale,
    sensitiveDataPreprocess,
    moduleTaskText,
    moduleGuidanceText,
    promptTemplateSystem: promptTemplateVersion.systemPrompt,
    promptTemplateUserTemplate: promptTemplateVersion.userPromptTemplate,
    promptTemplateExamplesJson: promptTemplateVersion.examplesJson,
  };
}

export function parseRubricCriteriaIds(criteriaJson: string): string[] {
  try {
    const parsed = JSON.parse(criteriaJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((c: { id?: string }) => c.id).filter((id): id is string => typeof id === "string");
    }
    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed as Record<string, unknown>);
    }
  } catch {
    // fall through
  }
  return [];
}

export function parseRubricMaxTotal(scalingRuleJson: string): number {
  try {
    const parsed = JSON.parse(scalingRuleJson) as { max_total?: unknown };
    if (typeof parsed.max_total === "number") {
      return parsed.max_total;
    }
  } catch {
    // fall through
  }
  return 20;
}

export function parseSubmissionFieldLabels(
  submissionSchemaJson: string | null | undefined,
  locale?: string,
): string[] {
  if (!submissionSchemaJson) return [];
  try {
    const parsed = JSON.parse(submissionSchemaJson) as {
      fields?: Array<{
        label?: string | Record<string, string>;
        placeholder?: string | Record<string, string>;
        id?: string;
      }>;
    };
    if (!Array.isArray(parsed.fields)) return [];
    return parsed.fields
      .map((field) => {
        const resolvedLabel = resolveLocalizedText(field.label, locale) ?? field.id ?? "";
        if (!resolvedLabel) return "";
        const resolvedPlaceholder = resolveLocalizedText(field.placeholder, locale);
        return resolvedPlaceholder ? `${resolvedLabel} (guidance: ${resolvedPlaceholder})` : resolvedLabel;
      })
      .filter((label) => label.length > 0);
  } catch {
    return [];
  }
}

function resolveLocalizedText(
  value: string | Record<string, string> | null | undefined,
  locale?: string,
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (locale && value[locale]) return value[locale];
  return value["en-GB"] ?? Object.values(value)[0] ?? null;
}
