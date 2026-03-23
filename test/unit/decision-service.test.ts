import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionType, SubmissionStatus } from "../../src/db/prismaRuntime.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";

const assessmentDecisionCreate = vi.fn();
const manualReviewCreate = vi.fn();
const submissionUpdate = vi.fn();
const recordAuditEvent = vi.fn();
const upsertRecertificationStatusFromDecision = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

vi.mock("../../src/repositories/decisionRepository.js", () => ({
  decisionRepository: {
    createAssessmentDecision: assessmentDecisionCreate,
    createManualReview: manualReviewCreate,
    updateSubmissionStatus: submissionUpdate,
  },
  createDecisionRepository: () => ({
    createAssessmentDecision: assessmentDecisionCreate,
    createManualReview: manualReviewCreate,
    updateSubmissionStatus: submissionUpdate,
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/modules/certification/index.js", () => ({
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
    evidence_sufficiency: "sufficient",
    recommended_outcome: "pass",
    manual_review_reason_code: "none",
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

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

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
    }, expect.anything());
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_decision",
        entityId: "decision-1",
      }),
      expect.anything(),
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

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

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
      expect.anything(),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_decision",
        entityId: "decision-2",
      }),
      expect.anything(),
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

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

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
        evidence_sufficiency: "insufficient",
        recommended_outcome: "fail",
        manual_review_reason_code: "insufficient_evidence",
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
    }, expect.anything());
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

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

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
        evidence_sufficiency: "insufficient",
        recommended_outcome: "manual_review",
        manual_review_reason_code: "red_flag",
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

  it("fails automatically when the only red flags are insufficiency/completeness flags on an otherwise empty submission", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-4b",
      passFailTotal: false,
      decisionReason: "Automatic fail due to insufficient submission evidence.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-4b" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-4b",
      userId: "user-4b",
      moduleVersionId: "module-version-4b",
      rubricVersionId: "rubric-version-4b",
      promptTemplateVersionId: "prompt-version-4b",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_total: 0,
        practical_score_scaled: 0,
        pass_fail_practical: false,
        evidence_sufficiency: "insufficient",
        recommended_outcome: "manual_review",
        manual_review_reason_code: "red_flag",
        manual_review_recommended: true,
        confidence_note:
          "Very low confidence in automated scoring due to lack of content; human review required.",
        red_flags: [
          {
            code: "incomplete_submission",
            severity: "high",
            description: "Submission lacks MCQ answers, reflection depth, and QA notes.",
          },
          {
            code: "extremely_low_content",
            severity: "high",
            description: "Minimal content provided; insufficient basis for evaluation.",
          },
        ],
      }),
    });

    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        passFailTotal: false,
        decisionReason: "Automatic fail due to insufficient submission evidence.",
        totalScore: 0,
      }),
    );
    expect(result.needsManualReview).toBe(false);
  });

  it("fails automatically when the model emits an unstable insufficiency alias instead of a canonical red-flag code", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-4c",
      passFailTotal: false,
      decisionReason: "Automatic fail due to insufficient submission evidence.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-4c" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-4c",
      userId: "user-4c",
      moduleVersionId: "module-version-4c",
      rubricVersionId: "rubric-version-4c",
      promptTemplateVersionId: "prompt-version-4c",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_total: 0,
        practical_score_scaled: 0,
        pass_fail_practical: false,
        evidence_sufficiency: "insufficient",
        recommended_outcome: "manual_review",
        manual_review_reason_code: "red_flag",
        manual_review_recommended: true,
        confidence_note:
          "Very low confidence in automated scoring due to lack of content; human review required.",
        red_flags: [
          {
            code: "garbled_submission",
            severity: "high",
            description: "Observed staging-style low-content warning.",
          },
        ],
      }),
    });

    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        passFailTotal: false,
        decisionReason: "Automatic fail due to insufficient submission evidence.",
        totalScore: 0,
      }),
    );
    expect(result.needsManualReview).toBe(false);
  });

  it("fails automatically for non-substantive low-confidence submissions that ask for more materials", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-5",
      passFailTotal: false,
      decisionReason: "Automatic fail due to insufficient submission evidence.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-5" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

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
        evidence_sufficiency: "insufficient",
        recommended_outcome: "fail",
        manual_review_reason_code: "insufficient_evidence",
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

  it("fails automatically when manual review is recommended for a clearly failing submission without other escalation triggers", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-6",
      passFailTotal: false,
      decisionReason: "Automatic fail due to insufficient submission evidence.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-6" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-6",
      userId: "user-6",
      moduleVersionId: "module-version-6",
      rubricVersionId: "rubric-version-6",
      promptTemplateVersionId: "prompt-version-6",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_total: 6,
        practical_score_scaled: 21,
        pass_fail_practical: false,
        evidence_sufficiency: "insufficient",
        recommended_outcome: "fail",
        manual_review_reason_code: "insufficient_evidence",
        manual_review_recommended: true,
        confidence_note:
          "Low confidence due to minimal content and missing assessment artifacts; requires request for expanded submission to reassess.",
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

  describe("assessmentPolicy scoring weights", () => {
    it("recalculates MCQ score from mcqPercentScore when scoring.mcqWeight is set", async () => {
      // mcqPercentScore=80, mcqWeight=40 → effectiveMcqScaledScore = (80/100)*40 = 32
      // practical_score_scaled=45, no practicalWeight → effectivePracticalScaledScore=45
      // totalScore = 45 + 32 = 77
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 24, // would give 45+24=69 without weight override (fail)
        mcqPercentScore: 80,
        llmResult: buildLlmResult({ practical_score_scaled: 45, rubric_total: 12 }),
        assessmentPolicy: { scoring: { mcqWeight: 40 } },
      });
      expect(result.totalScore).toBe(77);
      expect(result.passesThresholds).toBe(true);
    });

    it("rescales practical score from practical_score_scaled / practicalMaxScore when scoring.practicalWeight is set", async () => {
      // practicalMaxScore=70, practical_score_scaled=35, practicalWeight=60
      // effectivePracticalScaledScore = (35/70)*60 = 30
      // mcqScaledScore=30, no mcqWeight → effectiveMcqScaledScore=30
      // totalScore = 30 + 30 = 60
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 35, rubric_total: 10 }),
        assessmentPolicy: { scoring: { practicalWeight: 60 } },
      });
      expect(result.totalScore).toBe(60);
    });

    it("applies both practicalWeight and mcqWeight together", async () => {
      // practicalMaxScore=70, practical_score_scaled=70, practicalWeight=60 → effectivePractical=(70/70)*60=60
      // mcqPercentScore=100, mcqWeight=40 → effectiveMcq=(100/100)*40=40
      // totalScore = 60 + 40 = 100
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 70, rubric_total: 20 }),
        assessmentPolicy: { scoring: { practicalWeight: 60, mcqWeight: 40 } },
      });
      expect(result.totalScore).toBe(100);
      expect(result.passesThresholds).toBe(true);
    });
  });

  describe("assessmentPolicy override", () => {
    it("passes when module-level totalMin is lower than global and score is above module threshold", async () => {
      // Default global totalMin is 70. practicalScoreScaled=45, mcqScaledScore=20 → total=65 (fails globally)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 20,
        mcqPercentScore: 66,
        llmResult: buildLlmResult({ practical_score_scaled: 45, rubric_total: 12 }),
        assessmentPolicy: { passRules: { totalMin: 60 } },
      });
      expect(result.passesThresholds).toBe(true);
      expect(result.passFailTotal).toBe(true);
      expect(result.decisionReason).toBe("Automatic pass by threshold rules.");
    });

    it("fails when module-level totalMin is higher than global and score is below module threshold", async () => {
      // Default global totalMin is 70. practicalScoreScaled=45, mcqScaledScore=30 → total=75 (passes globally)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 45, rubric_total: 12 }),
        assessmentPolicy: { passRules: { totalMin: 80 } },
      });
      expect(result.passesThresholds).toBe(false);
      expect(result.passFailTotal).toBe(false);
    });

    it("falls back to global rules when assessmentPolicy is null", async () => {
      // practicalScoreScaled=45, mcqScaledScore=30 → total=75 passes global default (70)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 45, rubric_total: 12 }),
        assessmentPolicy: null,
      });
      expect(result.passesThresholds).toBe(true);
      expect(result.passFailTotal).toBe(true);
    });
  });

  describe("resolveAssessmentDecision — score and practicalPercent", () => {
    it("returns totalScore = practical + mcq with default weights", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 45 }),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(75);
    });

    it("computes practicalPercent as rubric_total / rubricMaxTotal * 100", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 45, rubric_total: 10 }),
        assessmentPolicy: null,
        rubricMaxTotal: 20,
      });
      expect(result.practicalPercent).toBe(50);
    });

    it("returns practicalPercent null when rubricMaxTotal is 0", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 45, rubric_total: 0 }),
        assessmentPolicy: null,
        rubricMaxTotal: 0,
      });
      expect(result.practicalPercent).toBeNull();
    });

    it("uses the provided rubricMaxTotal instead of the default of 20", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 45, rubric_total: 20 }),
        assessmentPolicy: null,
        rubricMaxTotal: 25,
      });
      expect(result.practicalPercent).toBe(80);
    });

    it("rounds totalScore to 2 decimal places", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      // effectivePractical = (10 / 70) * 30 = 4.285714... → combined with mcq=30 → 34.285714... → 34.29
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 10 }),
        assessmentPolicy: { scoring: { practicalWeight: 30 } },
      });
      expect(result.totalScore).toBe(34.29);
    });
  });

  describe("resolveAssessmentDecision — red flag routing", () => {
    it("sets hasOpenRedFlag=true and passesThresholds=false even when total score is above threshold", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      // POTENTIAL_SENSITIVE_DATA is in redFlagCodes and "high" is in redFlagSeverities → forcing flag
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          practical_score_scaled: 50,
          red_flags: [{ code: "POTENTIAL_SENSITIVE_DATA", severity: "high", description: "Sensitive data." }],
          manual_review_recommended: true,
          recommended_outcome: "manual_review",
        }),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(80);
      expect(result.hasOpenRedFlag).toBe(true);
      expect(result.passesThresholds).toBe(false);
      expect(result.needsManualReview).toBe(true);
    });

    it("routes to manual review when LLM recommends it with no red flags", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      // Score 80 passes all gates; LLM says manual_review due to low_confidence
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          practical_score_scaled: 50,
          manual_review_recommended: true,
          recommended_outcome: "manual_review",
          manual_review_reason_code: "low_confidence",
        }),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(80);
      expect(result.hasOpenRedFlag).toBe(false);
      expect(result.needsManualReview).toBe(true);
    });
  });

  describe("resolveAssessmentDecision — decision reason strings", () => {
    it("returns 'Automatic pass by threshold rules.' for a clean pass", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({ practical_score_scaled: 45 }),
        assessmentPolicy: null,
      });
      expect(result.decisionReason).toBe("Automatic pass by threshold rules.");
      expect(result.passFailTotal).toBe(true);
    });

    it("returns 'Automatic fail by threshold rules.' for a score below threshold with no insufficient signal", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      // total = 40 + 20 = 60 < 70; confidence_note has no patterns
      const result = resolveAssessmentDecision({
        mcqScaledScore: 20,
        mcqPercentScore: 67,
        llmResult: buildLlmResult({
          practical_score_scaled: 40,
          evidence_sufficiency: "sufficient",
          recommended_outcome: "fail",
          manual_review_recommended: false,
          manual_review_reason_code: "none",
          confidence_note: "High confidence; score falls below the pass threshold.",
        }),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(60);
      expect(result.autoFailForInsufficientEvidence).toBe(false);
      expect(result.needsManualReview).toBe(false);
      expect(result.decisionReason).toBe("Automatic fail by threshold rules.");
      expect(result.passFailTotal).toBe(false);
    });

    it("returns 'Automatic fail due to insufficient submission evidence.' when insufficient signal is present", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 0,
        mcqPercentScore: 0,
        llmResult: buildLlmResult({
          practical_score_scaled: 0,
          rubric_total: 0,
          evidence_sufficiency: "insufficient",
          recommended_outcome: "fail",
          manual_review_recommended: false,
          manual_review_reason_code: "insufficient_evidence",
          confidence_note: "No substantive content to evaluate.",
        }),
        assessmentPolicy: null,
      });
      expect(result.autoFailForInsufficientEvidence).toBe(true);
      expect(result.needsManualReview).toBe(false);
      expect(result.decisionReason).toBe("Automatic fail due to insufficient submission evidence.");
    });

  });

  it("fails automatically for the exact staging phrase 'additional material required for a reliable assessment'", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-7",
      passFailTotal: false,
      decisionReason: "Automatic fail due to insufficient submission evidence.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-7" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    const result = await createAssessmentDecision({
      submissionId: "submission-7",
      userId: "user-7",
      moduleVersionId: "module-version-7",
      rubricVersionId: "rubric-version-7",
      promptTemplateVersionId: "prompt-version-7",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_total: 0,
        practical_score_scaled: 0,
        pass_fail_practical: false,
        evidence_sufficiency: "insufficient",
        recommended_outcome: "fail",
        manual_review_reason_code: "insufficient_evidence",
        manual_review_recommended: true,
        confidence_note:
          "Low confidence in scoring due to minimal content; additional material required for a reliable assessment.",
      }),
    });

    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        passFailTotal: false,
        decisionReason: "Automatic fail due to insufficient submission evidence.",
        totalScore: 0,
      }),
    );
    expect(result.needsManualReview).toBe(false);
  });
});
