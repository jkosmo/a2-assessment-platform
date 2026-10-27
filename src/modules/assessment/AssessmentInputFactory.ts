import { preprocessSensitiveDataForLlm, type SensitiveDataPreprocessResult } from "./sensitiveDataMaskingService.js";
import { pickLocalizedValue } from "../../i18n/content.js";
import { localizeContentText } from "../../i18n/content.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { describedSteps, stepTexts } from "#rubric-check";
import { assessmentPolicyCodec, type ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";

// Each rubric criterion is scored on a 0–4 scale (decisionService clamps every score to [0,4]).
// The true rubric max is therefore (criteria count × 4) — see buildAssessmentInputContext (#578).
const RUBRIC_MAX_SCORE_PER_CRITERION = 4;

export type AssessmentInputContext = {
  /** Rubric criterion IDs extracted from the module rubric configuration. */
  rubricCriteriaIds: string[];
  /** #1135: what each criterion means — label, description with its steps, and its own scale — for the LLM prompt. */
  rubricCriteria: RubricCriterionForPrompt[];
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
  // #578 fix: the decision recomputes the rubric score by clamping each criterion to [0,4] and
  // summing, so the TRUE max is (criteria count × 4). A stored scalingRule.max_total can be stale
  // or wrong — e.g. a generated rubric with 4 criteria but max_total=24 made even a perfect answer
  // score 16/24 = 66.7%. That under-scored every FREETEXT_PLUS_MCQ practical and was fatal for
  // FREETEXT_ONLY (no MCQ to compensate → auto-fail of a perfect answer). Derive the max from the
  // actual criteria; only fall back to scalingRule.max_total when there are no criteria.
  const rubricMaxTotal = rubricCriteriaIds.length > 0
    ? rubricCriteriaIds.length * RUBRIC_MAX_SCORE_PER_CRITERION
    : parseRubricMaxTotal(rubricVersion.scalingRuleJson);
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
    rubricCriteria: parseRubricCriteriaForPrompt(rubricVersion.criteriaJson, submissionLocale),
    rubricMaxTotal,
    submissionFieldLabels,
    assessmentPolicy,
    submissionLocale,
    sensitiveDataPreprocess,
    moduleTaskText,
    moduleGuidanceText,
    // #1135: malene lagres som språkkart ({"en-GB": …, "nb": …}); uten oppslag fikk vurdereren hele
    // kartet som tekst, og poengene ble ustabile (vedtak «ikke plassert først» når det sto først).
    promptTemplateSystem: localizeContentText(submissionLocale, promptTemplateVersion.systemPrompt) ?? promptTemplateVersion.systemPrompt,
    promptTemplateUserTemplate: localizeContentText(submissionLocale, promptTemplateVersion.userPromptTemplate) ?? promptTemplateVersion.userPromptTemplate,
    promptTemplateExamplesJson: promptTemplateVersion.examplesJson,
  };
}

/**
 * #1135: KI-vurdereren fikk bare kriterienes ID-er («konkrete_regler») — ikke etiketten eller
 * beskrivelsen med trinnene («0 = …; 2 = …; 4 = …»). Poengene ble satt ut fra et ID-navn og forventet
 * innhold, og kriteriet deltakeren leser (#1124) var ikke det vurdereren brukte.
 *
 * Her leses det kriteriet SIER, på deltakerens språk. Formene i criteriaJson: en streng
 * («0–4: …»), et objekt (`label`, `description`, `maxScore`), eller bare en vekt (`{ weight }`,
 * standardrubrikken) — den siste har ingenting å si, og vurderes som før. Skalaen leses av samme
 * kode som skillets kriteriekontroll (`describedSteps` i rubric-check.mjs).
 */
export type RubricCriterionForPrompt = {
  id: string;
  label: string | null;
  description: string | null;
  /** Kriteriets egen skala, når den er en annen enn 0–4 (for eksempel 0–2). */
  scaleMax: number | null;
  /** Trinnene slik beskrivelsen nevner dem («1 = står der, men blandet …»); tom når den ikke gjør det. */
  steps?: Array<{ step: number; text: string }>;
};

function localizedField(value: unknown, locale: SupportedLocale): string | null {
  if (typeof value === "string") return value.trim() ? (localizeContentText(locale, value) ?? value).trim() : null;
  if (value && typeof value === "object") {
    const map = value as Record<string, unknown>;
    const picked = [locale, "nb", "nn", "en-GB"].map((key) => map[key]).find((v) => typeof v === "string" && v.trim());
    return typeof picked === "string" ? picked.trim() : null;
  }
  return null;
}

/** Kriteriene som [id, rått kriterium], i lagret rekkefølge — listeform (med `id`) eller objektform. */
export function parseRubricCriteriaEntries(criteriaJson: string): Array<[string, unknown]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(criteriaJson);
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((c) => typeof (c as { id?: unknown })?.id === "string").map((c) => [(c as { id: string }).id, c])
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed as Record<string, unknown>)
      : [];
}

/** Et kriterium som objekt (ikke en streng, og ikke bare et språkkart over en streng). */
export function isCriterionObject(criterion: unknown): criterion is Record<string, unknown> {
  return criterion !== null && typeof criterion === "object" && !isLocalizedMap(criterion);
}

export function parseRubricCriteriaForPrompt(criteriaJson: string, locale: SupportedLocale): RubricCriterionForPrompt[] {
  return parseRubricCriteriaEntries(criteriaJson).map(([id, criterion]) => {
    const isObject = isCriterionObject(criterion);
    const label = isObject ? localizedField((criterion as { label?: unknown }).label, locale) : null;
    const description = isObject ? localizedField((criterion as { description?: unknown }).description, locale) : localizedField(criterion, locale);
    const forStep = isObject ? { ...(criterion as object), description } : description;
    const steps = describedSteps(forStep);
    const scaleMax = steps.max !== null && steps.max !== RUBRIC_MAX_SCORE_PER_CRITERION && steps.min === 0 ? steps.max : null;
    return { id, label, description, scaleMax, steps: stepTexts(forStep, undefined, { defaultMax: RUBRIC_MAX_SCORE_PER_CRITERION }).steps };
  });
}

function isLocalizedMap(value: object): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key === "nb" || key === "nn" || key === "en-GB");
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
  // #1046: samme leserekkefølge som all annen innholdstekst (leserens språk → standardspråket → engelsk).
  return pickLocalizedValue(value, (locale ?? "en-GB") as SupportedLocale) ?? null;
}
