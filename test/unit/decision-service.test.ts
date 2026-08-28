import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionType, SubmissionStatus } from "../../src/db/prismaRuntime.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";
import { decisionReason, decisionReasonCodes } from "../../src/modules/assessment/decisionReason.js";

const assessmentDecisionCreate = vi.fn();
const manualReviewCreate = vi.fn();
const submissionUpdate = vi.fn();
const recordAuditEvent = vi.fn();
const upsertCertificationStatusFromDecision = vi.fn();

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

// #953: vedtaksskrivingen gjerdes nå mot kjøringen som eier jobben. Standard er «vi eier den» slik
// at de eksisterende testene måler det de alltid har målt; egne tester setter count 0.
const claimDecisionWrite = vi.fn();
vi.mock("../../src/modules/assessment/assessmentJobRepository.js", () => ({
  assessmentJobRepository: { claimDecisionWrite },
  createAssessmentJobRepository: () => ({ claimDecisionWrite }),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/modules/certification/index.js", () => ({
  upsertCertificationStatusFromDecision,
}));

// Default rubric_scores: 5 criteria summing to 14 — must equal rubric_total to avoid
// triggering the totalsInconsistent manual-review path.
// With rubricMaxTotal=20 (default): recomputedPractical=(14/20)*70=49; total with mcqScaled=30 → 79.
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
    rubric_total: 14,
    practical_score_scaled: 49,
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

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/assessment/decisionService.js"));

