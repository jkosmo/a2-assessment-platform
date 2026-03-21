import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppealStatus, DecisionType, SubmissionStatus } from "../../src/db/prismaRuntime.js";
import { ConflictError, NotFoundError } from "../../src/errors/AppError.js";
import { prisma as mockPrisma } from "../../src/db/prisma.js";

const findOwnedSubmissionWithLatestDecision = vi.fn();
const findActiveAppealForSubmission = vi.fn();
const findOpenByUserAndModule = vi.fn();
const supersedeMany = vi.fn();
const createAppeal = vi.fn();
const updateSubmissionStatus = vi.fn();
const findUserNotificationRecipient = vi.fn();
const findAppealForClaim = vi.fn();
const markAppealInReview = vi.fn();
const findAppealForResolution = vi.fn();
const markAppealResolved = vi.fn();
const recordAuditEvent = vi.fn();
const notifyAppealStatusTransition = vi.fn();
const logOperationalEvent = vi.fn();
const appendDecisionWithLineage = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: { $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb({})) },
}));

vi.mock("../../src/modules/appeal/appealRepository.js", () => ({
  appealRepository: {
    findOwnedSubmissionWithLatestDecision,
    findActiveAppealForSubmission,
    findOpenByUserAndModule,
    supersedeMany,
    findUserNotificationRecipient,
    findAppealForClaim,
    markAppealInReview,
    findAppealForResolution,
  },
  createAppealRepository: () => ({
    createAppeal,
    updateSubmissionStatus,
    markAppealResolved,
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/services/decisionLineageService.js", () => ({
  appendDecisionWithLineage,
}));

vi.mock("../../src/services/participantNotificationService.js", () => ({
  notifyAppealStatusTransition,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("appeal service", () => {
  beforeEach(() => {
    findOwnedSubmissionWithLatestDecision.mockReset();
    findActiveAppealForSubmission.mockReset();
    findOpenByUserAndModule.mockReset();
    supersedeMany.mockReset();
    createAppeal.mockReset();
    updateSubmissionStatus.mockReset();
    findUserNotificationRecipient.mockReset();
    findAppealForClaim.mockReset();
    markAppealInReview.mockReset();
    findAppealForResolution.mockReset();
    markAppealResolved.mockReset();
    recordAuditEvent.mockReset();
    notifyAppealStatusTransition.mockReset();
    logOperationalEvent.mockReset();
    appendDecisionWithLineage.mockReset();
    vi.mocked(mockPrisma.$transaction).mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(mockPrisma.$transaction).mockImplementation((cb: any) => cb({}));
  });

  it("rejects appeal creation when the submission is missing", async () => {
    findOwnedSubmissionWithLatestDecision.mockResolvedValue(null);

    const { createSubmissionAppeal } = await import("../../src/modules/appeal/appealService.js");

    await expect(
      createSubmissionAppeal({
        submissionId: "submission-1",
        appealedById: "user-1",
        appealReason: "I want this reviewed.",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(createAppeal).not.toHaveBeenCalled();
    expect(updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it("creates an appeal, updates the submission, and tolerates notification failure", async () => {
    findOwnedSubmissionWithLatestDecision.mockResolvedValue({
      id: "submission-1",
      decisions: [{ id: "decision-1" }],
      module: { title: "Test Module" },
    });
    findActiveAppealForSubmission.mockResolvedValue(null);
    createAppeal.mockResolvedValue({
      id: "appeal-1",
      appealStatus: AppealStatus.OPEN,
    });
    updateSubmissionStatus.mockResolvedValue({ id: "submission-1" });
    findUserNotificationRecipient.mockResolvedValue({
      id: "user-1",
      email: "user-1@company.com",
      name: "User One",
    });
    notifyAppealStatusTransition.mockRejectedValue(new Error("webhook failed"));

    const { createSubmissionAppeal } = await import("../../src/modules/appeal/appealService.js");

    const result = await createSubmissionAppeal({
      submissionId: "submission-1",
      appealedById: "user-1",
      appealReason: "I want this reviewed.",
    });

    expect(createAppeal).toHaveBeenCalledWith({
      submissionId: "submission-1",
      appealedById: "user-1",
      appealReason: "I want this reviewed.",
      appealStatus: AppealStatus.OPEN,
    });
    expect(updateSubmissionStatus).toHaveBeenCalledWith("submission-1", SubmissionStatus.UNDER_REVIEW);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "appeal",
        entityId: "appeal-1",
        action: "appeal_created",
      }),
      expect.anything(), // tx client passed for transactional audit
    );
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "participant_notification_pipeline_failed",
      expect.objectContaining({
        appealId: "appeal-1",
        submissionId: "submission-1",
        currentStatus: AppealStatus.OPEN,
        recipientUserId: "user-1",
      }),
      "error",
    );
    expect(result).toEqual({
      id: "appeal-1",
      appealStatus: AppealStatus.OPEN,
    });
  });

  it("wraps appeal creation and submission status update in a single transaction", async () => {
    findOwnedSubmissionWithLatestDecision.mockResolvedValue({
      id: "submission-1",
      decisions: [{ id: "decision-1" }],
      module: { title: "Test Module" },
    });
    findActiveAppealForSubmission.mockResolvedValue(null);
    createAppeal.mockResolvedValue({ id: "appeal-1", appealStatus: AppealStatus.OPEN });
    updateSubmissionStatus.mockResolvedValue({ id: "submission-1" });
    findUserNotificationRecipient.mockResolvedValue(null);

    const { createSubmissionAppeal } = await import("../../src/modules/appeal/appealService.js");

    await createSubmissionAppeal({
      submissionId: "submission-1",
      appealedById: "user-1",
      appealReason: "Appeal reason.",
    });

    // Both writes must occur inside prisma.$transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(createAppeal).toHaveBeenCalledTimes(1);
    expect(updateSubmissionStatus).toHaveBeenCalledTimes(1);
  });

  it("rejects claim when the appeal is already assigned to another handler", async () => {
    findAppealForClaim.mockResolvedValue({
      id: "appeal-1",
      submissionId: "submission-1",
      appealStatus: AppealStatus.IN_REVIEW,
      claimedAt: new Date("2026-03-11T09:00:00.000Z"),
      resolvedById: "handler-2",
      appealedBy: {
        id: "user-1",
        email: "user-1@company.com",
        name: "User One",
      },
    });

    const { claimAppeal } = await import("../../src/modules/appeal/appealService.js");

    await expect(claimAppeal("appeal-1", "handler-1")).rejects.toMatchObject({
      code: "appeal_already_assigned",
    });

    expect(markAppealInReview).not.toHaveBeenCalled();
  });

  it("resolves an appeal by creating a new immutable decision and completing the submission", async () => {
    findAppealForResolution.mockResolvedValue({
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
    });
    appendDecisionWithLineage.mockResolvedValue({
      id: "decision-2",
      passFailTotal: true,
      decisionType: DecisionType.APPEAL_RESOLUTION,
    });
    markAppealResolved.mockResolvedValue({
      id: "appeal-1",
      appealStatus: AppealStatus.RESOLVED,
    });
    notifyAppealStatusTransition.mockResolvedValue(undefined);

    const { resolveAppeal } = await import("../../src/modules/appeal/appealService.js");

    const result = await resolveAppeal({
      appealId: "appeal-1",
      handlerId: "handler-1",
      passFailTotal: true,
      decisionReason: "Appeal accepted.",
      resolutionNote: "Resolved after human review.",
    });

    expect(appendDecisionWithLineage).toHaveBeenCalledWith(
      expect.objectContaining({
        parentDecision: expect.objectContaining({ id: "decision-1", submissionId: "submission-1" }),
        decisionType: DecisionType.APPEAL_RESOLUTION,
        passFailTotal: true,
        decisionReason: "Appeal accepted.",
        finalisedById: "handler-1",
        finalisedAt: expect.any(Date),
        auditAction: "appeal_resolution_decision_created",
      }),
      expect.anything(),
    );
    expect(markAppealResolved).toHaveBeenCalledWith(
      "appeal-1",
      "handler-1",
      expect.any(Date),
      "Resolved after human review.",
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "appeal",
        entityId: "appeal-1",
        action: "appeal_resolved",
      }),
      expect.anything(),
    );
    expect(notifyAppealStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        appealId: "appeal-1",
        submissionId: "submission-1",
        previousStatus: AppealStatus.IN_REVIEW,
        currentStatus: AppealStatus.RESOLVED,
        recipientUserId: "user-1",
      }),
    );
    expect(result).toEqual({
      appeal: {
        id: "appeal-1",
        appealStatus: AppealStatus.RESOLVED,
      },
      resolutionDecision: {
        id: "decision-2",
        passFailTotal: true,
        decisionType: DecisionType.APPEAL_RESOLUTION,
      },
    });
  });

  it("rejects claim when appeal is superseded", async () => {
    findAppealForClaim.mockResolvedValue({
      id: "appeal-1",
      submissionId: "submission-1",
      appealStatus: AppealStatus.SUPERSEDED,
      claimedAt: null,
      resolvedById: null,
      appealedBy: { id: "user-1", email: "user@company.com", name: "User" },
      submission: { module: { title: "Module" } },
    });

    const { claimAppeal } = await import("../../src/modules/appeal/appealService.js");

    await expect(claimAppeal("appeal-1", "handler-1")).rejects.toMatchObject({
      code: "appeal_already_resolved",
    });
    expect(markAppealInReview).not.toHaveBeenCalled();
  });

  it("supersedes open appeals for a user+module", async () => {
    findOpenByUserAndModule.mockResolvedValue([
      { id: "appeal-1", submissionId: "submission-old-1" },
    ]);
    supersedeMany.mockResolvedValue({ count: 1 });
    recordAuditEvent.mockResolvedValue({});

    const { cancelSupersededAppeals } = await import("../../src/modules/appeal/appealService.js");

    const count = await cancelSupersededAppeals("user-1", "module-1", "submission-new");

    expect(count).toBe(1);
    expect(supersedeMany).toHaveBeenCalledWith(["appeal-1"], "submission-new", expect.any(Date));
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "appeal",
      action: "appeal_superseded",
      metadata: expect.objectContaining({ newSubmissionId: "submission-new" }),
    }));
  });

  it("returns 0 when no open appeals exist for the user+module", async () => {
    findOpenByUserAndModule.mockResolvedValue([]);

    const { cancelSupersededAppeals } = await import("../../src/modules/appeal/appealService.js");

    const count = await cancelSupersededAppeals("user-1", "module-1", "submission-new");

    expect(count).toBe(0);
    expect(supersedeMany).not.toHaveBeenCalled();
  });
});
