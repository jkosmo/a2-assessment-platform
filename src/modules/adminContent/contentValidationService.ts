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
  guidanceText: string | undefined | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (guidanceText && guidanceText.trim().length > 0 && (!candidateTaskConstraints || candidateTaskConstraints.trim().length === 0)) {
    issues.push({
      severity: "warning",
      code: "MISSING_CANDIDATE_TASK_CONSTRAINTS",
      message: "Assessor content (guidanceText) is set but candidateTaskConstraints is empty. Candidates will only see the task text with no scope guidance.",
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
