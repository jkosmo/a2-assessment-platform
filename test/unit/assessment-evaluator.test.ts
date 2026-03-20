import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/env.js", () => ({
  env: {
    LLM_MODE: "stub",
    LLM_STUB_MODEL_NAME: "stub-model",
    AZURE_OPENAI_DEPLOYMENT: null,
    ASSESSMENT_JOB_MAX_ATTEMPTS: 3,
  },
}));

const evaluateSecondaryAssessmentTrigger = vi.fn();
const evaluateSecondaryAssessmentDisagreement = vi.fn();
const shouldSuppressManualReviewForInsufficientEvidenceDisagreement = vi.fn();

vi.mock("../../src/services/secondaryAssessmentService.js", () => ({
  evaluateSecondaryAssessmentTrigger,
  evaluateSecondaryAssessmentDisagreement,
}));

vi.mock("../../src/services/assessmentDecisionSignals.js", () => ({
  shouldSuppressManualReviewForInsufficientEvidenceDisagreement,
}));

const createLlmEvaluation = vi.fn();
const evaluatePracticalWithLlm = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();
const sha256 = vi.fn(() => "hash");

vi.mock("../../src/repositories/assessmentJobRepository.js", () => ({
  assessmentJobRepository: { createLlmEvaluation },
}));

