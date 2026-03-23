import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAssessmentDecision = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();
const notifyAssessmentResult = vi.fn();
const localizeContentText = vi.fn((_, text) => text ?? null);

vi.mock("../../src/modules/assessment/decisionService.js", () => ({
  createAssessmentDecision,
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

vi.mock("../../src/modules/certification/index.js", () => ({
  notifyAssessmentResult,
}));

vi.mock("../../src/i18n/content.js", () => ({
  localizeContentText,
}));

function buildLlmResult(overrides = {}) {
  return {
    module_id: "module-1",
    rubric_scores: { crit_a: 3 },
    rubric_total: 3,
    practical_score_scaled: 52.5,
    pass_fail_practical: true,
    criterion_rationales: { crit_a: "ok" },
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

const BASE_INPUT = {
  jobId: "job-1",
  submissionId: "sub-1",
  userId: "user-1",
  moduleId: "module-1",
  moduleVersionId: "mv-1",
  rubricVersionId: "rv-1",
  promptTemplateVersionId: "pt-1",
  mcqScaledScore: 30,
  mcqPercentScore: 100,
  forceManualReviewReason: undefined,
  assessmentPolicy: null,
  rubricMaxTotal: 20,
  moduleTitle: "Test Module",
  submissionLocale: "en-GB" as const,
  submittedAt: new Date("2026-03-20T10:00:00Z"),
  recipientEmail: "participant@example.com",
  recipientName: "Test User",
};

describe("AssessmentDecisionApplicationService — applyAssessmentDecision", () => {
  beforeEach(() => {
    vi.resetModules();
    createAssessmentDecision.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
    notifyAssessmentResult.mockReset();
    localizeContentText.mockReset();

    recordAuditEvent.mockResolvedValue(undefined);
    localizeContentText.mockImplementation((_locale, text) => text ?? null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a decision and sends notification when manual review is not needed", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-1", passFailTotal: true },
      needsManualReview: false,
    });
    notifyAssessmentResult.mockResolvedValue(undefined);

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    await applyAssessmentDecision({ ...BASE_INPUT, llmResult: buildLlmResult() });

    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "sub-1",
        userId: "user-1",
        mcqScaledScore: 30,
        mcqPercentScore: 100,
      }),
    );
    expect(notifyAssessmentResult).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "sub-1",
        recipientEmail: "participant@example.com",
        passFailTotal: true,
        locale: "en-GB",
      }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_job",
        entityId: "job-1",
        action: "assessment_job_completed",
      }),
    );
  });

  it("skips notification when manual review is needed", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-2", passFailTotal: false },
      needsManualReview: true,
    });

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    await applyAssessmentDecision({
      ...BASE_INPUT,
      llmResult: buildLlmResult(),
      forceManualReviewReason: "Escalated for review.",
    });

    expect(notifyAssessmentResult).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "assessment_job_completed" }),
    );
  });

  it("logs and swallows notification errors rather than propagating them", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-3", passFailTotal: true },
      needsManualReview: false,
    });
    notifyAssessmentResult.mockRejectedValue(new Error("Email service unavailable"));

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");

    // Should not throw even though notification failed
    await expect(
      applyAssessmentDecision({ ...BASE_INPUT, llmResult: buildLlmResult() }),
    ).resolves.toBeUndefined();

    // Wait a tick for the catch in the fire-and-forget notifyAssessmentResult to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logOperationalEvent).toHaveBeenCalledWith(
      "participant_notification_pipeline_failed",
      expect.objectContaining({ submissionId: "sub-1" }),
      "error",
    );
  });

  it("passes forceManualReviewReason through to createAssessmentDecision", async () => {
    createAssessmentDecision.mockResolvedValue({
      decision: { id: "decision-4", passFailTotal: false },
      needsManualReview: true,
    });

    const { applyAssessmentDecision } = await import("../../src/modules/assessment/AssessmentDecisionApplicationService.js");
    await applyAssessmentDecision({
      ...BASE_INPUT,
      llmResult: buildLlmResult(),
      forceManualReviewReason: "Disagreement between primary and secondary assessments.",
    });

    expect(createAssessmentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        forceManualReviewReason: "Disagreement between primary and secondary assessments.",
      }),
    );
  });
});
