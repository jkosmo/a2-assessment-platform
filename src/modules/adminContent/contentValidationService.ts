import type { GeneratedMcqQuestion } from "./llmContentGenerationService.js";
import { localizedTextCodec } from "../../codecs/localizedTextCodec.js";

export type ValidationIssue = {
  severity: "blocking" | "warning";
  code: string;
  message: string;
  questionIndex?: number;
  // #896 S4: translation issues carry the field and the missing locales as data, not only inside
  // the message. The UI has to offer "translate what is missing", and an action that has to
  // re-parse an English sentence to know what to do is an action that breaks on the next reword.
  field?: string;
  missingLocales?: string[];
};

export type McqValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

/**
 * Validates MCQ distractor quality based on metadata returned by the generation LLM.
 * Blocks publication if any question has eliminationRisk: "high".
 * Warns if multiple questions have eliminationRisk: "medium".
 */
export function validateMcqDistractors(questions: GeneratedMcqQuestion[]): McqValidationResult {
  const issues: ValidationIssue[] = [];
  let mediumRiskCount = 0;

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (!question) continue;

    if (question.eliminationRisk === "high") {
      issues.push({
        severity: "blocking",
        code: "DISTRACTOR_ELIMINATION_RISK_HIGH",
        message: `Question ${index + 1}: one or more options can be eliminated without domain reasoning (eliminationRisk: high). Regenerate or revise this question.`,
        questionIndex: index,
      });
    } else if (question.eliminationRisk === "medium") {
      mediumRiskCount += 1;
      issues.push({
        severity: "warning",
        code: "DISTRACTOR_ELIMINATION_RISK_MEDIUM",
        message: `Question ${index + 1}: at least one option may be eliminable without full domain reasoning (eliminationRisk: medium). Consider revising.`,
        questionIndex: index,
      });
    }

    if (question.distractorMetadata && question.distractorMetadata.length > 0) {
      const weakDistractors = question.distractorMetadata.filter(
        (d) => !d.whyTempting || !d.whyWrongUnderStem || !d.wouldBeCorrectIf,
      );
      if (weakDistractors.length > 0) {
        issues.push({
          severity: "warning",
          code: "DISTRACTOR_METADATA_INCOMPLETE",
          message: `Question ${index + 1}: ${weakDistractors.length} distractor(s) have incomplete quality metadata. Plausibility may be insufficient.`,
          questionIndex: index,
        });
      }
    }
  }

  if (mediumRiskCount > Math.floor(questions.length / 2)) {
    issues.push({
      severity: "warning",
      code: "DISTRACTOR_QUALITY_PATTERN",
      message: `${mediumRiskCount} of ${questions.length} questions have medium elimination risk. The overall MCQ set may be easier than intended.`,
    });
  }

  const hasBlockingIssues = issues.some((issue) => issue.severity === "blocking");
  return {
    valid: !hasBlockingIssues,
    issues,
  };
}

/**
 * Validates that a module draft has candidateTaskConstraints when assessor content is present,
 * and that the candidateTaskConstraints is not excessively long.
 */
export function validateModuleDraft(
  taskText: string,
  candidateTaskConstraints: string | undefined | null,
  assessorExpectedContent: string | undefined | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (assessorExpectedContent && assessorExpectedContent.trim().length > 0 && (!candidateTaskConstraints || candidateTaskConstraints.trim().length === 0)) {
    issues.push({
      severity: "warning",
      code: "MISSING_CANDIDATE_TASK_CONSTRAINTS",
      message: "Assessor content (assessorExpectedContent) is set but candidateTaskConstraints is empty. Candidates will only see the task text with no scope guidance.",
    });
  }

  if (candidateTaskConstraints && candidateTaskConstraints.split(/\s+/).length > 80) {
    issues.push({
      severity: "warning",
      code: "CANDIDATE_TASK_CONSTRAINTS_TOO_LONG",
      message: "candidateTaskConstraints exceeds 80 words. It should be 1–3 short sentences so it does not function as an answer outline.",
    });
  }

  if (!taskText || taskText.trim().length < 20) {
    issues.push({
      severity: "blocking",
      code: "TASK_TEXT_TOO_SHORT",
      message: "taskText is too short to constitute a meaningful assessment task.",
    });
  }

  return issues;
}

export type ScenarioValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export function validateScenarioDraft(
  taskText: string,
  candidateTaskConstraints: string | undefined | null,
  assessorExpectedContent: string | undefined | null,
): ScenarioValidationResult {
  const issues: ValidationIssue[] = validateModuleDraft(taskText, candidateTaskConstraints, assessorExpectedContent);

  if (!assessorExpectedContent || assessorExpectedContent.trim().length === 0) {
    issues.push({
      severity: "blocking",
      code: "MISSING_ASSESSOR_EXPECTED_CONTENT",
      message: "assessorExpectedContent is required. It must describe what a strong response contains so assessors have grading support.",
    });
  }

  const hasBlockingIssues = issues.some((issue) => issue.severity === "blocking");
  return { valid: !hasBlockingIssues, issues };
}

