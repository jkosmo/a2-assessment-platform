import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";

const findNextRunnableJob = vi.fn();
const tryLockPendingJob = vi.fn();
const markJobSucceeded = vi.fn();
const markJobForRetryOrFailure = vi.fn();
const renewLease = vi.fn();
const findAssessmentJobOrThrow = vi.fn();
const findPendingOrRunningJobForSubmission = vi.fn();
const findPendingOrRunningJobIdForSubmission = vi.fn();
const createAssessmentJob = vi.fn();
const countJobsByStatus = vi.fn();
const findExpiredRunningJobs = vi.fn();
const resetExpiredJob = vi.fn();
const findLongRunningJobs = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/modules/assessment/assessmentJobRepository.js", () => {
  const repo = {
    findNextRunnableJob,
    tryLockPendingJob,
    markJobSucceeded,
    markJobForRetryOrFailure,
    renewLease,
    findAssessmentJobOrThrow,
    findPendingOrRunningJobForSubmission,
    findPendingOrRunningJobIdForSubmission,
    createAssessmentJob,
    countJobsByStatus,
    findExpiredRunningJobs,
    resetExpiredJob,
    findLongRunningJobs,
  };
  // #803: audit writes now run inside runInTransaction via createAssessmentJobRepository(tx). The
  // factory returns the same mock methods so tx-scoped calls hit the same spies.
  return { assessmentJobRepository: repo, createAssessmentJobRepository: () => repo };
});

