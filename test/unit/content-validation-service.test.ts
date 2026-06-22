// Unit tests for blueprint-aware pre-publish validation (#372 phase 6) plus
// characterization of the remaining content validators (#599 baseline).
// Pure-logic tests — no DB or HTTP. Covers the exports:
//   - validateBlueprintAgainstContent
//   - validateModuleVersionForPublish
//   - validateMcqDistractors
//   - validateScenarioDraft
// These pin CURRENT behaviour before refactoring; they are characterization
// tests, not specifications.

import { describe, it, expect } from "vitest";
import {
  validateBlueprintAgainstContent,
  validateModuleVersionForPublish,
  validateMcqDistractors,
  validateScenarioDraft,
} from "../../src/modules/adminContent/contentValidationService.js";
import type { GeneratedMcqQuestion } from "../../src/modules/adminContent/llmContentGenerationService.js";

// Minimal MCQ factory — fields default to a "clean" low-risk question with no
// distractor metadata so each test can isolate the branch under test.
function mcq(overrides: Partial<GeneratedMcqQuestion> = {}): GeneratedMcqQuestion {
  return {
    stem: "What is the capital of France?",
    options: ["Paris", "London", "Berlin", "Madrid"],
    correctAnswer: "Paris",
    rationale: "Paris is the capital of France.",
    ...overrides,
  };
}