// Blueprint-aware pre-publish check (#372). Compares the about-to-be-published
// content against the assessment blueprint that the author confirmed during
// generation (#372 stored on ModuleVersion). Returns blocking issues for hard
// contract violations and warnings for soft deviations.
//
// What this CAN check without an LLM call:
// - MCQ count vs blueprint's suggestedCount (off-by-many implies the set was
//   over- or under-generated relative to the calibration intent)
// - Whether key learning objectives appear at all in taskText / assessor
//   expected content (cheap substring check; not semantic, but catches the
//   "blueprint was ignored entirely" case)
//
// What this CANNOT do without an LLM:
// - Actor count, concept count, tradeoff count in taskText (needs NLP)
// - Topic distribution validation across MCQs (needs per-question tagging
//   which #370 metadata could provide but isn't propagated through validation yet)
//
// Those deeper checks are tracked as #371 follow-ups.
type BlueprintLike = {
  learningObjectives?: string[];
  keyTopics?: string[];
  complexityBudget?: { actors?: number; concepts?: number; tradeoffs?: number };
  mcqProfile?: { suggestedCount?: number };
};

export function validateBlueprintAgainstContent(
  blueprint: BlueprintLike | null | undefined,
  content: {
    taskText: string;
    assessorExpectedContent?: string | null;
    mcqQuestionCount: number;
  },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!blueprint) return issues;

  const suggestedCount = blueprint.mcqProfile?.suggestedCount;
  if (typeof suggestedCount === "number" && suggestedCount > 0) {
    const actual = content.mcqQuestionCount;
    const ratio = actual / suggestedCount;
    if (ratio < 0.5) {
      issues.push({
        severity: "blocking",
        code: "MCQ_COUNT_FAR_BELOW_BLUEPRINT",
        message: `Blueprint suggested ${suggestedCount} MCQ questions but only ${actual} are present (${Math.round(ratio * 100)}%). This likely means the MCQ set was not regenerated after blueprint changes.`,
      });
    } else if (ratio < 0.8 || ratio > 1.5) {
      issues.push({
        severity: "warning",
        code: "MCQ_COUNT_DEVIATES_FROM_BLUEPRINT",
        message: `Blueprint suggested ${suggestedCount} MCQ questions but ${actual} are present. Calibration may drift; consider revising.`,
      });
    }
  }

  // Substring presence check: at least one learning objective should be
  // mentionable from the visible content. This is intentionally minimal — a
  // genuine semantic check needs an LLM. Catches "blueprint was completely
  // ignored" but not "blueprint was paraphrased."
  const objectives = (blueprint.learningObjectives ?? []).filter((o) => typeof o === "string" && o.trim().length > 0);
  if (objectives.length > 0) {
    const haystack = `${content.taskText} ${content.assessorExpectedContent ?? ""}`.toLowerCase();
    const matched = objectives.filter((o) => {
      // Use the first 4 alphanumeric words of the objective as a fingerprint —
      // any tighter match would over-block paraphrased content.
      const fingerprint = o.toLowerCase().split(/\W+/).filter(Boolean).slice(0, 4).join(" ");
      return fingerprint.length > 0 && haystack.includes(fingerprint);
    });
    if (matched.length === 0) {
      issues.push({
        severity: "warning",
        code: "BLUEPRINT_OBJECTIVES_NOT_REFERENCED",
        message: `None of the ${objectives.length} learning objective(s) from the blueprint appear in taskText or assessor guidance. Check that the generation actually consumed the blueprint.`,
      });
    }
  }

  return issues;
}

export type ModuleVersionPublishValidation = {
  valid: boolean;
  issues: ValidationIssue[];
};

// Composite pre-publish check that runs every available validator against the
// module version's content and returns a single roll-up.
//
// IMPORTANT: This gate is intentionally narrower than the generation-time
// validator. It blocks publish ONLY on issues that imply the BLUEPRINT was
// ignored (the actual #372 contract). Generation-time scenario/MCQ findings
// (missing assessorExpectedContent, weak distractors, etc.) surface as
// warnings only — those checks existed before this gate was wired in, and
// retroactively blocking publish on them would invalidate published modules
// that worked under the old rules. A future enhancement could promote them to
// blocking via a separate strict-mode flag.
/**
 * #896 S4: which locales a published field is missing.
 *
 * A value stored as a plain string is "written in one language, not translated yet" (#892/#905);
 * a locale object names exactly the languages it has. Both shapes are readable, which is the
 * whole reason this check can exist — before #905 an untranslated field arrived as three
 * identical copies and was indistinguishable from a translated one.
 *
 * Returns the missing locales, newest-first order irrelevant. An empty array means complete.
 */