// #803: run the transaction callback inline with a throwaway tx client.
vi.mock("../../src/db/transaction.js", () => ({
  runInTransaction: (cb: (tx: unknown) => unknown) => cb({}),
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

// #994: modulgrafen leses her, ikke i første test. Se test/support/moduleGraphWarmup.ts.
warmModuleGraph(() => import("../../src/modules/assessment/AssessmentJobRunner.js"));

describe("AssessmentJobRunner", () => {
  beforeEach(() => {
    vi.resetModules();
    findNextRunnableJob.mockReset();
    tryLockPendingJob.mockReset();
    markJobSucceeded.mockReset();
    // #792: terminal writes are now fenced updateMany calls returning { count }. Default to the winning
    // case so the existing behavioural tests exercise the normal (lease-held) path.
    markJobSucceeded.mockResolvedValue({ count: 1 });
    markJobForRetryOrFailure.mockReset();
    markJobForRetryOrFailure.mockResolvedValue({ count: 1 });
    renewLease.mockReset();
    renewLease.mockResolvedValue({ count: 1 });
    findAssessmentJobOrThrow.mockReset();
    findPendingOrRunningJobForSubmission.mockReset();
    findPendingOrRunningJobIdForSubmission.mockReset();
    createAssessmentJob.mockReset();
    countJobsByStatus.mockResolvedValue(0);
    findExpiredRunningJobs.mockResolvedValue([]);
    resetExpiredJob.mockResolvedValue(undefined);
    findLongRunningJobs.mockResolvedValue([]);
    recordAuditEvent.mockResolvedValue(undefined);
    logOperationalEvent.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("processNextJob", () => {
    it("returns false when no runnable job is found", async () => {
      findNextRunnableJob.mockResolvedValue(null);
      const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
      const runAssessment = vi.fn();

      const result = await processNextJob(runAssessment);

      expect(result).toBe(false);
      expect(runAssessment).not.toHaveBeenCalled();
    });

    it("returns false when lock cannot be acquired", async () => {
      findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "sub-1" });
      tryLockPendingJob.mockResolvedValue({ count: 0 });
      const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
      const runAssessment = vi.fn();

      const result = await processNextJob(runAssessment);

      expect(result).toBe(false);
      expect(runAssessment).not.toHaveBeenCalled();
    });

    it("returns true and marks job succeeded when runAssessment succeeds", async () => {
      findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "sub-1" });
      tryLockPendingJob.mockResolvedValue({ count: 1 });
      markJobSucceeded.mockResolvedValue({ count: 1 });
      const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
      const runAssessment = vi.fn().mockResolvedValue(undefined);

      const result = await processNextJob(runAssessment);

      expect(result).toBe(true);
      expect(runAssessment).toHaveBeenCalledWith("job-1");
      // #792: fenced terminal write — job id + the lock owner + the lock timestamp.
      expect(markJobSucceeded).toHaveBeenCalledWith("job-1", expect.any(String), expect.any(Date));
    });

    it("schedules retry when runAssessment fails and attempts < maxAttempts", async () => {
      findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "sub-1" });
      tryLockPendingJob.mockResolvedValue({ count: 1 });
      findAssessmentJobOrThrow.mockResolvedValue({
        id: "job-1",
        attempts: 1,
        maxAttempts: 3,
        availableAt: new Date(),
      });
      markJobForRetryOrFailure.mockResolvedValue({ count: 1 });
      const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
      const runAssessment = vi.fn().mockRejectedValue(new Error("LLM timeout"));

      const result = await processNextJob(runAssessment);

      expect(result).toBe(true);
      expect(markJobForRetryOrFailure).toHaveBeenCalledWith(
        "job-1",
        expect.any(String),
        expect.any(Date),
        expect.objectContaining({ status: "PENDING" }),
      );
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "assessment_job_retry_scheduled" }),
        expect.anything(),
      );
    });

    it("marks job as FAILED when attempts >= maxAttempts", async () => {
      findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "sub-1" });
      tryLockPendingJob.mockResolvedValue({ count: 1 });
      findAssessmentJobOrThrow.mockResolvedValue({
        id: "job-1",
        attempts: 3,
        maxAttempts: 3,
        availableAt: new Date(),
      });
      markJobForRetryOrFailure.mockResolvedValue({ count: 1 });
      const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
      const runAssessment = vi.fn().mockRejectedValue(new Error("Persistent error"));

      await processNextJob(runAssessment);

      expect(markJobForRetryOrFailure).toHaveBeenCalledWith(
        "job-1",
        expect.any(String),
        expect.any(Date),
        expect.objectContaining({ status: "FAILED" }),
      );
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "assessment_job_failed" }),
        expect.anything(),
      );
    });

    // #856: a job whose runAssessment never returns within the runtime cap must NOT wedge the worker —
    // the deadline fires, the tick takes the (fenced) failure path, and processNextJob returns.
    it("fails a job that exceeds the runtime deadline instead of running forever", async () => {
      const prev = process.env.ASSESSMENT_JOB_MAX_RUNTIME_MS;
      process.env.ASSESSMENT_JOB_MAX_RUNTIME_MS = "30"; // 30ms deadline for the test
      try {
        vi.resetModules(); // re-read env so the tiny deadline takes effect
        findNextRunnableJob.mockResolvedValue({ id: "job-slow", submissionId: "sub-slow" });
        tryLockPendingJob.mockResolvedValue({ count: 1 });
        findAssessmentJobOrThrow.mockResolvedValue({ id: "job-slow", attempts: 0, maxAttempts: 3, availableAt: new Date() });
        markJobForRetryOrFailure.mockResolvedValue({ count: 1 });

        const { processNextJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");
        // runAssessment that never settles — only the deadline can end the tick.
        const runAssessment = vi.fn(() => new Promise<void>(() => {}));

        const result = await processNextJob(runAssessment);

        expect(result).toBe(true);
        // Deadline → failure path: retry scheduled (attempts 0 < max 3), never marked succeeded.
        expect(markJobForRetryOrFailure).toHaveBeenCalledWith(
          "job-slow",
          expect.any(String),
          expect.any(Date),
          expect.objectContaining({ status: "PENDING" }),
        );
        expect(markJobSucceeded).not.toHaveBeenCalled();
      } finally {
        if (prev === undefined) delete process.env.ASSESSMENT_JOB_MAX_RUNTIME_MS;
        else process.env.ASSESSMENT_JOB_MAX_RUNTIME_MS = prev;
      }
    });
  });

  describe("enqueueAssessmentJob", () => {
    it("returns existing job when a pending/running job already exists", async () => {
      const existingJob = { id: "job-existing", submissionId: "sub-1" };
      findPendingOrRunningJobForSubmission.mockResolvedValue(existingJob);
      const { enqueueAssessmentJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");

      const result = await enqueueAssessmentJob("sub-1");

      expect(result).toBe(existingJob);
      expect(createAssessmentJob).not.toHaveBeenCalled();
    });

    it("creates a new job when no existing job is found", async () => {
      findPendingOrRunningJobForSubmission.mockResolvedValue(null);
      const newJob = { id: "job-new", submissionId: "sub-1" };
      createAssessmentJob.mockResolvedValue(newJob);
      const { enqueueAssessmentJob } = await import("../../src/modules/assessment/AssessmentJobRunner.js");

      const result = await enqueueAssessmentJob("sub-1");

      expect(result).toBe(newJob);
      expect(createAssessmentJob).toHaveBeenCalledWith(
        expect.objectContaining({ submissionId: "sub-1", status: "PENDING" }),
      );
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "assessment_job_enqueued" }),
        expect.anything(),
      );
    });
  });
});
