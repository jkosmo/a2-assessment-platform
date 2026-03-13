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

  it("fails automatically when confidence indicates insufficient evidence without other review triggers", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-3",
      passFailTotal: false,
      decisionReason: "Automatic fail due to insufficient submission evidence.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-3" });

    const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-3",
      userId: "user-3",
      moduleVersionId: "module-version-3",
      rubricVersionId: "rubric-version-3",
      promptTemplateVersionId: "prompt-version-3",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_total: 1,
        practical_score_scaled: 3.5,
        pass_fail_practical: false,
        manual_review_recommended: true,
        confidence_note: "Low confidence due to minimal artefact content; assessment relies on partial documentation.",
        criterion_rationales: {
          relevance_for_case: "Submission is placeholder content.",
          quality_and_utility: "Content is minimal and not actionable.",
          iteration_and_improvement: "No iteration trace is provided.",
          human_quality_assurance: "No QA evidence is provided.",
          responsible_use: "No safety concerns evident.",
        },
      }),
    });

    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        passFailTotal: false,
        decisionReason: "Automatic fail due to insufficient submission evidence.",
      }),
    );
    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(submissionUpdate).toHaveBeenCalledWith("submission-3", SubmissionStatus.COMPLETED);
    expect(upsertRecertificationStatusFromDecision).toHaveBeenCalledWith({
      decisionId: "decision-3",
      actorId: "user-3",
    });
    expect(result).toEqual({
      decision: {
        id: "decision-3",
        passFailTotal: false,
        decisionReason: "Automatic fail due to insufficient submission evidence.",
      },
      needsManualReview: false,
    });
  });

  it("still routes to manual review when red flags are present even if evidence is thin", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-4",
      passFailTotal: false,
      decisionReason: "Automatically routed to manual review due to red flag / confidence / borderline rule.",
    });
    manualReviewCreate.mockResolvedValue({
      id: "review-4",
      triggerReason: "Automatically routed to manual review due to red flag / confidence / borderline rule.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-4" });

    const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-4",
      userId: "user-4",
      moduleVersionId: "module-version-4",
      rubricVersionId: "rubric-version-4",
      promptTemplateVersionId: "prompt-version-4",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_total: 1,
        practical_score_scaled: 3.5,
        pass_fail_practical: false,
        manual_review_recommended: true,
        confidence_note: "Low confidence due to minimal artefact content; assessment relies on partial documentation.",
        red_flags: [
          {
            code: "POTENTIAL_SENSITIVE_DATA",
            severity: "high",
            description: "Possible sensitive data exposure.",
          },
        ],
      }),
    });

    expect(manualReviewCreate).toHaveBeenCalledWith({
      submissionId: "submission-4",
      triggerReason: "Automatically routed to manual review due to red flag / confidence / borderline rule.",
      reviewStatus: "OPEN",
    });
    expect(result.needsManualReview).toBe(true);
  });

  it("fails automatically for non-substantive low-confidence submissions that ask for more materials", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-5",
      passFailTotal: false,
      decisionReason: "Automatic fail due to insufficient submission evidence.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-5" });

    const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-5",
      userId: "user-5",
      moduleVersionId: "module-version-5",
      rubricVersionId: "rubric-version-5",
      promptTemplateVersionId: "prompt-version-5",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_total: 6,
        practical_score_scaled: 21,
        pass_fail_practical: false,
        manual_review_recommended: true,
        confidence_note:
          "Low confidence in assessment due to minimal and non-substantive submission; requires additional materials to review thoroughly.",
        improvement_advice: [
          "Provide a substantive practical answer to the MCQ and a detailed reflective section.",
          "Document at least one iteration step or revision based on feedback.",
          "Include explicit QA/validation notes (checks run, results, and fixes).",
        ],
      }),
    });

    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        passFailTotal: false,
        decisionReason: "Automatic fail due to insufficient submission evidence.",
        totalScore: 21,
      }),
    );
    expect(result.needsManualReview).toBe(false);
  });
});
