import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppealStatus, DecisionType, ReviewStatus } from "../../src/db/prismaRuntime.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

// ─── Shared mocks ────────────────────────────────────────────────────────────

const recordAuditEvent = vi.fn();
const upsertCertificationStatusFromDecision = vi.fn();
const logOperationalEvent = vi.fn();

// ─── createSubmission / retake supersede mocks ────────────────────────────────

const submissionCreate = vi.fn();
const resolveSubmissionResponseJson = vi.fn();
const getModuleWithActiveVersion = vi.fn();
const supersedeEligibleReviewsForRetake = vi.fn();
const supersedeEligibleAppealsForRetake = vi.fn();

// ─── decisionService mocks ───────────────────────────────────────────────────

const assessmentDecisionCreate = vi.fn();
const manualReviewCreate = vi.fn();
const decisionSubmissionUpdate = vi.fn();

// ─── manualReviewService mocks ───────────────────────────────────────────────

const findManualReviewForOverride = vi.fn();
const createOverrideDecision = vi.fn();
const resolveManualReviewGuarded = vi.fn();
const findManualReviewById = vi.fn();
const manualReviewSubmissionUpdate = vi.fn();
const notifyAssessmentResult = vi.fn();

// ─── appealService mocks ──────────────────────────────────────────────────────

const findAppealForResolution = vi.fn();
const createResolutionDecision = vi.fn();
const markAppealResolvedGuarded = vi.fn();
const findAppealById = vi.fn();
const appealSubmissionUpdate = vi.fn();
const notifyAppealStatusTransition = vi.fn();

// ─── vi.mock registrations ────────────────────────────────────────────────────

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

vi.mock("../../src/modules/submission/submissionRepository.js", () => ({
  getModuleWithActiveVersion,
  submissionRepository: { create: submissionCreate },
  createSubmissionRepository: () => ({ create: submissionCreate }),
}));
vi.mock("../../src/modules/assessment/documentParsingService.js", () => ({ resolveSubmissionResponseJson }));
vi.mock("../../src/modules/review/index.js", () => ({ supersedeEligibleReviewsForRetake }));
vi.mock("../../src/modules/appeal/index.js", () => ({ supersedeEligibleAppealsForRetake }));

vi.mock("../../src/repositories/decisionRepository.js", () => ({
  decisionRepository: {
    createAssessmentDecision: assessmentDecisionCreate,
    createManualReview: manualReviewCreate,
    updateSubmissionStatus: decisionSubmissionUpdate,
  },
  createDecisionRepository: () => ({
    createAssessmentDecision: assessmentDecisionCreate,
    createManualReview: manualReviewCreate,
    updateSubmissionStatus: decisionSubmissionUpdate,
  }),
}));

vi.mock("../../src/modules/review/manualReviewRepository.js", () => ({
  manualReviewRepository: {
    findManualReviewForOverride,
    createOverrideDecision,
    resolveManualReviewGuarded,
    findManualReviewById,
    updateSubmissionStatus: manualReviewSubmissionUpdate,
  },
  createManualReviewRepository: () => ({
    createOverrideDecision,
    resolveManualReviewGuarded,
    findManualReviewById,
    updateSubmissionStatus: manualReviewSubmissionUpdate,
  }),
}));

