import { describe, expect, it } from "vitest";
import { resolveMcqOnlyDecision, DEFAULT_MCQ_ONLY_MIN_PERCENT } from "../../src/modules/assessment/decisionService.js";
import { moduleVersionBodySchema } from "../../src/modules/adminContent/adminContentSchemas.js";

// #525 — MCQ-only modules: pass/fail purely from the MCQ score vs a threshold (default 70%),
// and validation that drops the free-text requirements when assessmentMode is MCQ_ONLY.

describe("resolveMcqOnlyDecision", () => {
  it("defaults the MCQ pass threshold to 70%", () => {
    expect(DEFAULT_MCQ_ONLY_MIN_PERCENT).toBe(70);
  });

  it("passes when the MCQ score meets the threshold", () => {
    const result = resolveMcqOnlyDecision(70, 70);
    expect(result.passFailTotal).toBe(true);
    expect(result.decisionReason).toContain("Automatic pass");
  });

  it("fails when the MCQ score is below the threshold", () => {
    const result = resolveMcqOnlyDecision(69, 70);
    expect(result.passFailTotal).toBe(false);
    expect(result.decisionReason).toContain("Automatic fail");
  });

  it("honours an author-overridden (stricter) threshold", () => {
    expect(resolveMcqOnlyDecision(75, 80).passFailTotal).toBe(false);
    expect(resolveMcqOnlyDecision(85, 80).passFailTotal).toBe(true);
  });
});

describe("moduleVersionBodySchema (assessmentMode)", () => {
  const mcqSetVersionId = "mcq-1";

  it("accepts an MCQ_ONLY module with only an MCQ set (no taskText/rubric/prompt)", () => {
    const parsed = moduleVersionBodySchema.safeParse({
      assessmentMode: "MCQ_ONLY",
      mcqSetVersionId,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a free-text module missing taskText/rubric/prompt", () => {
    const parsed = moduleVersionBodySchema.safeParse({
      mcqSetVersionId,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a free-text module with all required fields", () => {
    const parsed = moduleVersionBodySchema.safeParse({
      assessmentMode: "FREETEXT_PLUS_MCQ",
      taskText: "Do the task",
      rubricVersionId: "rub-1",
      promptTemplateVersionId: "prompt-1",
      mcqSetVersionId,
    });
    expect(parsed.success).toBe(true);
  });

  it("treats a missing assessmentMode as free-text (still requires the free-text fields)", () => {
    const parsed = moduleVersionBodySchema.safeParse({
      taskText: "Do the task",
      rubricVersionId: "rub-1",
      promptTemplateVersionId: "prompt-1",
      mcqSetVersionId,
    });
    expect(parsed.success).toBe(true);
  });
});
