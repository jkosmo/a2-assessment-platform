import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionType, ReviewStatus, SubmissionStatus } from "../../src/db/prismaRuntime.js";
import { ConflictError, NotFoundError } from "../../src/errors/AppError.js";

const findManualReviewForClaim = vi.fn();
const markManualReviewClaimed = vi.fn();
const findManualReviewForOverride = vi.fn();
const createOverrideDecision = vi.fn();
const resolveManualReview = vi.fn();
const updateSubmissionStatus = vi.fn();
const recordAuditEvent = vi.fn();
const upsertRecertificationStatusFromDecision = vi.fn();
const notifyAssessmentResult = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

vi.mock("../../src/repositories/manualReviewRepository.js", () => ({
  manualReviewRepository: {
    findManualReviewForClaim,
    markManualReviewClaimed,
    findManualReviewForOverride,
    createOverrideDecision,
    resolveManualReview,
    updateSubmissionStatus,
  },
  createManualReviewRepository: () => ({
    createOverrideDecision,
    resolveManualReview,
    updateSubmissionStatus,
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/services/recertificationService.js", () => ({
  upsertRecertificationStatusFromDecision,
}));

vi.mock("../../src/services/participantNotificationService.js", () => ({
  notifyAssessmentResult,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("manual review service", () => {
  beforeEach(() => {
    findManualReviewForClaim.mockReset();
    markManualReviewClaimed.mockReset();
    findManualReviewForOverride.mockReset();
    createOverrideDecision.mockReset();
    resolveManualReview.mockReset();
    updateSubmissionStatus.mockReset();
    recordAuditEvent.mockReset();
    upsertRecertificationStatusFromDecision.mockReset();
    notifyAssessmentResult.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReset();
  });

  it("rejects claim when the manual review is missing", async () => {
    findManualReviewForClaim.mockResolvedValue(null);

    const { claimManualReview } = await import("../../src/services/manualReviewService.js");

    await expect(claimManualReview("review-1", "reviewer-1")).rejects.toBeInstanceOf(NotFoundError);
    expect(markManualReviewClaimed).not.toHaveBeenCalled();
  });

  it("rejects claim when the manual review is already assigned to another reviewer", async () => {
    findManualReviewForClaim.mockResolvedValue({
      id: "review-1",
      submissionId: "submission-1",
      reviewStatus: ReviewStatus.IN_REVIEW,
      reviewerId: "reviewer-2",
    });

    const { claimManualReview } = await import("../../src/services/manualReviewService.js");

    await expect(claimManualReview("review-1", "reviewer-1")).rejects.toMatchObject({
      code: "review_already_assigned",
    });
    expect(markManualReviewClaimed).not.toHaveBeenCalled();
  });

  it("rejects override when the submission has no decision yet", async () => {
    findManualReviewForOverride.mockResolvedValue({
      id: "review-1",
      reviewStatus: ReviewStatus.IN_REVIEW,
      reviewerId: "reviewer-1",
      submission: {
        decisions: [],
      },
    });

    const { finalizeManualReviewOverride } = await import("../../src/services/manualReviewService.js");

    await expect(
      finalizeManualReviewOverride({
        reviewId: "review-1",
        reviewerId: "reviewer-1",
        passFailTotal: true,
        decisionReason: "Override pass.",
        overrideReason: "Human reviewer accepts the response.",
      }),
    ).rejects.toMatchObject({
      code: "missing_decision",
    });

    expect(createOverrideDecision).not.toHaveBeenCalled();
  });

  it("creates an override decision and resolves the review", async () => {
    findManualReviewForOverride.mockResolvedValue({
      id: "review-1",
      reviewStatus: ReviewStatus.IN_REVIEW,
      reviewerId: "reviewer-1",
      submission: {
        id: "submission-1",
        moduleId: "module-1",
        locale: "nb",
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
    });
    createOverrideDecision.mockResolvedValue({
      id: "decision-2",
      passFailTotal: false,
      decisionType: DecisionType.MANUAL_OVERRIDE,
    });
    resolveManualReview.mockResolvedValue({
      id: "review-1",
      reviewStatus: ReviewStatus.RESOLVED,
      overrideDecision: "FAIL",
    });
    updateSubmissionStatus.mockResolvedValue({ id: "submission-1" });

    const { finalizeManualReviewOverride } = await import("../../src/services/manualReviewService.js");

    const result = await finalizeManualReviewOverride({
      reviewId: "review-1",
      reviewerId: "reviewer-1",
      passFailTotal: false,
      decisionReason: "Override fail.",
      overrideReason: "Human reviewer found the response insufficient.",
    });

    expect(createOverrideDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: "submission-1",
        decisionType: DecisionType.MANUAL_OVERRIDE,
        parentDecisionId: "decision-1",
        passFailTotal: false,
        decisionReason: "Override fail.",
        finalisedById: "reviewer-1",
        finalisedAt: expect.any(Date),
      }),
    );
    expect(resolveManualReview).toHaveBeenCalledWith({
      reviewId: "review-1",
      reviewerId: "reviewer-1",
      reviewStatus: ReviewStatus.RESOLVED,
      reviewedAt: expect.any(Date),
      overrideDecision: "FAIL",
      overrideReason: "Human reviewer found the response insufficient.",
    });
    expect(updateSubmissionStatus).toHaveBeenCalledWith("submission-1", SubmissionStatus.COMPLETED);
    expect(upsertRecertificationStatusFromDecision).toHaveBeenCalledWith({
      decisionId: "decision-2",
      actorId: "reviewer-1",
    }, expect.anything());
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_decision",
        entityId: "decision-2",
        action: "manual_override_decision_created",
      }),
      expect.anything(),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "manual_review",
        entityId: "review-1",
        action: "manual_review_resolved",
      }),
      expect.anything(),
    );
    expect(result).toEqual({
      review: {
        id: "review-1",
        reviewStatus: ReviewStatus.RESOLVED,
        overrideDecision: "FAIL",
      },
      overrideDecision: {
        id: "decision-2",
        passFailTotal: false,
        decisionType: DecisionType.MANUAL_OVERRIDE,
      },
    });
  });
});
