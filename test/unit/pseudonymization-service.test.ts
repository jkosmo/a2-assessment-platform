import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const deletionRequestCreate = vi.fn();
const deletionRequestUpdate = vi.fn();
const deletionRequestUpdateMany = vi.fn();
const deletionRequestFindFirst = vi.fn();
const assessmentJobUpdateMany = vi.fn();
const $transaction = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate },
    deletionRequest: {
      create: deletionRequestCreate,
      update: deletionRequestUpdate,
      updateMany: deletionRequestUpdateMany,
      findFirst: deletionRequestFindFirst,
    },
    assessmentJob: { updateMany: assessmentJobUpdateMany },
    $transaction: $transaction,
  },
}));

vi.mock("../../src/db/prismaRuntime.js", () => ({
  DeletionTrigger: {
    USER_REQUEST: "USER_REQUEST",
    OFFBOARDING: "OFFBOARDING",
    INACTIVITY: "INACTIVITY",
  },
}));

const recordAuditEvent = vi.fn();
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));

const logOperationalEvent = vi.fn();
vi.mock("../../src/observability/operationalLog.js", () => ({ logOperationalEvent }));

// ── Helpers ───────────────────────────────────────────────────────────────────

type TxMock = {
  assessmentJob: { updateMany: ReturnType<typeof vi.fn> };
  user: { update: ReturnType<typeof vi.fn> };
  deletionRequest: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
};

/** Simulates $transaction by calling the callback with a tx-like mock */
function mockTransaction(): TxMock {
  const tx: TxMock = {
    assessmentJob: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { update: vi.fn().mockResolvedValue({}) },
    deletionRequest: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  $transaction.mockImplementation(async (callback: (t: TxMock) => Promise<unknown>) => {
    return callback(tx);
  });
  return tx;
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

// ── pseudonymizeUser ──────────────────────────────────────────────────────────

describe("pseudonymizeUser", () => {
  beforeEach(() => {
    recordAuditEvent.mockResolvedValue(undefined);
  });

  it("is a no-op and returns early when user is already anonymised", async () => {
    userFindUnique.mockResolvedValue({ isAnonymized: true });

    const { pseudonymizeUser } = await import("../../src/modules/user/pseudonymizationService.js");
    const result = await pseudonymizeUser("user-1", "USER_REQUEST" as never);

    expect(result.cancelledJobCount).toBe(0);
    expect($transaction).not.toHaveBeenCalled();
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "pseudonymization_skipped",
      expect.objectContaining({ userId: "user-1", reason: "already_pseudonymized" }),
    );
  });

  it("throws when user is not found", async () => {
    userFindUnique.mockResolvedValue(null);

    const { pseudonymizeUser } = await import("../../src/modules/user/pseudonymizationService.js");

    await expect(pseudonymizeUser("missing-user", "USER_REQUEST" as never)).rejects.toThrow("not found");
  });

  it("runs transaction: cancels jobs, updates user, completes deletion request", async () => {
    userFindUnique.mockResolvedValue({ isAnonymized: false });
    const tx = mockTransaction();
    tx.assessmentJob.updateMany.mockResolvedValue({ count: 2 });

    const { pseudonymizeUser } = await import("../../src/modules/user/pseudonymizationService.js");
    const result = await pseudonymizeUser("user-1", "USER_REQUEST" as never, "req-1");

    expect(result.cancelledJobCount).toBe(2);

    // User scrubbed
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          isAnonymized: true,
          email: expect.stringContaining("@deleted.invalid"),
          name: expect.any(String),
        }),
      }),
    );

    // DeletionRequest completed
    expect(tx.deletionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );

    expect(logOperationalEvent).toHaveBeenCalledWith(
      "user_pseudonymized",
      expect.objectContaining({ userId: "user-1", cancelledJobCount: 2 }),
    );
  });

  it("generates a deterministic pseudo-email based on userId", async () => {
    userFindUnique.mockResolvedValue({ isAnonymized: false });
    const tx = mockTransaction();
    tx.assessmentJob.updateMany.mockResolvedValue({ count: 0 });

    const { pseudonymizeUser } = await import("../../src/modules/user/pseudonymizationService.js");
    await pseudonymizeUser("stable-user-id", "USER_REQUEST" as never);

    const updateCall = tx.user.update.mock.calls[0][0];
    const email1 = updateCall.data.email as string;

    // Call again (same userId)
    vi.resetModules();
    vi.clearAllMocks();
    userFindUnique.mockResolvedValue({ isAnonymized: false });
    mockTransaction().assessmentJob.updateMany.mockResolvedValue({ count: 0 });
    recordAuditEvent.mockResolvedValue(undefined);

    const { pseudonymizeUser: pseudonymizeUser2 } = await import("../../src/modules/user/pseudonymizationService.js");
    const tx2 = mockTransaction();
    tx2.assessmentJob.updateMany.mockResolvedValue({ count: 0 });
    await pseudonymizeUser2("stable-user-id", "USER_REQUEST" as never);

    const email2 = tx2.user.update.mock.calls[0][0].data.email as string;
    expect(email1).toBe(email2);
    expect(email1).toMatch(/^pseudo-[0-9a-f]{16}@deleted\.invalid$/);
  });

  it("uses updateMany to complete any pending request when no deletionRequestId given", async () => {
    userFindUnique.mockResolvedValue({ isAnonymized: false });
    const tx = mockTransaction();
    tx.assessmentJob.updateMany.mockResolvedValue({ count: 0 });

    const { pseudonymizeUser } = await import("../../src/modules/user/pseudonymizationService.js");
    await pseudonymizeUser("user-1", "OFFBOARDING" as never); // no deletionRequestId

    expect(tx.deletionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "PENDING" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });
});

