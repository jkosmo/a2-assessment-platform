import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const deletionRequestFindMany = vi.fn();
const deletionRequestCreate = vi.fn();
const userFindMany = vi.fn();

vi.mock("../../src/db/prisma.js", () => ({
  prisma: {
    deletionRequest: {
      findMany: deletionRequestFindMany,
      create: deletionRequestCreate,
    },
    user: { findMany: userFindMany },
  },
}));

vi.mock("../../src/db/prismaRuntime.js", () => ({
  DeletionTrigger: {
    USER_REQUEST: "USER_REQUEST",
    OFFBOARDING: "OFFBOARDING",
    INACTIVITY: "INACTIVITY",
  },
}));

const pseudonymizeUser = vi.fn();
vi.mock("../../src/modules/user/pseudonymizationService.js", () => ({ pseudonymizeUser }));

const logOperationalEvent = vi.fn();
vi.mock("../../src/observability/operationalLog.js", () => ({ logOperationalEvent }));

vi.mock("../../src/config/retention.js", () => ({
  OFFBOARDING_GRACE_PERIOD_DAYS: 90,
  INACTIVITY_RETENTION_DAYS: 730,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("pseudonymization scanner", () => {
  beforeEach(() => {
    deletionRequestFindMany.mockReset().mockResolvedValue([]);
    deletionRequestCreate.mockReset().mockResolvedValue({ id: "req-auto" });
    userFindMany.mockReset().mockResolvedValue([]);
    pseudonymizeUser.mockReset().mockResolvedValue({ userId: "u", cancelledJobCount: 0 });
    logOperationalEvent.mockReset();
  });

  it("returns zero counts when nothing is due", async () => {
    const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
    const result = await runPseudonymizationScan();

    expect(result.gracePeriodExecuted).toBe(0);
    expect(result.offboardingExecuted).toBe(0);
    expect(result.inactivityExecuted).toBe(0);
    expect(result.errors).toBe(0);
    expect(pseudonymizeUser).not.toHaveBeenCalled();
    expect(logOperationalEvent).not.toHaveBeenCalled(); // no log when nothing happened
  });

  describe("phase 1 — grace-period requests", () => {
    it("executes pseudonymization for each due deletion request", async () => {
      deletionRequestFindMany.mockResolvedValue([
        { id: "req-1", userId: "user-1", trigger: "USER_REQUEST" },
        { id: "req-2", userId: "user-2", trigger: "USER_REQUEST" },
      ]);

      const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
      const result = await runPseudonymizationScan();

      expect(result.gracePeriodExecuted).toBe(2);
      expect(pseudonymizeUser).toHaveBeenCalledWith("user-1", "USER_REQUEST", "req-1");
      expect(pseudonymizeUser).toHaveBeenCalledWith("user-2", "USER_REQUEST", "req-2");
    });

    it("increments errors and logs on failure, continues with remaining requests", async () => {
      deletionRequestFindMany.mockResolvedValue([
        { id: "req-fail", userId: "user-fail", trigger: "USER_REQUEST" },
        { id: "req-ok", userId: "user-ok", trigger: "USER_REQUEST" },
      ]);
      pseudonymizeUser
        .mockRejectedValueOnce(new Error("db timeout"))
        .mockResolvedValueOnce({ userId: "user-ok", cancelledJobCount: 0 });

      const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
      const result = await runPseudonymizationScan();

      expect(result.gracePeriodExecuted).toBe(1);
      expect(result.errors).toBe(1);
      expect(logOperationalEvent).toHaveBeenCalledWith(
        "pseudonymization_scan_error",
        expect.objectContaining({ phase: "grace_period", userId: "user-fail" }),
        "error",
      );
    });
  });

  describe("phase 2 — offboarding trigger", () => {
    it("creates a deletion request and pseudonymises offboarded users", async () => {
      userFindMany
        .mockResolvedValueOnce([{ id: "offboarded-1" }]) // offboarding query
        .mockResolvedValueOnce([]); // inactivity query

      const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
      const result = await runPseudonymizationScan();

      expect(result.offboardingExecuted).toBe(1);
      expect(deletionRequestCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "offboarded-1", trigger: "OFFBOARDING" }),
        }),
      );
      expect(pseudonymizeUser).toHaveBeenCalledWith("offboarded-1", "OFFBOARDING", "req-auto");
    });

    it("increments errors on offboarding failure", async () => {
      userFindMany
        .mockResolvedValueOnce([{ id: "user-fail" }])
        .mockResolvedValueOnce([]);
      pseudonymizeUser.mockRejectedValueOnce(new Error("transient"));

      const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
      const result = await runPseudonymizationScan();

      expect(result.offboardingExecuted).toBe(0);
      expect(result.errors).toBe(1);
      expect(logOperationalEvent).toHaveBeenCalledWith(
        "pseudonymization_scan_error",
        expect.objectContaining({ phase: "offboarding", userId: "user-fail" }),
        "error",
      );
    });
  });

  describe("phase 3 — inactivity backstop", () => {
    it("creates a deletion request and pseudonymises inactive users", async () => {
      userFindMany
        .mockResolvedValueOnce([]) // offboarding query returns empty
        .mockResolvedValueOnce([{ id: "inactive-1" }]); // inactivity query

      const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
      const result = await runPseudonymizationScan();

      expect(result.inactivityExecuted).toBe(1);
      expect(deletionRequestCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "inactive-1", trigger: "INACTIVITY" }),
        }),
      );
    });

    it("increments errors on inactivity failure", async () => {
      userFindMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "user-inactive-fail" }]);
      pseudonymizeUser.mockRejectedValueOnce(new Error("failed"));

      const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
      const result = await runPseudonymizationScan();

      expect(result.inactivityExecuted).toBe(0);
      expect(result.errors).toBe(1);
      expect(logOperationalEvent).toHaveBeenCalledWith(
        "pseudonymization_scan_error",
        expect.objectContaining({ phase: "inactivity" }),
        "error",
      );
    });
  });

  it("logs scan_completed only when at least one action occurred", async () => {
    deletionRequestFindMany.mockResolvedValue([{ id: "req-1", userId: "u-1", trigger: "USER_REQUEST" }]);

    const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
    await runPseudonymizationScan();

    expect(logOperationalEvent).toHaveBeenCalledWith(
      "pseudonymization_scan_completed",
      expect.objectContaining({ gracePeriodExecuted: 1, ranAt: expect.any(String) }),
    );
  });

  it("does not log scan_completed when nothing was processed", async () => {
    const { runPseudonymizationScan } = await import("../../src/modules/user/pseudonymizationScanner.js");
    await runPseudonymizationScan();

    expect(logOperationalEvent).not.toHaveBeenCalledWith("pseudonymization_scan_completed", expect.anything());
  });
});
