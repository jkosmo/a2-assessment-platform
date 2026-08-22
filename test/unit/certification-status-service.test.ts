import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../../src/errors/AppError.js";

// #989: het `recertification-service.test.ts`. Testene for utløpsdatoer, DUE_SOON-utledning og
// påminnelsesplanen er borte sammen med mekanismen. Det som står igjen er det som faktisk avgjorde
// noe: ACTIVE/NOT_CERTIFIED, `passedAt`, og vakta mot nedgradering fra en eldre innlevering.

const findDecisionWithSubmissionIdentifiers = vi.fn();
const upsertCertificationStatus = vi.fn();
const findByUserAndModule = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/repositories/decisionRepository.js", () => ({
  decisionRepository: {
    findDecisionWithSubmissionIdentifiers,
  },
}));

vi.mock("../../src/modules/certification/certificationRepository.js", () => ({
  certificationRepository: {
    upsertCertificationStatus,
    findByUserAndModule,
  },
  createCertificationRepository: () => ({
    upsertCertificationStatus,
    findByUserAndModule,
  }),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("certification status service", () => {
  beforeEach(() => {
    findDecisionWithSubmissionIdentifiers.mockReset();
    upsertCertificationStatus.mockReset();
    findByUserAndModule.mockReset();
    recordAuditEvent.mockReset();
    logOperationalEvent.mockReset();
  });

  it("rejects the upsert when the decision does not exist", async () => {
    findDecisionWithSubmissionIdentifiers.mockResolvedValue(null);

    const { upsertCertificationStatusFromDecision } = await import("../../src/modules/certification/index.js");

    await expect(
      upsertCertificationStatusFromDecision({
        decisionId: "decision-1",
        actorId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("writes ACTIVE with passedAt — and no expiry fields — from a passing decision", async () => {
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

    const { upsertCertificationStatusFromDecision } = await import("../../src/modules/certification/index.js");

    const result = await upsertCertificationStatusFromDecision({
      decisionId: "decision-1",
      actorId: "admin-1",
    });

    // toHaveBeenCalledWith er eksakt: står expiryDate/recertificationDueDate igjen, blir denne rød.
    expect(upsertCertificationStatus).toHaveBeenCalledWith({
      userId: "user-1",
      moduleId: "module-1",
      latestDecisionId: "decision-1",
      status: "ACTIVE",
      passedAt: new Date("2026-03-11T00:00:00.000Z"),
    });
    // Handlingsnavnet er en persistert verdi og beholder sitt historiske navn (#989).
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
      },
    }, undefined);
    expect(result).toEqual({
      id: "cert-1",
      status: "ACTIVE",
    });
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

    const { upsertCertificationStatusFromDecision } = await import("../../src/modules/certification/index.js");

    await upsertCertificationStatusFromDecision({ decisionId: "decision-fail", actorId: "admin-1" });

    expect(upsertCertificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "NOT_CERTIFIED", passedAt: null }),
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

    const { upsertCertificationStatusFromDecision } = await import("../../src/modules/certification/index.js");

    const result = await upsertCertificationStatusFromDecision({ decisionId: "decision-fail", actorId: "admin-1" });

    expect(upsertCertificationStatus).not.toHaveBeenCalled();
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "certification_downgrade_skipped",
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

    const { upsertCertificationStatusFromDecision } = await import("../../src/modules/certification/index.js");

    await upsertCertificationStatusFromDecision({ decisionId: "decision-fail", actorId: "admin-1" });

    expect(upsertCertificationStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "NOT_CERTIFIED" }),
    );
    expect(logOperationalEvent).not.toHaveBeenCalledWith("certification_downgrade_skipped", expect.anything());
  });

  it("eksporterer ingen resertifiserings-API lenger (#989)", async () => {
    const certification = await import("../../src/modules/certification/index.js");

    expect(certification).not.toHaveProperty("deriveRecertificationStatus");
    expect(certification).not.toHaveProperty("runRecertificationReminderSchedule");
    expect(certification).not.toHaveProperty("upsertRecertificationStatusFromDecision");
  });
});