export function missingLocalesFor(raw: string | null | undefined, sourceLocale = "nb"): string[] {
  const all = ["en-GB", "nb", "nn"];
  const parsed = localizedTextCodec.parse(raw ?? null);
  if (parsed === null) return [];
  if (typeof parsed === "string") {
    // One language, and we cannot tell which — the field carries no locale marker. Everything
    // except the author's working language is missing.
    return all.filter((locale) => locale !== sourceLocale);
  }
  return all.filter((locale) => {
    const value = parsed[locale as "en-GB" | "nb" | "nn"];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

/**
 * #896 S4: the translation gate. Publishing is the moment content reaches participants, so it is
 * the right place to stop a half-translated module — and the only place where blocking costs the
 * author nothing they cannot immediately fix.
 *
 * Blocking, not a warning: a warning at publish is a warning nobody reads. The author gets the
 * exact field/locale pairs so the fix is mechanical.
 */
export function validateTranslationCompleteness(
  fields: Array<{ field: string; raw: string | null | undefined }>,
  sourceLocale = "nb",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { field, raw } of fields) {
    const missing = missingLocalesFor(raw, sourceLocale);
    if (missing.length > 0) {
      issues.push({
        severity: "blocking",
        code: "translation_incomplete",
        message: `${field}: missing ${missing.join(", ")}`,
        field,
        missingLocales: missing,
      });
    }
  }
  return issues;
}

/**
 * #896 S4: MCQ content is participant-facing too. An MCQ-only module whose questions exist only in
 * Norwegian is exactly as broken for an English participant as an untranslated task text — more so,
 * since for that module type the questions ARE the assessment.
 *
 * Reported per question rather than per option: "question 2 is missing nn" is something an author
 * can act on; eight separate issues for one question's stem, four options and answer is a wall.
 * `rationale` is included because it is shown in participant feedback after submission.
 */
export function validateMcqTranslationCompleteness(
  questions: Array<{
    stem?: string | null;
    optionsJson?: string | null;
    correctAnswer?: string | null;
    rationale?: string | null;
  }>,
  sourceLocale = "nb",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  questions.forEach((question, index) => {
    const parts: Array<string | null | undefined> = [question.stem, question.correctAnswer, question.rationale];
    // optionsJson is an array of LocalizedText, each serialized in turn.
    if (question.optionsJson) {
      try {
        const options: unknown = JSON.parse(question.optionsJson);
        if (Array.isArray(options)) {
          for (const option of options) {
            parts.push(typeof option === "string" ? option : JSON.stringify(option));
          }
        }
      } catch {
        // Unparseable options are a different defect; the translation gate says nothing about it.
      }
    }
    const missing = new Set<string>();
    for (const part of parts) {
      if (part === null || part === undefined || part === "") continue;
      for (const locale of missingLocalesFor(part, sourceLocale)) missing.add(locale);
    }
    if (missing.size > 0) {
      const missingLocales = [...missing].sort();
      issues.push({
        severity: "blocking",
        code: "translation_incomplete",
        message: `mcq.question${index + 1}: missing ${missingLocales.join(", ")}`,
        field: `mcq.question${index + 1}`,
        missingLocales,
      });
    }
  });
  return issues;
}

export function validateModuleVersionForPublish(input: {
  taskText: string;
  candidateTaskConstraints?: string | null;
  assessorExpectedContent?: string | null;
  blueprint?: BlueprintLike | null;
  mcqQuestionCount: number;
  mcqQuestions?: GeneratedMcqQuestion[];
}): ModuleVersionPublishValidation {
  // Generation-time checks — included as warnings, never blocking at publish.
  const scenarioIssues = validateScenarioDraft(
    input.taskText,
    input.candidateTaskConstraints,
    input.assessorExpectedContent,
  ).issues.map((issue) => ({ ...issue, severity: "warning" as const }));

  // Blueprint checks — these CAN block at publish, since a blueprint mismatch
  // means the author published content that doesn't honour their own contract.
  const blueprintIssues = validateBlueprintAgainstContent(input.blueprint, {
    taskText: input.taskText,
    assessorExpectedContent: input.assessorExpectedContent,
    mcqQuestionCount: input.mcqQuestionCount,
  });

  // MCQ distractor checks — warnings only at publish.
  const mcqIssues = input.mcqQuestions
    ? validateMcqDistractors(input.mcqQuestions).issues.map((issue) => ({ ...issue, severity: "warning" as const }))
    : [];

  const issues = [...scenarioIssues, ...blueprintIssues, ...mcqIssues];
  const valid = !issues.some((i) => i.severity === "blocking");
  return { valid, issues };
}
