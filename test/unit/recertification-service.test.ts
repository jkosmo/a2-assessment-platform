import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../../src/errors/AppError.js";

const findDecisionWithSubmissionIdentifiers = vi.fn();
const upsertCertificationStatus = vi.fn();
const findByUserAndModule = vi.fn();
const findCertificationsForReminderSchedule = vi.fn();
const findAuditEventMetadataByEntityAndAction = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  env: {
    PARTICIPANT_NOTIFICATION_CHANNEL: "log",
    PARTICIPANT_NOTIFICATION_WEBHOOK_URL: undefined,
    PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS: 5000,
  },
}));

vi.mock("../../src/config/assessmentRules.js", () => ({
  getAssessmentRules: () => ({
    recertification: {
      validityDays: 365,
      dueOffsetDays: 30,
      dueSoonDays: 14,
      reminderDaysBefore: [30, 7],
    },
  }),
}));

vi.mock("../../src/repositories/decisionRepository.js", () => ({
  decisionRepository: {
    findDecisionWithSubmissionIdentifiers,
  },
}));

vi.mock("../../src/repositories/certificationRepository.js", () => ({
  certificationRepository: {
    upsertCertificationStatus,
    findByUserAndModule,
    findCertificationsForReminderSchedule,
  },
}));

vi.mock("../../src/repositories/auditRepository.js", () => ({
  auditRepository: {
    findAuditEventMetadataByEntityAndAction,
  },
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("recertification service", () => {
  beforeEach(() => {
    findDecisionWithSubmissionIdentifiers.mockReset();
    upsertCertificationStatus.mockReset();
    findByUserAndModule.mockReset();
    findCertificationsForReminderSchedule.mockReset();
    findAuditEventMetadataByEntityAndAction.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
  });

  it("rejects recertification upsert when the decision does not exist", async () => {
    findDecisionWithSubmissionIdentifiers.mockResolvedValue(null);

    const { upsertRecertificationStatusFromDecision } = await import("../../src/services/recertificationService.js");

    await expect(
      upsertRecertificationStatusFromDecision({
        decisionId: "decision-1",
        actorId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("upserts active recertification state from a passing decision", async () => {
    findDecisionWithSubmissionIdentifiers.mockResolvedValue({
      id: "decision-1",
      passFailTotal: true,
      finalisedAt: new Date("2026-03-11T00:00:00.000Z"),
      submission: {
        userId: "user-1",
        moduleId: "module-1",
        submittedAt: new Date("2026-03-11T00:00:00.000Z"),
      },
    });
    upsertCertificationStatus.mockResolvedValue({
      id: "cert-1",
      status: "ACTIVE",
    });

    const { upsertRecertificationStatusFromDecision } = await import("../../src/services/recertificationService.js");

    const result = await upsertRecertificationStatusFromDecision({
      decisionId: "decision-1",
      actorId: "admin-1",
    });

    expect(upsertCertificationStatus).toHaveBeenCalledWith({
      userId: "user-1",
      moduleId: "module-1",
      latestDecisionId: "decision-1",
      status: "ACTIVE",
      passedAt: new Date("2026-03-11T00:00:00.000Z"),
      expiryDate: new Date("2027-03-11T00:00:00.000Z"),
      recertificationDueDate: new Date("2027-02-09T00:00:00.000Z"),
    });
    expect(recordAuditEvent).toHaveBeenCalledWith({
      entityType: "certification_status",
      entityId: "cert-1",
      action: "recertification_status_upserted",
      actorId: "admin-1",
      metadata: {
        userId: "user-1",
        moduleId: "module-1",
        decisionId: "decision-1",
        status: "ACTIVE",
        passedAt: "2026-03-11T00:00:00.000Z",
        expiryDate: "2027-03-11T00:00:00.000Z",
        recertificationDueDate: "2027-02-09T00:00:00.000Z",
      },
    }, undefined);
    expect(result).toEqual({
      id: "cert-1",
      status: "ACTIVE",
    });
  });

  it("derives due-soon state before recertification due date", async () => {
    const { deriveRecertificationStatus } = await import("../../src/services/recertificationService.js");

    const status = deriveRecertificationStatus({
      now: new Date("2027-02-01T00:00:00.000Z"),
      recertificationDueDate: new Date("2027-02-09T00:00:00.000Z"),
      expiryDate: new Date("2027-03-11T00:00:00.000Z"),
      dueSoonDays: 14,
    });

    expect(status).toBe("DUE_SOON");
  });

  it("upserts NOT_CERTIFIED from a failing decision when no prior certification exists", async () => {
    findDecisionWithSubmissionIdentifiers.mockResolvedValue({
      id: "decision-fail",
      passFailTotal: false,
      finalisedAt: new Date("2026-03-11T00:00:00.000Z"),
      submission: {
        userId: "user-1",
        moduleId: "module-1",
        submittedAt: new Date("2026-03-10T00:00:00.000Z"),
      },
    });
    findByUserAndModule.mockResolvedValue(null);
    upsertCertificationStatus.mockResolvedValue({ id: "cert-1", status: "NOT_CERTIFIED" });

    const { upsertRecertificationStatusFromDecision } = await import("../../src/services/recertificationService.js");

    await upsertRecertificationStatusFromDecision({ decisionId: "decision-fail", actorId: "admin-1" });

    expect(upsertCertificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "NOT_CERTIFIED" }),
    );
  });

  it("skips downgrade when a failing decision is from an older submission than the existing passing cert", async () => {
    // Scenario: submission #1 (submitted T1) → manual review → resolves FAIL at T3
    //           submission #2 (submitted T2 > T1) → auto-pass → passedAt = T2
    //           Result: upserting FAIL from #1 must NOT downgrade the cert from #2
    const passingCert = {
      id: "cert-1",
      status: "ACTIVE",
      passedAt: new Date("2026-03-15T00:00:00.000Z"), // T2: established by submission #2
      expiryDate: new Date("2027-03-15T00:00:00.000Z"),
      recertificationDueDate: new Date("2027-02-13T00:00:00.000Z"),
    };
    findDecisionWithSubmissionIdentifiers.mockResolvedValue({
      id: "decision-fail",
      passFailTotal: false,
      finalisedAt: new Date("2026-03-20T00:00:00.000Z"),
      submission: {
        userId: "user-1",
        moduleId: "module-1",
        submittedAt: new Date("2026-03-10T00:00:00.000Z"), // T1: older submission
      },
    });
    findByUserAndModule.mockResolvedValue(passingCert);

    const { upsertRecertificationStatusFromDecision } = await import("../../src/services/recertificationService.js");

    const result = await upsertRecertificationStatusFromDecision({ decisionId: "decision-fail", actorId: "admin-1" });

    expect(upsertCertificationStatus).not.toHaveBeenCalled();
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "recertification_downgrade_skipped",
      expect.objectContaining({
        userId: "user-1",
        moduleId: "module-1",
        decisionId: "decision-fail",
      }),
    );
    expect(result).toEqual(passingCert);
  });

  it("applies NOT_CERTIFIED when a failing decision is newer than any existing cert's passedAt", async () => {
    findDecisionWithSubmissionIdentifiers.mockResolvedValue({
      id: "decision-fail",
      passFailTotal: false,
      finalisedAt: new Date("2026-03-20T00:00:00.000Z"),
      submission: {
        userId: "user-1",
        moduleId: "module-1",
        submittedAt: new Date("2026-03-18T00:00:00.000Z"), // newer than existing passedAt
      },
    });
    findByUserAndModule.mockResolvedValue({
      id: "cert-1",
      status: "ACTIVE",
      passedAt: new Date("2026-03-10T00:00:00.000Z"), // older passing cert
    });
    upsertCertificationStatus.mockResolvedValue({ id: "cert-1", status: "NOT_CERTIFIED" });

    const { upsertRecertificationStatusFromDecision } = await import("../../src/services/recertificationService.js");

    await upsertRecertificationStatusFromDecision({ decisionId: "decision-fail", actorId: "admin-1" });

    expect(upsertCertificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "NOT_CERTIFIED" }),
    );
    expect(logOperationalEvent).not.toHaveBeenCalledWith("recertification_downgrade_skipped", expect.anything());
  });

  it("runs reminder scheduling with log delivery and duplicate-send protection", async () => {
    findCertificationsForReminderSchedule.mockResolvedValue([
      {
        id: "cert-1",
        expiryDate: new Date("2026-03-31T00:00:00.000Z"),
        user: { id: "user-1", email: "user-1@company.com", name: "User One" },
        module: { id: "module-1", title: "Module One" },
      },
      {
        id: "cert-2",
        expiryDate: new Date("2026-03-31T00:00:00.000Z"),
        user: { id: "user-2", email: "user-2@company.com", name: "User Two" },
        module: { id: "module-2", title: "Module Two" },
      },
      {
        id: "cert-3",
        expiryDate: new Date("2026-04-15T00:00:00.000Z"),
        user: { id: "user-3", email: "user-3@company.com", name: "User Three" },
        module: { id: "module-3", title: "Module Three" },
      },
      {
        id: "cert-4",
        expiryDate: null,
        user: { id: "user-4", email: "user-4@company.com", name: "User Four" },
        module: { id: "module-4", title: "Module Four" },
      },
    ]);
    findAuditEventMetadataByEntityAndAction
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          metadataJson: '{"reminderDaysBefore":30,"asOfDate":"2026-03-01"}',
        },
      ]);

    const { runRecertificationReminderSchedule } = await import("../../src/services/recertificationService.js");

    const result = await runRecertificationReminderSchedule({
      asOf: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(result).toEqual({
      asOf: "2026-03-01T00:00:00.000Z",
      processed: 1,
      sent: 1,
      failed: 0,
      skippedAlreadySent: 1,
      skippedNoTrigger: 2,
    });
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "recertification_reminder_sent",
      expect.objectContaining({
        certificationId: "cert-1",
        userId: "user-1",
        recipientEmail: "user-1@company.com",
        reminderDaysBefore: 30,
        channel: "log",
      }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "certification_status",
        entityId: "cert-1",
        action: "recertification_reminder_sent",
      }),
    );
  });
});