describe("validateBlueprintAgainstContent", () => {
  it("returns no issues when blueprint is null", () => {
    expect(
      validateBlueprintAgainstContent(null, {
        taskText: "Anything",
        assessorExpectedContent: null,
        mcqQuestionCount: 0,
      }),
    ).toEqual([]);
  });

  it("blocks when MCQ count is below 50% of suggested", () => {
    const issues = validateBlueprintAgainstContent(
      { mcqProfile: { suggestedCount: 10 } },
      { taskText: "x", mcqQuestionCount: 3 },
    );
    expect(issues.some((i) => i.severity === "blocking" && i.code === "MCQ_COUNT_FAR_BELOW_BLUEPRINT")).toBe(true);
  });

  it("warns when MCQ count is between 50% and 80% of suggested", () => {
    const issues = validateBlueprintAgainstContent(
      { mcqProfile: { suggestedCount: 10 } },
      { taskText: "x", mcqQuestionCount: 6 },
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("MCQ_COUNT_DEVIATES_FROM_BLUEPRINT");
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("warns when MCQ count is more than 50% above suggested", () => {
    const issues = validateBlueprintAgainstContent(
      { mcqProfile: { suggestedCount: 10 } },
      { taskText: "x", mcqQuestionCount: 20 },
    );
    expect(issues.some((i) => i.code === "MCQ_COUNT_DEVIATES_FROM_BLUEPRINT")).toBe(true);
  });

  it("passes when MCQ count is within tolerance", () => {
    expect(
      validateBlueprintAgainstContent(
        { mcqProfile: { suggestedCount: 10 } },
        { taskText: "x", mcqQuestionCount: 9 },
      ),
    ).toEqual([]);
  });

  it("warns when no learning objective fingerprint appears in the content", () => {
    const issues = validateBlueprintAgainstContent(
      { learningObjectives: ["Explain photosynthesis steps to a peer"] },
      { taskText: "Submit an essay about cooking.", mcqQuestionCount: 0 },
    );
    expect(issues.some((i) => i.code === "BLUEPRINT_OBJECTIVES_NOT_REFERENCED")).toBe(true);
  });

  it("passes when at least one learning objective fingerprint appears", () => {
    // Fingerprint is the first 4 alphanumeric words of each objective. The
    // taskText must contain that literal substring (lowercase, single-space).
    const issues = validateBlueprintAgainstContent(
      { learningObjectives: ["Explain photosynthesis steps to a peer"] },
      {
        taskText: "Please explain photosynthesis steps to your study partner using examples.",
        assessorExpectedContent: null,
        mcqQuestionCount: 0,
      },
    );
    expect(issues.some((i) => i.code === "BLUEPRINT_OBJECTIVES_NOT_REFERENCED")).toBe(false);
  });
});

describe("validateModuleVersionForPublish", () => {
  const validBaseInput = {
    taskText: "Write a 300-word reflection on how photosynthesis converts light to chemical energy.",
    candidateTaskConstraints: "Use plain language. 250-450 words.",
    assessorExpectedContent: "A strong response references the Calvin cycle and chlorophyll briefly.",
    mcqQuestionCount: 5,
  };

  it("valid when all sub-validators pass and no blueprint provided", () => {
    const result = validateModuleVersionForPublish(validBaseInput);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "blocking")).toHaveLength(0);
  });

  it("warns but does NOT block when scenario draft is missing assessor content (publish-time leniency)", () => {
    // Generation-time scenario validator marks MISSING_ASSESSOR_EXPECTED_CONTENT
    // as blocking, but publish-time downgrades that to a warning so already-
    // authored modules (pre-#372) can still be published. Only blueprint
    // mismatches block at publish.
    const result = validateModuleVersionForPublish({
      ...validBaseInput,
      assessorExpectedContent: null,
    });
    expect(result.valid).toBe(true);
    const missing = result.issues.find((i) => i.code === "MISSING_ASSESSOR_EXPECTED_CONTENT");
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("warning");
  });

  it("invalid when blueprint MCQ count is far below actual", () => {
    const result = validateModuleVersionForPublish({
      ...validBaseInput,
      blueprint: { mcqProfile: { suggestedCount: 20 } },
      mcqQuestionCount: 2,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MCQ_COUNT_FAR_BELOW_BLUEPRINT")).toBe(true);
  });

  it("warnings do NOT make valid=false", () => {
    const result = validateModuleVersionForPublish({
      ...validBaseInput,
      blueprint: { learningObjectives: ["Explain photosynthesis"] },
      mcqQuestionCount: 5,
    });
    // The substring fingerprint "explain photosynthesis" IS in the taskText, so
    // no objective-not-referenced warning. Result should be fully valid.
    expect(result.valid).toBe(true);
  });

  it("downgrades MCQ distractor issues to warnings (never blocks publish)", () => {
    // A high-elimination-risk MCQ is BLOCKING in validateMcqDistractors, but at
    // publish-time it is downgraded to a warning and does not invalidate.
    const result = validateModuleVersionForPublish({
      ...validBaseInput,
      mcqQuestions: [mcq({ eliminationRisk: "high" })],
    });
    expect(result.valid).toBe(true);
    const issue = result.issues.find((i) => i.code === "DISTRACTOR_ELIMINATION_RISK_HIGH");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("omits MCQ issues entirely when mcqQuestions is not provided", () => {
    const result = validateModuleVersionForPublish(validBaseInput);
    expect(result.issues.some((i) => i.code.startsWith("DISTRACTOR_"))).toBe(false);
  });
});

describe("validateMcqDistractors", () => {
  it("returns valid with no issues for an empty question set", () => {
    expect(validateMcqDistractors([])).toEqual({ valid: true, issues: [] });
  });

  it("returns valid with no issues when all questions are low-risk and metadata-free", () => {
    const result = validateMcqDistractors([mcq(), mcq()]);
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it("blocks (valid=false) when a question has eliminationRisk high", () => {
    const result = validateMcqDistractors([mcq({ eliminationRisk: "high" })]);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "DISTRACTOR_ELIMINATION_RISK_HIGH");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("blocking");
    expect(issue?.questionIndex).toBe(0);
    // Message is 1-based.
    expect(issue?.message).toContain("Question 1");
  });

  it("warns (still valid) for a single medium-risk question", () => {
    const result = validateMcqDistractors([mcq({ eliminationRisk: "medium" }), mcq(), mcq()]);
    expect(result.valid).toBe(true);
    const issue = result.issues.find((i) => i.code === "DISTRACTOR_ELIMINATION_RISK_MEDIUM");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
  });

  it("adds DISTRACTOR_QUALITY_PATTERN when medium-risk count exceeds half the set", () => {
    // 2 of 3 are medium; floor(3/2)=1, 2 > 1 ⇒ pattern warning fires.
    const result = validateMcqDistractors([
      mcq({ eliminationRisk: "medium" }),
      mcq({ eliminationRisk: "medium" }),
      mcq(),
    ]);
    const pattern = result.issues.find((i) => i.code === "DISTRACTOR_QUALITY_PATTERN");
    expect(pattern).toBeDefined();
    expect(pattern?.severity).toBe("warning");
    expect(pattern?.questionIndex).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it("does NOT add DISTRACTOR_QUALITY_PATTERN when medium-risk count is exactly half (not strictly greater)", () => {
    // 1 of 2 medium; floor(2/2)=1, 1 > 1 is false ⇒ no pattern warning.
    const result = validateMcqDistractors([mcq({ eliminationRisk: "medium" }), mcq()]);
    expect(result.issues.some((i) => i.code === "DISTRACTOR_QUALITY_PATTERN")).toBe(false);
  });

  it("warns when distractor metadata is incomplete", () => {
    const result = validateMcqDistractors([
      mcq({
        distractorMetadata: [
          { option: "London", whyTempting: "looks plausible", whyWrongUnderStem: "", wouldBeCorrectIf: "different stem" },
        ],
      }),
    ]);
    const issue = result.issues.find((i) => i.code === "DISTRACTOR_METADATA_INCOMPLETE");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("1 distractor");
    expect(result.valid).toBe(true);
  });

  it("does not warn when distractor metadata is fully populated", () => {
    const result = validateMcqDistractors([
      mcq({
        distractorMetadata: [
          { option: "London", whyTempting: "a", whyWrongUnderStem: "b", wouldBeCorrectIf: "c" },
        ],
      }),
    ]);
    expect(result.issues.some((i) => i.code === "DISTRACTOR_METADATA_INCOMPLETE")).toBe(false);
  });

  it("skips holes in a sparse array without throwing", () => {
    const sparse = [mcq({ eliminationRisk: "high" }), undefined as unknown as GeneratedMcqQuestion];
    const result = validateMcqDistractors(sparse);
    // Only the present question is evaluated.
    expect(result.issues).toHaveLength(1);
    expect(result.valid).toBe(false);
  });
});

describe("validateScenarioDraft", () => {
  const goodTask = "Write a 300-word reflection on how photosynthesis converts light energy.";
  const goodConstraints = "Keep it to 250-450 words.";
  const goodAssessor = "A strong response references the Calvin cycle and chlorophyll.";

  it("is valid when task, constraints and assessor content are all present and well-formed", () => {
    const result = validateScenarioDraft(goodTask, goodConstraints, goodAssessor);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("blocks when assessorExpectedContent is missing", () => {
    const result = validateScenarioDraft(goodTask, goodConstraints, null);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "MISSING_ASSESSOR_EXPECTED_CONTENT");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("blocking");
  });

  it("treats whitespace-only assessor content as missing", () => {
    const result = validateScenarioDraft(goodTask, goodConstraints, "   ");
    expect(result.issues.some((i) => i.code === "MISSING_ASSESSOR_EXPECTED_CONTENT")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("blocks when taskText is shorter than 20 characters", () => {
    const result = validateScenarioDraft("too short", goodConstraints, goodAssessor);
    const issue = result.issues.find((i) => i.code === "TASK_TEXT_TOO_SHORT");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("blocking");
    expect(result.valid).toBe(false);
  });

  it("warns (does not block) when assessor content is set but constraints are empty", () => {
    const result = validateScenarioDraft(goodTask, "", goodAssessor);
    const issue = result.issues.find((i) => i.code === "MISSING_CANDIDATE_TASK_CONSTRAINTS");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    // No blocking issue ⇒ still valid.
    expect(result.valid).toBe(true);
  });

  it("warns when candidate constraints exceed 80 words", () => {
    const longConstraints = Array.from({ length: 81 }, (_, i) => `word${i}`).join(" ");
    const result = validateScenarioDraft(goodTask, longConstraints, goodAssessor);
    const issue = result.issues.find((i) => i.code === "CANDIDATE_TASK_CONSTRAINTS_TOO_LONG");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(result.valid).toBe(true);
  });

  it("accumulates multiple blocking issues (short task + missing assessor content)", () => {
    const result = validateScenarioDraft("tiny", goodConstraints, null);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain("TASK_TEXT_TOO_SHORT");
    expect(codes).toContain("MISSING_ASSESSOR_EXPECTED_CONTENT");
    expect(result.valid).toBe(false);
  });
});
