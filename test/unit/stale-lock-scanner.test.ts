import { beforeEach, describe, expect, it, vi } from "vitest";

const findExpiredRunningJobs = vi.fn();
const resetExpiredJob = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/repositories/assessmentJobRepository.js", () => ({
  assessmentJobRepository: {
    findExpiredRunningJobs,
    resetExpiredJob,
  },
}));

vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));
vi.mock("../../src/observability/operationalLog.js", () => ({ logOperationalEvent }));

describe("stale-lock scanner", () => {
  beforeEach(() => {
    findExpiredRunningJobs.mockReset();
    resetExpiredJob.mockReset().mockResolvedValue(undefined);
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReset();
  });

  it("returns zero counts when no expired jobs are found", async () => {
    findExpiredRunningJobs.mockResolvedValue([]);

    const { scanAndResetStaleJobs } = await import("../../src/services/staleLockScanner.js");

    const result = await scanAndResetStaleJobs();

    expect(result.reset).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.scannedAt).toBeDefined();
    expect(resetExpiredJob).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("resets an expired job to PENDING when attempts are below max", async () => {
    findExpiredRunningJobs.mockResolvedValue([
      { id: "job-1", attempts: 1, maxAttempts: 3, submissionId: "submission-1" },
    ]);

    const { scanAndResetStaleJobs } = await import("../../src/services/staleLockScanner.js");

    const result = await scanAndResetStaleJobs();

    expect(result.reset).toBe(1);
    expect(result.failed).toBe(0);
    expect(resetExpiredJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "PENDING",
        availableAt: expect.any(Date),
        errorMessage: expect.stringContaining("Stale lock"),
      }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_job",
        entityId: "job-1",
        action: "assessment_job_stale_lock_reset",
        metadata: expect.objectContaining({ outcome: "PENDING" }),
      }),
    );
    expect(logOperationalEvent).toHaveBeenCalledWith(
      "assessment_job_stale_lock_detected",
      expect.objectContaining({ jobId: "job-1", outcome: "PENDING" }),
    );
  });

  it("marks an expired job as FAILED when attempts have reached max", async () => {
    findExpiredRunningJobs.mockResolvedValue([
      { id: "job-2", attempts: 3, maxAttempts: 3, submissionId: "submission-2" },
    ]);

    const { scanAndResetStaleJobs } = await import("../../src/services/staleLockScanner.js");

    const result = await scanAndResetStaleJobs();

    expect(result.reset).toBe(0);
    expect(result.failed).toBe(1);
    expect(resetExpiredJob).toHaveBeenCalledWith(
      "job-2",
      expect.objectContaining({ status: "FAILED" }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "assessment_job_stale_lock_failed",
        metadata: expect.objectContaining({ outcome: "FAILED" }),
      }),
    );
  });

  it("processes multiple expired jobs independently and tallies correctly", async () => {
    findExpiredRunningJobs.mockResolvedValue([
      { id: "job-1", attempts: 1, maxAttempts: 3, submissionId: "submission-1" },
      { id: "job-2", attempts: 3, maxAttempts: 3, submissionId: "submission-2" },
      { id: "job-3", attempts: 2, maxAttempts: 3, submissionId: "submission-3" },
    ]);

    const { scanAndResetStaleJobs } = await import("../../src/services/staleLockScanner.js");

    const result = await scanAndResetStaleJobs();

    expect(result.reset).toBe(2);
    expect(result.failed).toBe(1);
    expect(resetExpiredJob).toHaveBeenCalledTimes(3);
  });
});
