import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppealStatus, DecisionType, ReviewStatus } from "../../src/db/prismaRuntime.js";
import type { LlmStructuredAssessment } from "../../src/services/llmAssessmentService.js";

// ─── Shared mocks ────────────────────────────────────────────────────────────

const recordAuditEvent = vi.fn();
const upsertRecertificationStatusFromDecision = vi.fn();
const logOperationalEvent = vi.fn();

// ─── decisionService mocks ───────────────────────────────────────────────────

const assessmentDecisionCreate = vi.fn();
const manualReviewCreate = vi.fn();
const decisionSubmissionUpdate = vi.fn();

// ─── manualReviewService mocks ───────────────────────────────────────────────

const findManualReviewForOverride = vi.fn();
const createOverrideDecision = vi.fn();
const resolveManualReview = vi.fn();
const manualReviewSubmissionUpdate = vi.fn();
const notifyAssessmentResult = vi.fn();

// ─── appealService mocks ──────────────────────────────────────────────────────

const findAppealForResolution = vi.fn();
const createResolutionDecision = vi.fn();
const markAppealResolved = vi.fn();
const appealSubmissionUpdate = vi.fn();
const notifyAppealStatusTransition = vi.fn();

// ─── vi.mock registrations ────────────────────────────────────────────────────

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

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

vi.mock("../../src/repositories/manualReviewRepository.js", () => ({
  manualReviewRepository: {
    findManualReviewForOverride,
    createOverrideDecision,
    resolveManualReview,
    updateSubmissionStatus: manualReviewSubmissionUpdate,
  },
  createManualReviewRepository: () => ({
    createOverrideDecision,
    resolveManualReview,
    updateSubmissionStatus: manualReviewSubmissionUpdate,
  }),
}));