describe("decision service", () => {
  beforeEach(() => {
    claimDecisionWrite.mockReset();
    claimDecisionWrite.mockResolvedValue({ count: 1 });
    assessmentDecisionCreate.mockReset();
    manualReviewCreate.mockReset();
    submissionUpdate.mockReset();
    recordAuditEvent.mockReset();
    upsertCertificationStatusFromDecision.mockReset();
  });

  it("creates an automatic completion decision and updates certification status when review is not needed", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-1",
      passFailTotal: true,
      decisionReason: "Automatic pass by threshold rules.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-1" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
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
        totalScore: 79,
        passFailTotal: true,
        decisionReason: "Automatic pass by threshold rules.",
      }),
    );
    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(submissionUpdate).toHaveBeenCalledWith("submission-1", SubmissionStatus.COMPLETED);
    expect(upsertCertificationStatusFromDecision).toHaveBeenCalledWith({
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

  it("opens manual review and skips the certification write when manual review is forced", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-2",
      passFailTotal: false,
      decisionReason: "Escalated for human review.",
    });
    manualReviewCreate.mockResolvedValue({
      id: "review-1",
      triggerReason: "Escalated for human review.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-2" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-2",
      userId: "user-2",
      moduleVersionId: "module-version-2",
      rubricVersionId: "rubric-version-2",
      promptTemplateVersionId: "prompt-version-2",
      mcqScaledScore: 30,
      mcqPercentScore: 100,
      llmResult: buildLlmResult(),
      forceManualReviewReason: decisionReason(decisionReasonCodes.manualReviewRedFlagOrConfidence, "Escalated for human review."),
    });

    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionReason: "Escalated for human review.",
        // #950: koden MÅ lagres, ikke bare regnes ut. Uten denne påstanden kunne linjen som
        // sender den til databasen slettes uten at én eneste test ble rød — og da ville hele
        // oversettelsen vært død for nye avgjørelser.
        decisionReasonCode: "MANUAL_REVIEW_RED_FLAG_OR_CONFIDENCE",
        // #948: sto tidligere som `true`. ⚠️ Testen festet feilen som om den var tilsiktet — et
        // vedtak som baerer «bestaatt» mens innleveringen gaar til sensor. Terskelen passerer
        // fortsatt; det er nettopp derfor det var farlig.
        passFailTotal: false,
      }),
    );
    expect(manualReviewCreate).toHaveBeenCalledWith({
      submissionId: "submission-2",
      triggerReason: "Escalated for human review.",
      reviewStatus: "OPEN",
    });
    expect(submissionUpdate).toHaveBeenCalledWith("submission-2", SubmissionStatus.UNDER_REVIEW);
    expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
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
        passFailTotal: false,
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

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-3",
      userId: "user-3",
      moduleVersionId: "module-version-3",
      rubricVersionId: "rubric-version-3",
      promptTemplateVersionId: "prompt-version-3",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_scores: { relevance_for_case: 0, quality_and_utility: 0, iteration_and_improvement: 1, human_quality_assurance: 0, responsible_use: 0 },
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
    expect(upsertCertificationStatusFromDecision).toHaveBeenCalledWith({
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

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-4",
      userId: "user-4",
      moduleVersionId: "module-version-4",
      rubricVersionId: "rubric-version-4",
      promptTemplateVersionId: "prompt-version-4",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_scores: { relevance_for_case: 0, quality_and_utility: 0, iteration_and_improvement: 1, human_quality_assurance: 0, responsible_use: 0 },
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

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-4b",
      userId: "user-4b",
      moduleVersionId: "module-version-4b",
      rubricVersionId: "rubric-version-4b",
      promptTemplateVersionId: "prompt-version-4b",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_scores: { relevance_for_case: 0, quality_and_utility: 0, iteration_and_improvement: 0, human_quality_assurance: 0, responsible_use: 0 },
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

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-4c",
      userId: "user-4c",
      moduleVersionId: "module-version-4c",
      rubricVersionId: "rubric-version-4c",
      promptTemplateVersionId: "prompt-version-4c",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_scores: { relevance_for_case: 0, quality_and_utility: 0, iteration_and_improvement: 0, human_quality_assurance: 0, responsible_use: 0 },
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

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-5",
      userId: "user-5",
      moduleVersionId: "module-version-5",
      rubricVersionId: "rubric-version-5",
      promptTemplateVersionId: "prompt-version-5",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_scores: { relevance_for_case: 1, quality_and_utility: 1, iteration_and_improvement: 1, human_quality_assurance: 2, responsible_use: 1 },
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

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-6",
      userId: "user-6",
      moduleVersionId: "module-version-6",
      rubricVersionId: "rubric-version-6",
      promptTemplateVersionId: "prompt-version-6",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_scores: { relevance_for_case: 1, quality_and_utility: 1, iteration_and_improvement: 1, human_quality_assurance: 2, responsible_use: 1 },
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
      // sum=12, rubricMaxTotal=20: recomputedPractical=(12/20)*70=42; no practicalWeight → effectivePractical=42
      // mcqPercentScore=80, mcqWeight=40 → effectiveMcq=(80/100)*40=32
      // totalScore = 42+32 = 74 (passes 70)
      // Without weight override: mcqScaledScore=24, total=42+24=66 (would fail)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 24,
        mcqPercentScore: 80,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 3, quality_and_utility: 3, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 12,
          practical_score_scaled: 42,
        }),
        assessmentPolicy: { scoring: { mcqWeight: 40 } },
      });
      expect(result.totalScore).toBe(74);
      expect(result.passesThresholds).toBe(true);
    });

    it("rescales practical score from practical_score_scaled / practicalMaxScore when scoring.practicalWeight is set", async () => {
      // sum=10, rubricMaxTotal=20: recomputedPractical=(10/20)*70=35
      // practicalWeight=60 → effectivePractical=(35/70)*60=30
      // mcqScaledScore=30, no mcqWeight → effectiveMcq=30
      // totalScore = 30+30 = 60
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 2, quality_and_utility: 2, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 10,
          practical_score_scaled: 35,
        }),
        assessmentPolicy: { scoring: { practicalWeight: 60 } },
      });
      expect(result.totalScore).toBe(60);
    });

    it("applies both practicalWeight and mcqWeight together", async () => {
      // sum=20, rubricMaxTotal=20: recomputedPractical=(20/20)*70=70
      // practicalWeight=60 → effectivePractical=(70/70)*60=60
      // mcqPercentScore=100, mcqWeight=40 → effectiveMcq=(100/100)*40=40
      // totalScore = 60+40 = 100
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 4, quality_and_utility: 4, iteration_and_improvement: 4, human_quality_assurance: 4, responsible_use: 4 },
          rubric_total: 20,
          practical_score_scaled: 70,
        }),
        assessmentPolicy: { scoring: { practicalWeight: 60, mcqWeight: 40 } },
      });
      expect(result.totalScore).toBe(100);
      expect(result.passesThresholds).toBe(true);
    });
  });

  describe("assessmentPolicy override", () => {
    it("passes when module-level totalMin is lower than global and score is above module threshold", async () => {
      // sum=12, rubricMaxTotal=20: recomputedPractical=42; mcqScaled=20 → total=62 (fails global 70)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 20,
        mcqPercentScore: 66,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 3, quality_and_utility: 3, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 12,
          practical_score_scaled: 42,
        }),
        assessmentPolicy: { passRules: { totalMin: 60 } },
      });
      expect(result.passesThresholds).toBe(true);
      expect(result.passFailTotal).toBe(true);
      expect(result.decisionReason).toBe("Automatic pass by threshold rules.");
    });

    it("fails when module-level totalMin is higher than global and score is below module threshold", async () => {
      // sum=12, rubricMaxTotal=20: recomputedPractical=42; mcqScaled=30 → total=72 (passes global but below module 80)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 3, quality_and_utility: 3, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 12,
          practical_score_scaled: 42,
        }),
        assessmentPolicy: { passRules: { totalMin: 80 } },
      });
      expect(result.passesThresholds).toBe(false);
      expect(result.passFailTotal).toBe(false);
    });

    it("falls back to global rules when assessmentPolicy is null", async () => {
      // sum=14, rubricMaxTotal=20: recomputedPractical=49; mcqScaled=30 → total=79 passes global default (70)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult(),
        assessmentPolicy: null,
      });
      expect(result.passesThresholds).toBe(true);
      expect(result.passFailTotal).toBe(true);
    });
  });

  describe("resolveAssessmentDecision — score and practicalPercent", () => {
    it("returns totalScore = practical + mcq with default weights", async () => {
      // sum=14, rubricMaxTotal=20: recomputedPractical=49; mcqScaled=30 → total=79
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult(),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(79);
    });

    it("computes practicalPercent as rubric_total / rubricMaxTotal * 100", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 2, quality_and_utility: 2, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 10,
          practical_score_scaled: 35,
        }),
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
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 0, quality_and_utility: 0, iteration_and_improvement: 0, human_quality_assurance: 0, responsible_use: 0 },
          rubric_total: 0,
          practical_score_scaled: 0,
        }),
        assessmentPolicy: null,
        rubricMaxTotal: 0,
      });
      expect(result.practicalPercent).toBeNull();
    });

    it("uses the provided rubricMaxTotal instead of the default of 20", async () => {
      // sum=20, rubricMaxTotal=25: practicalPercent=(20/25)*100=80
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 4, quality_and_utility: 4, iteration_and_improvement: 4, human_quality_assurance: 4, responsible_use: 4 },
          rubric_total: 20,
          practical_score_scaled: 56,
        }),
        assessmentPolicy: null,
        rubricMaxTotal: 25,
      });
      expect(result.practicalPercent).toBe(80);
    });

    it("rounds totalScore to 2 decimal places", async () => {
      // sum=1, rubricMaxTotal=7, practicalWeight=30, mcqScaled=30
      // recomputedPractical=(1/7)*70=10; effectivePractical=(10/70)*30=300/70=4.2857...; total=34.2857... → 34.29
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 1 },
          rubric_total: 1,
        }),
        assessmentPolicy: { scoring: { practicalWeight: 30 } },
        rubricMaxTotal: 7,
      });
      expect(result.totalScore).toBe(34.29);
    });
  });

  describe("resolveAssessmentDecision — component pass gates", () => {
    it("fails when MCQ percent is below mcqMinPercent even if total score passes", async () => {
      // sum=12, rubricMaxTotal=20: practical=42; mcqScaled=30 → total=72 passes global 70
      // but mcqPercentScore=40 < mcqMinPercent=50 → gate fails
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 40,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 3, quality_and_utility: 3, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 12,
          practical_score_scaled: 42,
        }),
        assessmentPolicy: { passRules: { totalMin: 70, mcqMinPercent: 50 } },
      });
      expect(result.passesThresholds).toBe(false);
      expect(result.passFailTotal).toBe(false);
      expect(result.decisionReason).toBe("Automatic fail: MCQ score below required minimum.");
    });

    it("passes when MCQ percent meets mcqMinPercent exactly", async () => {
      // mcqPercentScore=50 >= mcqMinPercent=50 → gate passes; total=72 passes
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 50,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 3, quality_and_utility: 3, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 12,
          practical_score_scaled: 42,
        }),
        assessmentPolicy: { passRules: { totalMin: 70, mcqMinPercent: 50 } },
      });
      expect(result.passesThresholds).toBe(true);
      expect(result.passFailTotal).toBe(true);
    });

    it("fails when practical percent is below practicalMinPercent even if total score passes", async () => {
      // sum=8, rubricMaxTotal=20: practicalPercent=40 < practicalMinPercent=50 → gate fails
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 1, quality_and_utility: 1, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 8,
          practical_score_scaled: 28,
        }),
        assessmentPolicy: { passRules: { totalMin: 50, practicalMinPercent: 50 } },
        rubricMaxTotal: 20,
      });
      expect(result.practicalPercent).toBe(40);
      expect(result.passesThresholds).toBe(false);
      expect(result.passFailTotal).toBe(false);
      expect(result.decisionReason).toBe("Automatic fail: practical score below required minimum.");
    });

    it("passes when practical percent meets practicalMinPercent exactly", async () => {
      // sum=10, rubricMaxTotal=20: practicalPercent=50 >= practicalMinPercent=50 → gate passes
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 2, quality_and_utility: 2, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 10,
          practical_score_scaled: 35,
        }),
        assessmentPolicy: { passRules: { totalMin: 50, practicalMinPercent: 50 } },
        rubricMaxTotal: 20,
      });
      expect(result.practicalPercent).toBe(50);
      expect(result.passesThresholds).toBe(true);
      expect(result.passFailTotal).toBe(true);
    });

    it("applies both mcqMinPercent and practicalMinPercent as AND conditions", async () => {
      // mcqPercentScore=60>=50 (passes), practicalPercent=(8/20)*100=40<50 (fails)
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 25,
        mcqPercentScore: 60,
        llmResult: buildLlmResult({
          rubric_scores: { relevance_for_case: 1, quality_and_utility: 1, iteration_and_improvement: 2, human_quality_assurance: 2, responsible_use: 2 },
          rubric_total: 8,
          practical_score_scaled: 28,
        }),
        assessmentPolicy: { passRules: { totalMin: 50, mcqMinPercent: 50, practicalMinPercent: 50 } },
        rubricMaxTotal: 20,
      });
      expect(result.passesThresholds).toBe(false);
      expect(result.decisionReason).toBe("Automatic fail: practical score below required minimum.");
    });

    it("skips component gates when neither is set in policy", async () => {
      // Default buildLlmResult (sum=14), total=79; no component gates → passes on total alone
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 30,
        llmResult: buildLlmResult(),
        assessmentPolicy: { passRules: { totalMin: 70 } },
      });
      expect(result.passesThresholds).toBe(true);
    });
  });

  describe("resolveAssessmentDecision — red flag routing", () => {
    it("sets hasOpenRedFlag=true and passesThresholds=false even when total score is above threshold", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      // Default sum=14: total=49+30=79; POTENTIAL_SENSITIVE_DATA is forcing red flag → passesThresholds=false
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          red_flags: [{ code: "POTENTIAL_SENSITIVE_DATA", severity: "high", description: "Sensitive data." }],
          manual_review_recommended: true,
          recommended_outcome: "manual_review",
        }),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(79);
      expect(result.hasOpenRedFlag).toBe(true);
      expect(result.passesThresholds).toBe(false);
      expect(result.needsManualReview).toBe(true);
    });

    it("routes to manual review when LLM recommends it with no red flags", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      // Default sum=14: total=79 passes all gates; LLM says manual_review due to low_confidence
      const result = resolveAssessmentDecision({
        mcqScaledScore: 30,
        mcqPercentScore: 100,
        llmResult: buildLlmResult({
          manual_review_recommended: true,
          recommended_outcome: "manual_review",
          manual_review_reason_code: "low_confidence",
        }),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(79);
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
        llmResult: buildLlmResult(),
        assessmentPolicy: null,
      });
      expect(result.decisionReason).toBe("Automatic pass by threshold rules.");
      expect(result.passFailTotal).toBe(true);
    });

    it("returns 'Automatic fail by threshold rules.' for a score below threshold with no insufficient signal", async () => {
      const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
      // ⚠️ Sto på total=69 — ett poeng under grensa. Etter at standard-grensebåndet (10 poeng under
      // terskelen) ble innført, er det nettopp et tilfelle som skal til SENSOR, ikke strykes
      // automatisk. Testen festet altså den gamle policyen.
      //
      // Den måler fortsatt det navnet sitt sier — automatisk stryk under terskelen — men med et
      // resultat som ligger UNDER båndet. Grensetilfellet er dekket av egne tester lenger opp.
      // Default sum=14: recomputedPractical=49; mcqScaled=0 → total=49 < 60.
      const result = resolveAssessmentDecision({
        mcqScaledScore: 0,
        mcqPercentScore: 0,
        llmResult: buildLlmResult({
          evidence_sufficiency: "sufficient",
          recommended_outcome: "fail",
          manual_review_recommended: false,
          manual_review_reason_code: "none",
          confidence_note: "High confidence; score falls below the pass threshold.",
        }),
        assessmentPolicy: null,
      });
      expect(result.totalScore).toBe(49);
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
          rubric_scores: { relevance_for_case: 0, quality_and_utility: 0, iteration_and_improvement: 0, human_quality_assurance: 0, responsible_use: 0 },
          rubric_total: 0,
          practical_score_scaled: 0,
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

    const result = await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-7",
      userId: "user-7",
      moduleVersionId: "module-version-7",
      rubricVersionId: "rubric-version-7",
      promptTemplateVersionId: "prompt-version-7",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({
        rubric_scores: { relevance_for_case: 0, quality_and_utility: 0, iteration_and_improvement: 0, human_quality_assurance: 0, responsible_use: 0 },
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
  // ── #948: invarianten — ingen «bestått» mens sensor ikke har sett saken ────────────────────────
  //
  // ⚠️ Begge disse har en TERSKEL SOM PASSERER. Det er hele poenget: uten det ville
  // `passFailTotal` vært false av en helt annen grunn, og testen ville vært grønn uansett hva
  // linja i kilden gjorde. En test som ikke kan bli rød måler ingenting.
  //
  // Leserne er tolv, og de tolket flagget ulikt: deltakerens modulkort, kalibreringsrapporten,
  // kursrapporten, sertifiseringen. Derfor står vakta i kilden og ikke hos dem.

  it("#948: en uenig sum gir ikke bestått, selv når terskelen passerer", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-948a",
      passFailTotal: false,
      decisionReason: "Routed to manual review: rubric totals are inconsistent.",
    });
    manualReviewCreate.mockResolvedValue({ id: "review-948a", triggerReason: "totals" });
    submissionUpdate.mockResolvedValue({ id: "submission-948a" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-948a",
      userId: "user-948a",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      mcqScaledScore: 30,
      mcqPercentScore: 100,
      // Kriteriene summerer til 14, men modellen rapporterer 15. Poengene regnes fra den
      // GJENBEREGNEDE summen, så terskelen passerer fortsatt — og det er nettopp det farlige.
      llmResult: buildLlmResult({ rubric_total: 15 }),
    });

    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ totalScore: 79, passFailTotal: false }),
    );
    expect(submissionUpdate).toHaveBeenCalledWith("submission-948a", SubmissionStatus.UNDER_REVIEW);
    expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
  });

  it("#948: en modell som ber om menneskeblikk gir ikke bestått, selv når terskelen passerer", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-948b",
      passFailTotal: false,
      decisionReason: "Routed to manual review.",
    });
    manualReviewCreate.mockResolvedValue({ id: "review-948b", triggerReason: "llm" });
    submissionUpdate.mockResolvedValue({ id: "submission-948b" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-948b",
      userId: "user-948b",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      mcqScaledScore: 30,
      mcqPercentScore: 100,
      llmResult: buildLlmResult({ manual_review_recommended: true }),
    });

    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ totalScore: 79, passFailTotal: false }),
    );
    expect(submissionUpdate).toHaveBeenCalledWith("submission-948b", SubmissionStatus.UNDER_REVIEW);
    expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
  });

  // Motprøven. Uten den ville «sett passFailTotal til false alltid» også vært grønt — og da hadde
  // ingen kunnet bestå noe.
  it("#948: et rent auto-bestått vedtak er fortsatt bestått", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-948c",
      passFailTotal: true,
      decisionReason: "Automatic pass by threshold rules.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-948c" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-948c",
      userId: "user-948c",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      mcqScaledScore: 30,
      mcqPercentScore: 100,
      llmResult: buildLlmResult(),
    });

    expect(assessmentDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ passFailTotal: true }),
    );
    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(submissionUpdate).toHaveBeenCalledWith("submission-948c", SubmissionStatus.COMPLETED);
  });

  // ── Grensevinduet, nå med en standard (produkteier 2026-08-28) ─────────────────────────────────
  //
  // Utløseren var et ekte skjermbilde fra stage: «Ikkje bestått — 66,67 poeng. Kravet var 70.»
  // ⚠️ Funksjonen fantes fra #464, men bare per modulversjon og uten standard. Målt på stage: 3 av
  // 101 modulversjoner hadde et vindu — og de tre sto på 0-90, altså «vurder alt manuelt». Vakta
  // hadde dermed aldri vært i drift noe sted.
  //
  // 60-70 er bevisst vidt: en kandidat som blir feilaktig strøket er en dyrere feil enn en som blir
  // feilaktig bestått.

  it("standardvinduet ruter 66,67 til sensor i stedet for å stryke automatisk", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-bl1",
      passFailTotal: false,
      decisionReason: "Routed to manual review: borderline result.",
    });
    manualReviewCreate.mockResolvedValue({ id: "review-bl1", triggerReason: "borderline" });
    submissionUpdate.mockResolvedValue({ id: "submission-bl1" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-bl1",
      userId: "user-bl1",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      // 10/20 rubrikk = 35 praktisk, + 20 MCQ (66,7 %) ⇒ 55. Under 70, innenfor 60-70? Nei — vi
      // trenger et tall MELLOM 60 og 70. 12/20 = 42 praktisk + 24,67 MCQ ⇒ 66,67.
      mcqScaledScore: 24.67,
      mcqPercentScore: 82,
      llmResult: buildLlmResult({
        rubric_scores: { a: 3, b: 3, c: 2, d: 2, e: 2 },
        rubric_total: 12,
      }),
      // Ingen modulpolicy ⇒ standarden fra regelfila skal gjelde.
    });

    const written = assessmentDecisionCreate.mock.calls[0][0] as { totalScore: number; passFailTotal: boolean };
    expect(written.totalScore).toBeGreaterThanOrEqual(60);
    expect(written.totalScore).toBeLessThanOrEqual(70);
    expect(written.passFailTotal).toBe(false);
    // ⚠️ Kjernen: den skal til SENSOR, ikke settes som automatisk stryk.
    expect(manualReviewCreate).toHaveBeenCalled();
    expect(submissionUpdate).toHaveBeenCalledWith("submission-bl1", SubmissionStatus.UNDER_REVIEW);
    expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
  });

  // Motprøven. Uten den ville «rut alt til sensor» også vært grønt — og det er nøyaktig feilen de
  // tre 0-90-modulene på stage gjør.
  it("et resultat godt under vinduet strykes fortsatt automatisk", async () => {
    assessmentDecisionCreate.mockResolvedValue({
      id: "decision-bl2",
      passFailTotal: false,
      decisionReason: "Automatic fail by threshold rules.",
    });
    submissionUpdate.mockResolvedValue({ id: "submission-bl2" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-bl2",
      userId: "user-bl2",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({ rubric_scores: { a: 1, b: 1, c: 1, d: 1, e: 1 }, rubric_total: 5 }),
    });

    const written = assessmentDecisionCreate.mock.calls[0][0] as { totalScore: number };
    expect(written.totalScore).toBeLessThan(60);
    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(submissionUpdate).toHaveBeenCalledWith("submission-bl2", SubmissionStatus.COMPLETED);
  });

  // Modulens eget vindu skal fortsatt vinne — standarden er en bunnplanke, ikke en overstyring.
  it("modulens eget vindu vinner over standarden", async () => {
    assessmentDecisionCreate.mockResolvedValue({ id: "decision-bl3", passFailTotal: false, decisionReason: "x" });
    submissionUpdate.mockResolvedValue({ id: "submission-bl3" });

    const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createAssessmentDecision({ jobId: "job-fence", fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-bl3",
      userId: "user-bl3",
      moduleVersionId: "module-version-1",
      rubricVersionId: "rubric-version-1",
      promptTemplateVersionId: "prompt-version-1",
      mcqScaledScore: 24.67,
      mcqPercentScore: 82,
      llmResult: buildLlmResult({ rubric_scores: { a: 3, b: 3, c: 2, d: 2, e: 2 }, rubric_total: 12 }),
      // Et smalt vindu som IKKE dekker 66,67 ⇒ ingen manuell vurdering. Standardbåndet (60-70)
      // ville fanget den; modulens eget vindu skal vinne.
      assessmentPolicy: { passRules: { borderlineWindow: { min: 69, max: 69.5 } } },
    });

    expect(manualReviewCreate).not.toHaveBeenCalled();
    expect(submissionUpdate).toHaveBeenCalledWith("submission-bl3", SubmissionStatus.COMPLETED);
  });

  // Det skarpeste tilfellet: ETT poeng under grensa. En eksisterende test festet dette som
  // «automatisk stryk» — den er endret, og dette er påstanden som erstatter den.
  it("ett poeng under terskelen går til sensor, ikke automatisk stryk", async () => {
    const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
    const result = resolveAssessmentDecision({
      mcqScaledScore: 20,
      mcqPercentScore: 67,
      llmResult: buildLlmResult({
        evidence_sufficiency: "sufficient",
        recommended_outcome: "fail",
        manual_review_recommended: false,
        manual_review_reason_code: "none",
        confidence_note: "High confidence; score falls below the pass threshold.",
      }),
      assessmentPolicy: null,
    });
    expect(result.totalScore).toBe(69);
    expect(result.needsManualReview).toBe(true);
    expect(result.passFailTotal).toBe(false);
  });

  // Og motstykket: NØYAKTIG på terskelen er bestått, ikke et grensetilfelle. Uten den åpne øvre
  // grensa ville hver eneste akkurat-bestått blitt sendt til sensor.
  it("nøyaktig på terskelen er bestått, ikke grensetilfelle", async () => {
    const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
    const result = resolveAssessmentDecision({
      mcqScaledScore: 21,
      mcqPercentScore: 70,
      llmResult: buildLlmResult(),
      assessmentPolicy: null,
    });
    expect(result.totalScore).toBe(70);
    expect(result.needsManualReview).toBe(false);
    expect(result.passFailTotal).toBe(true);
  });

  // ⚠️ Selve «relativt»-poenget, som QA-porten pekte på at ingen test bandt.
  //
  // Modulen har SIN EGEN terskel på 50. Standardbåndet skal da dekke 40-50 — ikke 60-70. Et fast
  // tallpar ville lagt hele vinduet OVER bestått-grensa for denne modulen, og da ville hver
  // bestått i 60-70 gått til sensor mens det tiltenkte båndet ble strøket automatisk.
  it("standardbåndet følger modulens EGEN terskel, ikke den globale", async () => {
    const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

    // 45 poeng: under modulens terskel (50), innenfor båndet 40-50 ⇒ sensor.
    const inBand = resolveAssessmentDecision({
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({ rubric_scores: { a: 3, b: 3, c: 3, d: 2, e: 2 }, rubric_total: 13 }),
      assessmentPolicy: { passRules: { totalMin: 50 } },
    });
    expect(inBand.totalScore).toBeGreaterThanOrEqual(40);
    expect(inBand.totalScore).toBeLessThan(50);
    expect(inBand.needsManualReview).toBe(true);

    // 65 poeng: over modulens terskel ⇒ bestått. Ville vært INNE i et fast 60-70-vindu.
    const above = resolveAssessmentDecision({
      mcqScaledScore: 20,
      mcqPercentScore: 67,
      llmResult: buildLlmResult(),
      assessmentPolicy: { passRules: { totalMin: 50 } },
    });
    expect(above.totalScore).toBeGreaterThan(50);
    expect(above.needsManualReview).toBe(false);
    expect(above.passFailTotal).toBe(true);
  });
});

