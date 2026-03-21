import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionType, ReviewStatus } from "../../src/db/prismaRuntime.js";
import { ConflictError, NotFoundError } from "../../src/errors/AppError.js";

const findManualReviewForClaim = vi.fn();
const markManualReviewClaimed = vi.fn();
const findManualReviewForOverride = vi.fn();
const resolveManualReview = vi.fn();
const findOpenByUserAndModule = vi.fn();
const supersedeMany = vi.fn();
const updateSubmissionStatus = vi.fn();
const recordAuditEvent = vi.fn();
const appendDecisionWithLineage = vi.fn();
const notifyAssessmentResult = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

vi.mock("../../src/modules/review/manualReviewRepository.js", () => ({
  manualReviewRepository: {
    findManualReviewForClaim,
    markManualReviewClaimed,
    findManualReviewForOverride,
    resolveManualReview,
    findOpenByUserAndModule,
    supersedeMany,
    updateSubmissionStatus,
  },
  createManualReviewRepository: () => ({
    resolveManualReview,
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/modules/assessment/decisionLineageService.js", () => ({
  appendDecisionWithLineage,
}));

vi.mock("../../src/modules/certification/index.js", () => ({
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
    resolveManualReview.mockReset();
    findOpenByUserAndModule.mockReset();
    supersedeMany.mockReset();
    updateSubmissionStatus.mockReset();
    recordAuditEvent.mockReset();
    appendDecisionWithLineage.mockReset();
    notifyAssessmentResult.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReset();
  });

  it("rejects claim when the manual review is missing", async () => {
    findManualReviewForClaim.mockResolvedValue(null);

    const { claimManualReview } = await import("../../src/modules/review/manualReviewService.js");

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

    const { claimManualReview } = await import("../../src/modules/review/manualReviewService.js");

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

    const { finalizeManualReviewOverride } = await import("../../src/modules/review/manualReviewService.js");

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

    expect(appendDecisionWithLineage).not.toHaveBeenCalled();
  });

  it("rejects claim when manual review is superseded", async () => {
    findManualReviewForClaim.mockResolvedValue({
      id: "review-1",
      submissionId: "submission-1",
      reviewStatus: ReviewStatus.SUPERSEDED,
      reviewerId: null,
    });

    const { claimManualReview } = await import("../../src/modules/review/manualReviewService.js");

    await expect(claimManualReview("review-1", "reviewer-1")).rejects.toMatchObject({
      code: "review_already_resolved",
    });
    expect(markManualReviewClaimed).not.toHaveBeenCalled();
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
    appendDecisionWithLineage.mockResolvedValue({
      id: "decision-2",
      passFailTotal: false,
      decisionType: DecisionType.MANUAL_OVERRIDE,
    });
    resolveManualReview.mockResolvedValue({
      id: "review-1",
      reviewStatus: ReviewStatus.RESOLVED,
      overrideDecision: "FAIL",
    });

    const { finalizeManualReviewOverride } = await import("../../src/modules/review/manualReviewService.js");

    const result = await finalizeManualReviewOverride({
      reviewId: "review-1",
      reviewerId: "reviewer-1",
      passFailTotal: false,
      decisionReason: "Override fail.",
      overrideReason: "Human reviewer found the response insufficient.",
    });

    expect(appendDecisionWithLineage).toHaveBeenCalledWith(
      expect.objectContaining({
        parentDecision: expect.objectContaining({ id: "decision-1", submissionId: "submission-1" }),
        decisionType: DecisionType.MANUAL_OVERRIDE,
        passFailTotal: false,
        decisionReason: "Override fail.",
        finalisedById: "reviewer-1",
        finalisedAt: expect.any(Date),
        auditAction: "manual_override_decision_created",
      }),
      expect.anything(),
    );
    expect(resolveManualReview).toHaveBeenCalledWith({
      reviewId: "review-1",
      reviewerId: "reviewer-1",
      reviewStatus: ReviewStatus.RESOLVED,
      reviewedAt: expect.any(Date),
      overrideDecision: "FAIL",
      overrideReason: "Human reviewer found the response insufficient.",
    });
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

  it("supersedes open reviews for a user+module and marks submissions completed", async () => {
    findOpenByUserAndModule.mockResolvedValue([
      { id: "review-1", submissionId: "submission-old-1" },
      { id: "review-2", submissionId: "submission-old-2" },
    ]);
    supersedeMany.mockResolvedValue({ count: 2 });
    updateSubmissionStatus.mockResolvedValue({});
    recordAuditEvent.mockResolvedValue({});

    const { cancelSupersededReviews } = await import("../../src/modules/review/manualReviewService.js");

    const count = await cancelSupersededReviews("user-1", "module-1", "submission-new");

    expect(count).toBe(2);
    expect(supersedeMany).toHaveBeenCalledWith(["review-1", "review-2"], "submission-new", expect.any(Date));
    expect(updateSubmissionStatus).toHaveBeenCalledTimes(2);
    expect(recordAuditEvent).toHaveBeenCalledTimes(2);
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "manual_review",
      action: "review_superseded",
      metadata: expect.objectContaining({ newSubmissionId: "submission-new" }),
    }));
  });

  it("returns 0 when no open reviews exist for the user+module", async () => {
    findOpenByUserAndModule.mockResolvedValue([]);

    const { cancelSupersededReviews } = await import("../../src/modules/review/manualReviewService.js");

    const count = await cancelSupersededReviews("user-1", "module-1", "submission-new");

    expect(count).toBe(0);
    expect(supersedeMany).not.toHaveBeenCalled();
    expect(updateSubmissionStatus).not.toHaveBeenCalled();
  });
});