vi.mock("../../src/repositories/appealRepository.js", () => ({
  appealRepository: {
    findAppealForResolution,
    createResolutionDecision,
    markAppealResolved,
    updateSubmissionStatus: appealSubmissionUpdate,
  },
  createAppealRepository: () => ({
    createResolutionDecision,
    markAppealResolved,
    updateSubmissionStatus: appealSubmissionUpdate,
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));
vi.mock("../../src/services/recertificationService.js", () => ({ upsertRecertificationStatusFromDecision }));
vi.mock("../../src/services/participantNotificationService.js", () => ({
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
    recertification: {
      validityDays: 365,
      dueOffsetDays: 30,
      dueSoonDays: 14,
      reminderDaysBefore: [30, 7],
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

describe("transactional failure injection", () => {
  beforeEach(() => {
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
    upsertRecertificationStatusFromDecision.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReset();
    assessmentDecisionCreate.mockReset();
    manualReviewCreate.mockReset();
    decisionSubmissionUpdate.mockReset();
    findManualReviewForOverride.mockReset();
    createOverrideDecision.mockReset();
    resolveManualReview.mockReset();
    manualReviewSubmissionUpdate.mockReset();
    notifyAssessmentResult.mockReset().mockResolvedValue(undefined);
    findAppealForResolution.mockReset();
    createResolutionDecision.mockReset();
    markAppealResolved.mockReset();
    appealSubmissionUpdate.mockReset();
    notifyAppealStatusTransition.mockReset().mockResolvedValue(undefined);
  });

  // ── createAssessmentDecision ──────────────────────────────────────────────

  describe("createAssessmentDecision", () => {
    it("halts the pipeline when the decision DB write fails", async () => {
      assessmentDecisionCreate.mockRejectedValue(new Error("DB connection lost"));

      const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

      await expect(
        createAssessmentDecision({ ...BASE_DECISION_INPUT, llmResult: buildPassingLlmResult() }),
      ).rejects.toThrow("DB connection lost");

      expect(decisionSubmissionUpdate).not.toHaveBeenCalled();
      expect(upsertRecertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("halts the pipeline when updateSubmissionStatus fails mid-transaction", async () => {
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-1",
        passFailTotal: true,
        decisionReason: "Automatic pass by threshold rules.",
      });
      decisionSubmissionUpdate.mockRejectedValue(new Error("Unique constraint violation"));

      const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

      await expect(
        createAssessmentDecision({ ...BASE_DECISION_INPUT, llmResult: buildPassingLlmResult() }),
      ).rejects.toThrow("Unique constraint violation");

      expect(upsertRecertificationStatusFromDecision).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
    });

    it("halts the pipeline when recertification upsert fails mid-transaction", async () => {
      assessmentDecisionCreate.mockResolvedValue({
        id: "decision-1",
        passFailTotal: true,
        decisionReason: "Automatic pass by threshold rules.",
      });
      decisionSubmissionUpdate.mockResolvedValue({ id: "submission-1" });
      upsertRecertificationStatusFromDecision.mockRejectedValue(new Error("Recert write failed"));

      const { createAssessmentDecision } = await import("../../src/services/decisionService.js");

      await expect(
        createAssessmentDecision({ ...BASE_DECISION_INPUT, llmResult: buildPassingLlmResult() }),
      ).rejects.toThrow("Recert write failed");

      expect(recordAuditEvent).not.toHaveBeenCalled();
    });
  });

  // ── finalizeManualReviewOverride ──────────────────────────────────────────

  describe("finalizeManualReviewOverride", () => {
    it("halts the pipeline when createOverrideDecision fails", async () => {
      findManualReviewForOverride.mockResolvedValue(BASE_MANUAL_REVIEW);
      assessmentDecisionCreate.mockRejectedValue(new Error("DB write failed"));

      const { finalizeManualReviewOverride } = await import("../../src/services/manualReviewService.js");

      await expect(
        finalizeManualReviewOverride({
          reviewId: "review-1",
          reviewerId: "reviewer-1",
          passFailTotal: true,
          decisionReason: "Override pass.",
          overrideReason: "Reviewer accepts.",
        }),
      ).rejects.toThrow("DB write failed");

      expect(resolveManualReview).not.toHaveBeenCalled();
      expect(decisionSubmissionUpdate).not.toHaveBeenCalled();
      expect(upsertRecertificationStatusFromDecision).not.toHaveBeenCalled();
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
      resolveManualReview.mockRejectedValue(new Error("Row locked by concurrent request"));

      const { finalizeManualReviewOverride } = await import("../../src/services/manualReviewService.js");

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

      const { finalizeManualReviewOverride } = await import("../../src/services/manualReviewService.js");

      await expect(
        finalizeManualReviewOverride({
          reviewId: "review-1",
          reviewerId: "reviewer-1",
          passFailTotal: false,
          decisionReason: "Override fail.",
          overrideReason: "Response insufficient.",
        }),
      ).rejects.toThrow("FK constraint violation");

      expect(resolveManualReview).not.toHaveBeenCalled();
      expect(upsertRecertificationStatusFromDecision).not.toHaveBeenCalled();
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
      resolveManualReview.mockResolvedValue({
        id: "review-1",
        reviewStatus: ReviewStatus.RESOLVED,
        overrideDecision: "PASS",
      });
      notifyAssessmentResult.mockRejectedValue(new Error("webhook unreachable"));

      const { finalizeManualReviewOverride } = await import("../../src/services/manualReviewService.js");

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
        "participant_notification_failed",
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

      const { resolveAppeal } = await import("../../src/services/appealService.js");

      await expect(
        resolveAppeal({
          appealId: "appeal-1",
          handlerId: "handler-1",
          passFailTotal: true,
          decisionReason: "Appeal accepted.",
          resolutionNote: "Resolved after review.",
        }),
      ).rejects.toThrow("DB write failed");

      expect(markAppealResolved).not.toHaveBeenCalled();
      expect(decisionSubmissionUpdate).not.toHaveBeenCalled();
      expect(upsertRecertificationStatusFromDecision).not.toHaveBeenCalled();
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
      markAppealResolved.mockRejectedValue(new Error("Optimistic lock conflict"));

      const { resolveAppeal } = await import("../../src/services/appealService.js");

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

      const { resolveAppeal } = await import("../../src/services/appealService.js");

      await expect(
        resolveAppeal({
          appealId: "appeal-1",
          handlerId: "handler-1",
          passFailTotal: true,
          decisionReason: "Appeal accepted.",
          resolutionNote: "Resolved after review.",
        }),
      ).rejects.toThrow("Deadlock detected");

      expect(markAppealResolved).not.toHaveBeenCalled();
      expect(upsertRecertificationStatusFromDecision).not.toHaveBeenCalled();
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
      markAppealResolved.mockResolvedValue({
        id: "appeal-1",
        appealStatus: AppealStatus.RESOLVED,
      });
      notifyAppealStatusTransition.mockRejectedValue(new Error("webhook timeout"));

      const { resolveAppeal } = await import("../../src/services/appealService.js");

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
});