// #578 — FREETEXT_ONLY: free-text + LLM assessment, no MCQ. The rubric spans the full 0–100
// (vs the 0–70 practical band in FREETEXT_PLUS_MCQ) and there is no MCQ gate.
describe("resolveAssessmentDecision — FREETEXT_ONLY (#578)", () => {
  const criteriaIds = [
    "relevance_for_case",
    "quality_and_utility",
    "iteration_and_improvement",
    "human_quality_assurance",
    "responsible_use",
  ];

  it("scales the rubric to 0–100 (no MCQ band) and ignores MCQ scores", async () => {
    const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
    const resolved = resolveAssessmentDecision({
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult(), // rubric_total 14 / max 20
      rubricMaxTotal: 20,
      rubricCriteriaIds: criteriaIds,
      freetextOnly: true,
    });
    // (14/20)*100 = 70 — the whole score is practical; no +30 MCQ band.
    expect(resolved.totalScore).toBe(70);
    expect(resolved.passFailTotal).toBe(true);
  });

  it("has no MCQ gate — passes even with mcqMinPercent set and a 0 MCQ score", async () => {
    const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
    const policy = { passRules: { mcqMinPercent: 100 } } as never;
    const freetext = resolveAssessmentDecision({
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult(),
      rubricMaxTotal: 20,
      rubricCriteriaIds: criteriaIds,
      assessmentPolicy: policy,
      freetextOnly: true,
    });
    expect(freetext.passFailTotal).toBe(true);

    // Contrast: the same inputs WITHOUT freetextOnly fail the MCQ gate (0% < 100%).
    const withMcqGate = resolveAssessmentDecision({
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult(),
      rubricMaxTotal: 20,
      rubricCriteriaIds: criteriaIds,
      assessmentPolicy: policy,
    });
    expect(withMcqGate.passFailTotal).toBe(false);
  });

  it("still routes free-text submissions to manual review when the LLM recommends it", async () => {
    const { resolveAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");
    const resolved = resolveAssessmentDecision({
      mcqScaledScore: 0,
      mcqPercentScore: 0,
      llmResult: buildLlmResult({ manual_review_recommended: true }),
      rubricMaxTotal: 20,
      rubricCriteriaIds: criteriaIds,
      freetextOnly: true,
    });
    expect(resolved.needsManualReview).toBe(true);
  });
});

// ── #950: den vanligste veien gjennom systemet ──────────────────────────────────────────────────
//
// ⚠️ En ren flervalgsmodul er der de fleste avgjørelsene blir til, og grunnen har TALL i seg — den
// kunne aldri oversettes ved tekstoppslag. QA-porten påpekte at ingenting pinnet at koden faktisk
// blir SKREVET: sletter man feltet i skrivekallet, regnes koden fortsatt ut, alt er grønt, og
// oversettelsen er død for alle nye avgjørelser uten at noe sier fra.
describe("createMcqOnlyDecision — grunnkoden lagres, ikke bare regnes ut", () => {
  beforeEach(() => {
    assessmentDecisionCreate.mockReset();
    assessmentDecisionCreate.mockResolvedValue({ id: "decision-mcq", decisionReason: "x", passFailTotal: true });
    submissionUpdate.mockReset();
    recordAuditEvent.mockReset();
    upsertCertificationStatusFromDecision.mockReset();
    claimDecisionWrite.mockReset();
    claimDecisionWrite.mockResolvedValue({ count: 1 });
  });

  it("skriver koden OG tallene setningen trenger", async () => {
    const { createMcqOnlyDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createMcqOnlyDecision({
      jobId: "job-mcq",
      fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-mcq",
      userId: "user-1",
      moduleVersionId: "module-version-1",
      mcqScaledScore: 30,
      mcqPercentScore: 100,
    });

    const written = assessmentDecisionCreate.mock.calls[0][0] as {
      decisionReasonCode: string;
      decisionReasonParams: string | null;
    };

    expect(written.decisionReasonCode).toBe("MCQ_ONLY_PASS");
    // Tallene lagres som JSON. Påstanden er på VERDIENE, ikke på at feltet finnes — et tomt
    // objekt ville bestått en ren eksistenssjekk og gitt deltakeren «{scorePercent}» på skjermen.
    expect(JSON.parse(written.decisionReasonParams ?? "null")).toEqual({ scorePercent: 100, minPercent: 70 });
  });

  it("skriver strykkoden med de samme tallene når kravet ikke er nådd", async () => {
    const { createMcqOnlyDecision } = await import("../../src/modules/assessment/decisionService.js");

    await createMcqOnlyDecision({
      jobId: "job-mcq",
      fence: { lockedBy: "worker-test", lockedAt: new Date(0) },
      submissionId: "submission-mcq",
      userId: "user-1",
      moduleVersionId: "module-version-1",
      mcqScaledScore: 18,
      mcqPercentScore: 60,
    });

    const written = assessmentDecisionCreate.mock.calls[0][0] as {
      decisionReasonCode: string;
      decisionReasonParams: string | null;
    };

    expect(written.decisionReasonCode).toBe("MCQ_ONLY_FAIL");
    expect(JSON.parse(written.decisionReasonParams ?? "null")).toEqual({ scorePercent: 60, minPercent: 70 });
  });

});