vi.mock("../../src/modules/appeal/appealRepository.js", () => ({
  appealRepository: {
    findAppealForResolution,
    createResolutionDecision,
    markAppealResolvedGuarded,
    findAppealById,
    updateSubmissionStatus: appealSubmissionUpdate,
  },
  createAppealRepository: () => ({
    createResolutionDecision,
    markAppealResolvedGuarded,
    findAppealById,
    updateSubmissionStatus: appealSubmissionUpdate,
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));
vi.mock("../../src/modules/certification/index.js", () => ({
  upsertCertificationStatusFromDecision,
  notifyAssessmentResult,
  notifyAppealStatusTransition,
}));
vi.mock("../../src/observability/operationalLog.js", () => ({ logOperationalEvent }));
vi.mock("../../src/config/env.js", () => ({
  env: { DEFAULT_LOCALE: "en-GB" },
}));
vi.mock("../../src/config/assessmentRules.js", () => ({
  getAssessmentRules: () => ({
    thresholds: { totalMin: 60, practicalMinPercent: 40, mcqMinPercent: 60 },
    weights: { practicalMaxScore: 50 },
    manualReview: {
      borderlineWindow: { min: 55, max: 59 },
      redFlagSeverities: ["HIGH", "CRITICAL"],
    },
  }),
}));
vi.mock("../../src/i18n/content.js", () => ({
  localizeContentText: (_locale: string, value: unknown) =>
    typeof value === "string" ? value : "Module Title",
}));
vi.mock("../../src/i18n/locale.js", () => ({
  normalizeLocale: (v: string) => v,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPassingLlmResult(overrides: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment {
  return {
    module_id: "module-1",
    rubric_scores: {
      relevance_for_case: 3,
      quality_and_utility: 3,
      iteration_and_improvement: 3,
      human_quality_assurance: 3,
      responsible_use: 3,
    },
    rubric_total: 15,
    practical_score_scaled: 48,
    pass_fail_practical: true,
    criterion_rationales: {
      relevance_for_case: "Good",
      quality_and_utility: "Good",
      iteration_and_improvement: "Good",
      human_quality_assurance: "Good",
      responsible_use: "Good",
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

const BASE_DECISION_INPUT = {
  submissionId: "submission-1",
  userId: "user-1",
  moduleVersionId: "module-version-1",
  rubricVersionId: "rubric-version-1",
  promptTemplateVersionId: "prompt-version-1",
  mcqScaledScore: 30,
  mcqPercentScore: 75,
  rubricMaxTotal: 20,
};

const BASE_MANUAL_REVIEW = {
  id: "review-1",
  reviewStatus: ReviewStatus.IN_REVIEW,
  reviewerId: "reviewer-1",
  submission: {
    id: "submission-1",
    moduleId: "module-1",
    locale: "en-GB",
    submittedAt: new Date("2026-03-01T10:00:00.000Z"),
    user: { email: "participant@company.com", name: "Test Participant" },
    module: { title: "Test Module" },
    decisions: [
      {
        id: "decision-1",
        submissionId: "submission-1",
        moduleVersionId: "module-version-1",
        rubricVersionId: "rubric-version-1",
        promptTemplateVersionId: "prompt-version-1",
        mcqScaledScore: 30,
        practicalScaledScore: 41,
        totalScore: 71,
        redFlagsJson: "[]",
      },
    ],
  },
};

const BASE_APPEAL = {
  id: "appeal-1",
  appealStatus: AppealStatus.IN_REVIEW,
  resolvedById: "handler-1",
  appealedBy: {
    id: "user-1",
    email: "user-1@company.com",
    name: "User One",
  },
  submission: {
    decisions: [
      {
        id: "decision-1",
        submissionId: "submission-1",
        moduleVersionId: "module-version-1",
        rubricVersionId: "rubric-version-1",
        promptTemplateVersionId: "prompt-version-1",
        mcqScaledScore: 30,
        practicalScaledScore: 42,
        totalScore: 72,
        redFlagsJson: "[]",
      },
    ],
    module: { title: "Test Module" },
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

// #994: modulgrafene leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(async () => {
  await import("../../src/modules/appeal/appealService.js");
  await import("../../src/modules/assessment/decisionService.js");
  await import("../../src/modules/review/manualReviewService.js");
  await import("../../src/modules/submission/submissionService.js");
});

describe("transactional failure injection", () => {
  beforeEach(() => {
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
    upsertCertificationStatusFromDecision.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReset();
    assessmentDecisionCreate.mockReset();
    manualReviewCreate.mockReset();
    decisionSubmissionUpdate.mockReset();
    findManualReviewForOverride.mockReset();
    createOverrideDecision.mockReset();
    resolveManualReviewGuarded.mockReset();
    resolveManualReviewGuarded.mockResolvedValue({ count: 1 });
    findManualReviewById.mockReset();
    findManualReviewById.mockResolvedValue({ id: "review-1", reviewStatus: ReviewStatus.RESOLVED, overrideDecision: "PASS" });
    manualReviewSubmissionUpdate.mockReset();
    notifyAssessmentResult.mockReset().mockResolvedValue(undefined);
    findAppealForResolution.mockReset();
    createResolutionDecision.mockReset();
    markAppealResolvedGuarded.mockReset();
    markAppealResolvedGuarded.mockResolvedValue({ count: 1 });
    findAppealById.mockReset();
    findAppealById.mockResolvedValue({ id: "appeal-1", appealStatus: AppealStatus.RESOLVED });
    appealSubmissionUpdate.mockReset();
    notifyAppealStatusTransition.mockReset().mockResolvedValue(undefined);
  });

  // ── createAssessmentDecision ──────────────────────────────────────────────

  describe("createAssessmentDecision", () => {
    it("halts the pipeline when the decision DB write fails", async () => {
      assessmentDecisionCreate.mockRejectedValue(new Error("DB connection lost"));

      const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

      await expect(
        createAssessmentDecision({ ...BASE_DECISION_INPUT, llmResult: buildPassingLlmResult() }),
      ).rejects.toThrow("DB connection lost");

      expect(decisionSubmissionUpdate).not.toHaveBeenCalled();
      expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("halts the pipeline when updateSubmissionStatus fails mid-transaction", async () => {
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-1",
        passFailTotal: true,
        decisionReason: "Automatic pass by threshold rules.",
      });
      decisionSubmissionUpdate.mockRejectedValue(new Error("Unique constraint violation"));

      const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

      await expect(
        createAssessmentDecision({ ...BASE_DECISION_INPUT, llmResult: buildPassingLlmResult() }),
      ).rejects.toThrow("Unique constraint violation");

      expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("halts the pipeline when the certification upsert fails mid-transaction", async () => {
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-1",
        passFailTotal: true,
        decisionReason: "Automatic pass by threshold rules.",
      });
      decisionSubmissionUpdate.mockResolvedValue({ id: "submission-1" });
      upsertCertificationStatusFromDecision.mockRejectedValue(new Error("Certification write failed"));

      const { createAssessmentDecision } = await import("../../src/modules/assessment/decisionService.js");

      await expect(
        createAssessmentDecision({ ...BASE_DECISION_INPUT, llmResult: buildPassingLlmResult() }),
      ).rejects.toThrow("Certification write failed");

      expect(recordAuditEvent).not.toHaveBeenCalled();
    });
  });

  // ── finalizeManualReviewOverride ──────────────────────────────────────────

  describe("finalizeManualReviewOverride", () => {
    it("halts the pipeline when createOverrideDecision fails", async () => {
      findManualReviewForOverride.mockResolvedValue(BASE_MANUAL_REVIEW);
      assessmentDecisionCreate.mockRejectedValue(new Error("DB write failed"));

      const { finalizeManualReviewOverride } = await import("../../src/modules/review/manualReviewService.js");

      await expect(
        finalizeManualReviewOverride({
          reviewId: "review-1",
          reviewerId: "reviewer-1",
          passFailTotal: true,
          decisionReason: "Override pass.",
          overrideReason: "Reviewer accepts.",
        }),
      ).rejects.toThrow("DB write failed");

      // #791: the guarded transition runs FIRST; the later failure rolls the whole transaction back.
      expect(resolveManualReviewGuarded).toHaveBeenCalled();
      expect(decisionSubmissionUpdate).not.toHaveBeenCalled();
      expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
      expect(notifyAssessmentResult).not.toHaveBeenCalled();
    });

    it("halts the pipeline when resolveManualReview fails mid-transaction", async () => {
      findManualReviewForOverride.mockResolvedValue(BASE_MANUAL_REVIEW);
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-2",
        passFailTotal: true,
        decisionType: DecisionType.MANUAL_OVERRIDE,
      });
      decisionSubmissionUpdate.mockResolvedValue({ id: "submission-1" });
      resolveManualReviewGuarded.mockRejectedValue(new Error("Row locked by concurrent request"));

      const { finalizeManualReviewOverride } = await import("../../src/modules/review/manualReviewService.js");

      await expect(
        finalizeManualReviewOverride({
          reviewId: "review-1",
          reviewerId: "reviewer-1",
          passFailTotal: true,
          decisionReason: "Override pass.",
          overrideReason: "Reviewer accepts.",
        }),
      ).rejects.toThrow("Row locked by concurrent request");

      expect(notifyAssessmentResult).not.toHaveBeenCalled();
    });

    it("halts the pipeline when updateSubmissionStatus fails mid-transaction", async () => {
      findManualReviewForOverride.mockResolvedValue(BASE_MANUAL_REVIEW);
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-2",
        passFailTotal: false,
        decisionType: DecisionType.MANUAL_OVERRIDE,
      });
      decisionSubmissionUpdate.mockRejectedValue(new Error("FK constraint violation"));

      const { finalizeManualReviewOverride } = await import("../../src/modules/review/manualReviewService.js");

      await expect(
        finalizeManualReviewOverride({
          reviewId: "review-1",
          reviewerId: "reviewer-1",
          passFailTotal: false,
          decisionReason: "Override fail.",
          overrideReason: "Response insufficient.",
        }),
      ).rejects.toThrow("FK constraint violation");

      // #791: the guarded transition runs FIRST; the later failure rolls the whole transaction back.
      expect(resolveManualReviewGuarded).toHaveBeenCalled();
      expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
      expect(notifyAssessmentResult).not.toHaveBeenCalled();
    });

    it("tolerates notification failure after a successful transaction", async () => {
      findManualReviewForOverride.mockResolvedValue(BASE_MANUAL_REVIEW);
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-2",
        passFailTotal: true,
        decisionType: DecisionType.MANUAL_OVERRIDE,
      });
      decisionSubmissionUpdate.mockResolvedValue({ id: "submission-1" });
      notifyAssessmentResult.mockRejectedValue(new Error("webhook unreachable"));

      const { finalizeManualReviewOverride } = await import("../../src/modules/review/manualReviewService.js");

      const result = await finalizeManualReviewOverride({
        reviewId: "review-1",
        reviewerId: "reviewer-1",
        passFailTotal: true,
        decisionReason: "Override pass.",
        overrideReason: "Reviewer accepts.",
      });

      expect(result).toMatchObject({
        review: { id: "review-1", reviewStatus: ReviewStatus.RESOLVED },
        overrideDecision: { id: "decision-2" },
      });
      expect(logOperationalEvent).toHaveBeenCalledWith(
        "participant_notification_pipeline_failed",
        expect.objectContaining({ submissionId: "submission-1" }),
        "error",
      );
    });
  });

  // ── resolveAppeal ─────────────────────────────────────────────────────────

  describe("resolveAppeal", () => {
    it("halts the pipeline when createResolutionDecision fails", async () => {
      findAppealForResolution.mockResolvedValue(BASE_APPEAL);
      assessmentDecisionCreate.mockRejectedValue(new Error("DB write failed"));

      const { resolveAppeal } = await import("../../src/modules/appeal/appealService.js");

      await expect(
        resolveAppeal({
          appealId: "appeal-1",
          handlerId: "handler-1",
          passFailTotal: true,
          decisionReason: "Appeal accepted.",
          resolutionNote: "Resolved after review.",
        }),
      ).rejects.toThrow("DB write failed");

      // #790: the guarded transition runs FIRST now; the later failure rolls the whole transaction back
      // (nothing persists), but the guard call itself was made before the failure.
      expect(markAppealResolvedGuarded).toHaveBeenCalled();
      expect(decisionSubmissionUpdate).not.toHaveBeenCalled();
      expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
      expect(notifyAppealStatusTransition).not.toHaveBeenCalled();
    });

    it("halts the pipeline when markAppealResolved fails mid-transaction", async () => {
      findAppealForResolution.mockResolvedValue(BASE_APPEAL);
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-2",
        passFailTotal: true,
        decisionType: DecisionType.APPEAL_RESOLUTION,
      });
      decisionSubmissionUpdate.mockResolvedValue({ id: "submission-1" });
      markAppealResolvedGuarded.mockRejectedValue(new Error("Optimistic lock conflict"));

      const { resolveAppeal } = await import("../../src/modules/appeal/appealService.js");

      await expect(
        resolveAppeal({
          appealId: "appeal-1",
          handlerId: "handler-1",
          passFailTotal: true,
          decisionReason: "Appeal accepted.",
          resolutionNote: "Resolved after review.",
        }),
      ).rejects.toThrow("Optimistic lock conflict");

      expect(notifyAppealStatusTransition).not.toHaveBeenCalled();
    });

    it("halts the pipeline when updateSubmissionStatus fails mid-transaction", async () => {
      findAppealForResolution.mockResolvedValue(BASE_APPEAL);
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-2",
        passFailTotal: true,
        decisionType: DecisionType.APPEAL_RESOLUTION,
      });
      decisionSubmissionUpdate.mockRejectedValue(new Error("Deadlock detected"));

      const { resolveAppeal } = await import("../../src/modules/appeal/appealService.js");

      await expect(
        resolveAppeal({
          appealId: "appeal-1",
          handlerId: "handler-1",
          passFailTotal: true,
          decisionReason: "Appeal accepted.",
          resolutionNote: "Resolved after review.",
        }),
      ).rejects.toThrow("Deadlock detected");

      // #790: the guarded transition runs FIRST now; the later failure rolls the whole transaction back
      // (nothing persists), but the guard call itself was made before the failure.
      expect(markAppealResolvedGuarded).toHaveBeenCalled();
      expect(upsertCertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
      expect(notifyAppealStatusTransition).not.toHaveBeenCalled();
    });

    it("tolerates notification failure after a successful transaction", async () => {
      findAppealForResolution.mockResolvedValue(BASE_APPEAL);
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-2",
        passFailTotal: true,
        decisionType: DecisionType.APPEAL_RESOLUTION,
      });
      decisionSubmissionUpdate.mockResolvedValue({ id: "submission-1" });
      notifyAppealStatusTransition.mockRejectedValue(new Error("webhook timeout"));

      const { resolveAppeal } = await import("../../src/modules/appeal/appealService.js");

      const result = await resolveAppeal({
        appealId: "appeal-1",
        handlerId: "handler-1",
        passFailTotal: true,
        decisionReason: "Appeal accepted.",
        resolutionNote: "Resolved after review.",
      });

      expect(result).toMatchObject({
        appeal: { id: "appeal-1", appealStatus: AppealStatus.RESOLVED },
        resolutionDecision: { id: "decision-2" },
      });
      expect(logOperationalEvent).toHaveBeenCalledWith(
        "participant_notification_pipeline_failed",
        expect.objectContaining({ appealId: "appeal-1" }),
        "error",
      );
    });
  });

  // ── createSubmission / retake supersede ───────────────────────────────────

  describe("createSubmission retake supersede", () => {
    const BASE_MODULE = {
      id: "module-1",
      activeVersion: { id: "module-version-1", publishedAt: new Date("2026-01-01T00:00:00.000Z") },
    };
    const BASE_PARSE = { resolvedResponseJson: { response: "text" }, parser: "json" as const };
    const BASE_SUBMISSION = { id: "submission-1", moduleId: "module-1", moduleVersionId: "module-version-1", deliveryType: "text" };

    beforeEach(() => {
      getModuleWithActiveVersion.mockResolvedValue(BASE_MODULE);
      resolveSubmissionResponseJson.mockResolvedValue(BASE_PARSE);
      submissionCreate.mockResolvedValue(BASE_SUBMISSION);
      supersedeEligibleReviewsForRetake.mockResolvedValue(0);
      supersedeEligibleAppealsForRetake.mockResolvedValue(0);
    });

    it("halts the transaction when submission create fails", async () => {
      submissionCreate.mockRejectedValue(new Error("DB write failed"));

      const { createSubmission } = await import("../../src/modules/submission/submissionService.js");

      await expect(
        createSubmission({ userId: "user-1", moduleId: "module-1", locale: "nb", deliveryType: "text", responseJson: {} }),
      ).rejects.toThrow("DB write failed");

      expect(supersedeEligibleReviewsForRetake).not.toHaveBeenCalled();
      expect(supersedeEligibleAppealsForRetake).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("halts the transaction when review supersede fails mid-orchestration", async () => {
      supersedeEligibleReviewsForRetake.mockRejectedValue(new Error("Review supersede failed"));

      const { createSubmission } = await import("../../src/modules/submission/submissionService.js");

      await expect(
        createSubmission({ userId: "user-1", moduleId: "module-1", locale: "nb", deliveryType: "text", responseJson: {} }),
      ).rejects.toThrow("Review supersede failed");

      expect(supersedeEligibleAppealsForRetake).not.toHaveBeenCalled();
    });

    it("halts the transaction when appeal supersede fails mid-orchestration", async () => {
      supersedeEligibleReviewsForRetake.mockResolvedValue(1);
      supersedeEligibleAppealsForRetake.mockRejectedValue(new Error("Appeal supersede failed"));

      const { createSubmission } = await import("../../src/modules/submission/submissionService.js");

      await expect(
        createSubmission({ userId: "user-1", moduleId: "module-1", locale: "nb", deliveryType: "text", responseJson: {} }),
      ).rejects.toThrow("Appeal supersede failed");
    });

    it("supersedes both review and appeal in the same transaction", async () => {
      supersedeEligibleReviewsForRetake.mockResolvedValue(1);
      supersedeEligibleAppealsForRetake.mockResolvedValue(1);

      const { createSubmission } = await import("../../src/modules/submission/submissionService.js");

      const result = await createSubmission({ userId: "user-1", moduleId: "module-1", locale: "nb", deliveryType: "text", responseJson: {} });

      expect(supersedeEligibleReviewsForRetake).toHaveBeenCalledWith("user-1", "module-1", "submission-1", {});
      expect(supersedeEligibleAppealsForRetake).toHaveBeenCalledWith("user-1", "module-1", "submission-1", {});
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "retake_supersede_completed", metadata: { supersededReviewCount: 1, supersededAppealCount: 1 } }),
        {},
      );
      expect(result).toMatchObject({ id: "submission-1" });
    });

    it("succeeds without supersede audit when no prior open items exist", async () => {
      supersedeEligibleReviewsForRetake.mockResolvedValue(0);
      supersedeEligibleAppealsForRetake.mockResolvedValue(0);

      const { createSubmission } = await import("../../src/modules/submission/submissionService.js");
      await createSubmission({ userId: "user-1", moduleId: "module-1", locale: "nb", deliveryType: "text", responseJson: {} });

      const actions = recordAuditEvent.mock.calls.map((c: unknown[]) => (c[0] as { action: string }).action);
      expect(actions).toContain("submission_created");
      expect(actions).not.toContain("retake_supersede_completed");
    });
  });
});