vi.mock("../../src/services/llmAssessmentService.js", () => ({
  evaluatePracticalWithLlm,
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

vi.mock("../../src/utils/hash.js", () => ({ sha256 }));

function buildInputContext(overrides = {}) {
  return {
    rubricCriteriaIds: ["crit_a", "crit_b"],
    rubricMaxTotal: 8,
    submissionFieldLabels: ["Field A"],
    assessmentPolicy: null,
    submissionLocale: "en-GB" as const,
    sensitiveDataPreprocess: {
      payload: { responseJson: { answer: "my answer" } },
      maskingEnabled: false,
      maskingApplied: false,
      totalMatches: 0,
      ruleHits: [],
      fieldsMasked: [],
    },
    moduleTaskText: "Task text",
    moduleGuidanceText: undefined,
    promptTemplateSystem: "system",
    promptTemplateUserTemplate: "template",
    promptTemplateExamplesJson: "[]",
    ...overrides,
  };
}

function buildLlmResult(overrides = {}) {
  return {
    module_id: "module-1",
    rubric_scores: { crit_a: 3, crit_b: 3 },
    rubric_total: 6,
    practical_score_scaled: 52.5,
    pass_fail_practical: true,
    criterion_rationales: { crit_a: "ok", crit_b: "ok" },
    improvement_advice: [],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "High confidence.",
    evidence_sufficiency: "sufficient" as const,
    recommended_outcome: "pass" as const,
    manual_review_reason_code: "none" as const,
    ...overrides,
  };
}

const BASE_CTX = {
  jobId: "job-1",
  submissionId: "sub-1",
  userId: "user-1",
  moduleId: "module-1",
  moduleVersionId: "mv-1",
  promptTemplateVersionId: "pt-1",
};

describe("AssessmentEvaluator — runLlmEvaluationPipeline", () => {
  beforeEach(() => {
    vi.resetModules();
    evaluatePracticalWithLlm.mockReset();
    createLlmEvaluation.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
    evaluateSecondaryAssessmentTrigger.mockReset();
    evaluateSecondaryAssessmentDisagreement.mockReset();
    shouldSuppressManualReviewForInsufficientEvidenceDisagreement.mockReset();

    createLlmEvaluation.mockResolvedValue({ id: "llm-eval-1", modelName: "stub:primary" });
    recordAuditEvent.mockResolvedValue(undefined);
    // Default: secondary assessment does not trigger
    evaluateSecondaryAssessmentTrigger.mockReturnValue({ shouldRun: false, enabled: true, reasons: [] });
    evaluateSecondaryAssessmentDisagreement.mockReturnValue({ hasDisagreement: false, reasons: [] });
    shouldSuppressManualReviewForInsufficientEvidenceDisagreement.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns primary result when secondary assessment does not trigger", async () => {
    const primaryResult = buildLlmResult();
    evaluatePracticalWithLlm.mockResolvedValue(primaryResult);

    const { runLlmEvaluationPipeline } = await import("../../src/services/AssessmentEvaluator.js");
    const result = await runLlmEvaluationPipeline({
      ...BASE_CTX,
      inputContext: buildInputContext(),
    });

    expect(result.finalLlmResult).toBe(primaryResult);
    expect(result.forceManualReviewReason).toBeUndefined();
    expect(evaluatePracticalWithLlm).toHaveBeenCalledTimes(1);
    expect(evaluatePracticalWithLlm).toHaveBeenCalledWith(expect.objectContaining({ assessmentPass: "primary" }));
  });

  it("runs secondary when primary recommends manual review", async () => {
    evaluateSecondaryAssessmentTrigger.mockReturnValue({
      shouldRun: true,
      enabled: true,
      reasons: ["primary_result_manual_review_recommended"],
    });
    evaluateSecondaryAssessmentDisagreement.mockReturnValue({ hasDisagreement: false, reasons: [] });

    const primaryResult = buildLlmResult({
      manual_review_recommended: true,
      confidence_note: "Low confidence due to ambiguous signals.",
    });
    const secondaryResult = buildLlmResult({
      rubric_total: 4,
      practical_score_scaled: 35,
      pass_fail_practical: false,
    });

    evaluatePracticalWithLlm
      .mockResolvedValueOnce(primaryResult)
      .mockResolvedValueOnce(secondaryResult);
    createLlmEvaluation
      .mockResolvedValueOnce({ id: "eval-primary" })
      .mockResolvedValueOnce({ id: "eval-secondary" });

    const { runLlmEvaluationPipeline } = await import("../../src/services/AssessmentEvaluator.js");
    const result = await runLlmEvaluationPipeline({
      ...BASE_CTX,
      inputContext: buildInputContext(),
    });

    expect(evaluatePracticalWithLlm).toHaveBeenCalledTimes(2);
    expect(evaluatePracticalWithLlm).toHaveBeenNthCalledWith(2, expect.objectContaining({ assessmentPass: "secondary" }));
    expect(result.finalLlmResult).toBe(secondaryResult);
  });

  it("sets forceManualReviewReason when primary and secondary disagree materially", async () => {
    evaluateSecondaryAssessmentTrigger.mockReturnValue({
      shouldRun: true,
      enabled: true,
      reasons: ["primary_result_manual_review_recommended"],
    });
    evaluateSecondaryAssessmentDisagreement.mockReturnValue({
      hasDisagreement: true,
      reasons: ["practical_score_delta_exceeded", "pass_fail_mismatch"],
    });
    shouldSuppressManualReviewForInsufficientEvidenceDisagreement.mockReturnValue(false);

    const primaryResult = buildLlmResult({
      rubric_total: 8,
      practical_score_scaled: 28,
      pass_fail_practical: false,
      manual_review_recommended: true,
      confidence_note: "Low confidence due to ambiguous evidence.",
    });
    const secondaryResult = buildLlmResult({
      rubric_total: 13,
      practical_score_scaled: 45.5,
      pass_fail_practical: true,
      manual_review_recommended: false,
      confidence_note: "Medium confidence.",
    });

    evaluatePracticalWithLlm
      .mockResolvedValueOnce(primaryResult)
      .mockResolvedValueOnce(secondaryResult);
    createLlmEvaluation.mockResolvedValue({ id: "eval" });

    const { runLlmEvaluationPipeline } = await import("../../src/services/AssessmentEvaluator.js");
    const result = await runLlmEvaluationPipeline({
      ...BASE_CTX,
      inputContext: buildInputContext(),
    });

    expect(result.forceManualReviewReason).toBe(
      "Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.",
    );
  });

  it("logs and rethrows when the primary LLM call fails", async () => {
    evaluatePracticalWithLlm.mockRejectedValue(new Error("LLM timeout"));

    const { runLlmEvaluationPipeline } = await import("../../src/services/AssessmentEvaluator.js");
    await expect(
      runLlmEvaluationPipeline({ ...BASE_CTX, inputContext: buildInputContext() }),
    ).rejects.toThrow("LLM timeout");

    expect(logOperationalEvent).toHaveBeenCalledWith(
      "llm_evaluation_failed",
      expect.objectContaining({ assessmentPass: "primary" }),
      "error",
    );
  });

  it("logs and rethrows when the secondary LLM call fails", async () => {
    evaluateSecondaryAssessmentTrigger.mockReturnValue({
      shouldRun: true,
      enabled: true,
      reasons: ["primary_result_manual_review_recommended"],
    });

    const primaryResult = buildLlmResult({
      manual_review_recommended: true,
      confidence_note: "Low confidence due to ambiguous signals.",
    });
    evaluatePracticalWithLlm
      .mockResolvedValueOnce(primaryResult)
      .mockRejectedValueOnce(new Error("Secondary timeout"));
    createLlmEvaluation.mockResolvedValue({ id: "eval-primary" });

    const { runLlmEvaluationPipeline } = await import("../../src/services/AssessmentEvaluator.js");
    await expect(
      runLlmEvaluationPipeline({ ...BASE_CTX, inputContext: buildInputContext() }),
    ).rejects.toThrow("Secondary timeout");

    expect(logOperationalEvent).toHaveBeenCalledWith(
      "llm_evaluation_failed",
      expect.objectContaining({ assessmentPass: "secondary" }),
      "error",
    );
  });
});
