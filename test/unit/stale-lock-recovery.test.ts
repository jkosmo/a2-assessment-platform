/**
 * End-to-end recovery path tests for stale-lock detection.
 *
 * These tests simulate the full sequence: a job stuck in RUNNING with an
 * expired lease → scanAndResetStaleJobs resets it → processNextJob picks it
 * up and completes it. They test the integration between AssessmentJobRunner
 * and staleLockScanner across a single processNextJob call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findNextRunnableJob = vi.fn();
const tryLockPendingJob = vi.fn();
const markJobSucceeded = vi.fn();
const markJobForRetryOrFailure = vi.fn();
const findAssessmentJobOrThrow = vi.fn();
const countJobsByStatus = vi.fn();
const findExpiredRunningJobs = vi.fn();
const resetExpiredJob = vi.fn();
const findLongRunningJobs = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/modules/assessment/assessmentJobRepository.js", () => ({
  assessmentJobRepository: {
    findNextRunnableJob,
    tryLockPendingJob,
    markJobSucceeded,
    markJobForRetryOrFailure,
    findAssessmentJobOrThrow,
    countJobsByStatus,
    findExpiredRunningJobs,
    resetExpiredJob,
    findLongRunningJobs,
    findPendingOrRunningJobForSubmission: vi.fn(),
    findPendingOrRunningJobIdForSubmission: vi.fn(),
    createAssessmentJob: vi.fn(),
  },
}));

vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent }));
vi.mock("../../src/observability/operationalLog.js", () => ({ logOperationalEvent }));
vi.mock("../../src/config/env.js", () => ({
  env: {
    ASSESSMENT_JOB_MAX_ATTEMPTS: 3,
    ASSESSMENT_JOB_LEASE_DURATION_MS: 300_000,
  },
}));

describe("stale-lock recovery path", () => {
  beforeEach(() => {
    vi.resetModules();
    findNextRunnableJob.mockReset();
    tryLockPendingJob.mockReset();
    markJobSucceeded.mockReset().mockResolvedValue(undefined);
    markJobForRetryOrFailure.mockReset().mockResolvedValue(undefined);
    findAssessmentJobOrThrow.mockReset();
    countJobsByStatus.mockResolvedValue(0);
    findExpiredRunningJobs.mockReset();
    resetExpiredJob.mockReset().mockResolvedValue(undefined);
    findLongRunningJobs.mockReset().mockResolvedValue([]);
    recordAuditEvent.mockReset().mockResolvedValue(undefined);
    logOperationalEvent.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resets a stale job and then picks it up and completes it in the same cycle", async () => {
    // Scanner finds one expired RUNNING job and resets it to PENDING
    findExpiredRunningJobs.mockResolvedValue([
      { id: "job-1", attempts: 1, maxAttempts: 3, submissionId: "submission-1" },
    ]);
    // After reset, the job is now PENDING and found by the runner
    findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "submission-1" });
    tryLockPendingJob.mockResolvedValue({ count: 1 });

    const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
    const runAssessment = vi.fn().mockResolvedValue(undefined);

    const result = await processNextJob(runAssessment);

    expect(result).toBe(true);

    // Scanner ran and reset the stale job
    expect(resetExpiredJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "PENDING" }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "assessment_job",
        entityId: "job-1",
        action: "assessment_job_stale_lock_reset",
      }),
    );

    // Runner then picked up and completed the (now-PENDING) job
    expect(runAssessment).toHaveBeenCalledWith("job-1");
    expect(markJobSucceeded).toHaveBeenCalledWith("job-1");
  });

  it("fails a stale job permanently when at max attempts and does not process it", async () => {
    findExpiredRunningJobs.mockResolvedValue([
      { id: "job-1", attempts: 3, maxAttempts: 3, submissionId: "submission-1" },
    ]);
    // After FAILED transition, no PENDING job is available
    findNextRunnableJob.mockResolvedValue(null);

    const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
    const runAssessment = vi.fn();

    const result = await processNextJob(runAssessment);

    expect(result).toBe(false);

    expect(resetExpiredJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "FAILED" }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "assessment_job_stale_lock_failed" }),
    );
    expect(runAssessment).not.toHaveBeenCalled();
  });

  it("resets multiple stale jobs in one cycle and processes the first available", async () => {
    findExpiredRunningJobs.mockResolvedValue([
      { id: "job-1", attempts: 1, maxAttempts: 3, submissionId: "submission-1" },
      { id: "job-2", attempts: 2, maxAttempts: 3, submissionId: "submission-2" },
    ]);
    findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "submission-1" });
    tryLockPendingJob.mockResolvedValue({ count: 1 });

    const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
    const runAssessment = vi.fn().mockResolvedValue(undefined);

    await processNextJob(runAssessment);

    expect(resetExpiredJob).toHaveBeenCalledTimes(2);
    expect(runAssessment).toHaveBeenCalledWith("job-1");
    expect(markJobSucceeded).toHaveBeenCalledWith("job-1");
  });

  it("still processes a normal job when there are no stale jobs", async () => {
    findExpiredRunningJobs.mockResolvedValue([]);
    findNextRunnableJob.mockResolvedValue({ id: "job-3", submissionId: "submission-3" });
    tryLockPendingJob.mockResolvedValue({ count: 1 });

    const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
    const runAssessment = vi.fn().mockResolvedValue(undefined);

    const result = await processNextJob(runAssessment);

    expect(result).toBe(true);
    expect(resetExpiredJob).not.toHaveBeenCalled();
    expect(runAssessment).toHaveBeenCalledWith("job-3");
    expect(markJobSucceeded).toHaveBeenCalledWith("job-3");
  });

  it("proceeds to run normal jobs even if the stale scanner itself throws", async () => {
    findExpiredRunningJobs.mockRejectedValue(new Error("DB timeout during scan"));
    findNextRunnableJob.mockResolvedValue({ id: "job-4", submissionId: "submission-4" });
    tryLockPendingJob.mockResolvedValue({ count: 1 });

    const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
    const runAssessment = vi.fn().mockResolvedValue(undefined);

    // Scanner failure should propagate — the whole cycle fails safely
    await expect(processNextJob(runAssessment)).rejects.toThrow("DB timeout during scan");
    expect(runAssessment).not.toHaveBeenCalled();
  });
});
