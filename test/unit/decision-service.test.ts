import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionType, SubmissionStatus } from "../../src/db/prismaRuntime.js";
import type { LlmStructuredAssessment } from "../../src/services/llmAssessmentService.js";

const assessmentDecisionCreate = vi.fn();
const manualReviewCreate = vi.fn();
const submissionUpdate = vi.fn();
const recordAuditEvent = vi.fn();
const upsertRecertificationStatusFromDecision = vi.fn();

vi.mock("../../src/repositories/decisionRepository.js", () => ({
  decisionRepository: {
    createAssessmentDecision: assessmentDecisionCreate,
    createManualReview: manualReviewCreate,
    updateSubmissionStatus: submissionUpdate,
  },
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/services/recertificationService.js", () => ({
  upsertRecertificationStatusFromDecision,
}));

function buildLlmResult(overrides: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment {
  return {
    module_id: "module-1",
    rubric_scores: {
      relevance_for_case: 3,
      quality_and_utility: 3,
      iteration_and_improvement: 2,
      human_quality_assurance: 3,
      responsible_use: 3,
    },
    rubric_total: 12,
    practical_score_scaled: 45,
    pass_fail_practical: true,
    criterion_rationales: {
      relevance_for_case: "ok",
      quality_and_utility: "ok",
      iteration_and_improvement: "ok",
      human_quality_assurance: "ok",
      responsible_use: "ok",
    },
    improvement_advice: [],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "High confidence",
    ...overrides,
  };
}

describe("decision service", () => {
  beforeEach(() => {
    assessmentDecisionCreate.mockReset();
    manualReviewCreate.mockReset();
    submissionUpdate.mockReset();
    recordAuditEvent.mockReset();
    upsertRecertificationStatusFromDecision.mockReset();
  });

  it("creates an automatic completion decision and updates recertification when review is not needed", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-1",
      passFailTotal: true,
      decisionReason: "Automatic pass by threshold rules.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-1" });

    const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-1",
      userId: "user-1",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      mcqScaledScore: 30,
      mcqPercentScore: 100,
      llmResult: buildLlmResult(),
    });

    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionType: DecisionType.AUTOMATIC,
        totalScore: 75,
        passFailTotal: true,
        decisionReason: "Automatic pass by threshold rules.",
      }),
    );
    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(submissionUpdate).toHaveBeenCalledWith("submission-1", SubmissionStatus.COMPLETED);
    expect(upsertRecertificationStatusFromDecision).toHaveBeenCalledWith({
      decisionId: "decision-1",
      actorId: "user-1",
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_decision",
        entityId: "decision-1",
      }),
    );
    expect(result).toEqual({
      decision: {
        id: "decision-1",
        passFailTotal: true,
        decisionReason: "Automatic pass by threshold rules.",
      },
      needsManualReview: false,
    });
  });

  it("opens manual review and skips recertification when manual review is forced", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-2",
      passFailTotal: true,
      decisionReason: "Escalated for human review.",
    });
    manualReviewCreate.mockResolvedValue({
      id: "review-1",
      triggerReason: "Escalated for human review.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-2" });

    const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-2",
      userId: "user-2",
      moduleVersionId: "module-version-2",
      rubricVersionId: "rubric-version-2",
      promptTemplateVersionId: "prompt-version-2",
      mcqScaledScore: 30,
      mcqPercentScore: 100,
      llmResult: buildLlmResult(),
      forceManualReviewReason: "Escalated for human review.",
    });

    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionReason: "Escalated for human review.",
        passFailTotal: true,
      }),
    );
    expect(manualReviewCreate).toHaveBeenCalledWith({
      submissionId: "submission-2",
      triggerReason: "Escalated for human review.",
      reviewStatus: "OPEN",
    });
    expect(submissionUpdate).toHaveBeenCalledWith("submission-2", SubmissionStatus.UNDER_REVIEW);
    expect(upsertRecertificationStatusFromDecision).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "manual_review",
        entityId: "review-1",
      }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_decision",
        entityId: "decision-2",
      }),
    );
    expect(result).toEqual({
      decision: {
        id: "decision-2",
        passFailTotal: true,
        decisionReason: "Escalated for human review.",
      },
      needsManualReview: true,
    });
  });
});
