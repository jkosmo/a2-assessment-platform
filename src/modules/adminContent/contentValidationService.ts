import type { GeneratedMcqQuestion } from "./llmContentGenerationService.js";

export type ValidationIssue = {
  severity: "blocking" | "warning";
  code: string;
  message: string;
  questionIndex?: number;
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