// ── requestPseudonymization ───────────────────────────────────────────────────

describe("requestPseudonymization", () => {
  beforeEach(() => {
    recordAuditEvent.mockResolvedValue(undefined);
  });

  it("throws when user is already pseudonymised", async () => {
    userFindUnique.mockResolvedValue({ isAnonymized: true });

    const { requestPseudonymization } = await import("../../src/modules/user/pseudonymizationService.js");

    await expect(
      requestPseudonymization("user-1", { gracePeriodDays: 30, immediate: false }),
    ).rejects.toThrow("already pseudonymised");
  });

  it("throws when a pending request already exists", async () => {
    userFindUnique.mockResolvedValue({ isAnonymized: false });
    deletionRequestFindFirst.mockResolvedValue({ id: "existing-req" });

    const { requestPseudonymization } = await import("../../src/modules/user/pseudonymizationService.js");

    await expect(
      requestPseudonymization("user-1", { gracePeriodDays: 30, immediate: false }),
    ).rejects.toThrow("pending deletion request already exists");
  });

  it("creates a grace-period request and returns PENDING status", async () => {
    userFindUnique.mockResolvedValue({ isAnonymized: false });
    deletionRequestFindFirst.mockResolvedValue(null);
    const fakeEffectiveAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    deletionRequestCreate.mockResolvedValue({ id: "req-1", effectiveAt: fakeEffectiveAt });

    const { requestPseudonymization } = await import("../../src/modules/user/pseudonymizationService.js");
    const result = await requestPseudonymization("user-1", { gracePeriodDays: 30, immediate: false });

    expect(result.status).toBe("PENDING");
    expect(result.effectiveAt).toBeInstanceOf(Date);
    expect(deletionRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1", trigger: "USER_REQUEST" }),
      }),
    );
  });

  it("executes immediately and returns COMPLETED status", async () => {
    userFindUnique
      .mockResolvedValueOnce({ isAnonymized: false }) // requestPseudonymization check
      .mockResolvedValueOnce({ isAnonymized: false }); // pseudonymizeUser check
    deletionRequestFindFirst.mockResolvedValue(null);
    deletionRequestCreate.mockResolvedValue({ id: "req-1" });
    mockTransaction().assessmentJob.updateMany.mockResolvedValue({ count: 0 });

    const { requestPseudonymization } = await import("../../src/modules/user/pseudonymizationService.js");
    const result = await requestPseudonymization("user-1", { gracePeriodDays: 30, immediate: true });

    expect(result.status).toBe("COMPLETED");
    expect(result.effectiveAt).toBeNull();
  });
});

// ── cancelPseudonymizationRequest ────────────────────────────────────────────

describe("cancelPseudonymizationRequest", () => {
  it("throws when no cancellable request exists", async () => {
    deletionRequestFindFirst.mockResolvedValue(null);

    const { cancelPseudonymizationRequest } = await import("../../src/modules/user/pseudonymizationService.js");

    await expect(cancelPseudonymizationRequest("user-1")).rejects.toThrow("No cancellable");
  });

  it("cancels an existing pending USER_REQUEST", async () => {
    deletionRequestFindFirst.mockResolvedValue({ id: "req-1" });
    deletionRequestUpdate.mockResolvedValue({});

    const { cancelPseudonymizationRequest } = await import("../../src/modules/user/pseudonymizationService.js");
    await cancelPseudonymizationRequest("user-1");

    expect(deletionRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1" },
        data: expect.objectContaining({ status: "CANCELLED", cancelledAt: expect.any(Date) }),
      }),
    );
  });
});
