// Unit tests for blueprint-aware pre-publish validation (#372 phase 6).
// Pure-logic tests — no DB or HTTP. Covers the two new exports:
//   - validateBlueprintAgainstContent
//   - validateModuleVersionForPublish

import { describe, it, expect } from "vitest";
import {
  validateBlueprintAgainstContent,
  validateModuleVersionForPublish,
} from "../../src/modules/adminContent/contentValidationService.js";

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
});
