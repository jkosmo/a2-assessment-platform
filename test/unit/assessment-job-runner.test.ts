import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findNextRunnableJob = vi.fn();
const tryLockPendingJob = vi.fn();
const markJobSucceeded = vi.fn();
const markJobForRetryOrFailure = vi.fn();
const findAssessmentJobOrThrow = vi.fn();
const findPendingOrRunningJobForSubmission = vi.fn();
const findPendingOrRunningJobIdForSubmission = vi.fn();
const createAssessmentJob = vi.fn();
const countJobsByStatus = vi.fn();
const recordAuditEvent = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../../src/repositories/assessmentJobRepository.js", () => ({
  assessmentJobRepository: {
    findNextRunnableJob,
    tryLockPendingJob,
    markJobSucceeded,
    markJobForRetryOrFailure,
    findAssessmentJobOrThrow,
    findPendingOrRunningJobForSubmission,
    findPendingOrRunningJobIdForSubmission,
    createAssessmentJob,
    countJobsByStatus,
  },
}));

vi.mock("../../src/services/auditService.js", () => ({
  recordAuditEvent,
}));

vi.mock("../../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("AssessmentJobRunner", () => {
  beforeEach(() => {
    vi.resetModules();
    findNextRunnableJob.mockReset();
    tryLockPendingJob.mockReset();
    markJobSucceeded.mockReset();
    markJobForRetryOrFailure.mockReset();
    findAssessmentJobOrThrow.mockReset();
    findPendingOrRunningJobForSubmission.mockReset();
    findPendingOrRunningJobIdForSubmission.mockReset();
    createAssessmentJob.mockReset();
    countJobsByStatus.mockResolvedValue(0);
    recordAuditEvent.mockResolvedValue(undefined);
    logOperationalEvent.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("processNextJob", () => {
    it("returns false when no runnable job is found", async () => {
      findNextRunnableJob.mockResolvedValue(null);
      const { processNextJob } = await import("../../src/services/AssessmentJobRunner.js");
      const runAssessment = vi.fn();

      const result = await processNextJob(runAssessment);

      expect(result).toBe(false);
      expect(runAssessment).not.toHaveBeenCalled();
    });

    it("returns false when lock cannot be acquired", async () => {
      findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "sub-1" });
      tryLockPendingJob.mockResolvedValue({ count: 0 });
      const { processNextJob } = await import("../../src/services/AssessmentJobRunner.js");
      const runAssessment = vi.fn();

      const result = await processNextJob(runAssessment);

      expect(result).toBe(false);
      expect(runAssessment).not.toHaveBeenCalled();
    });

    it("returns true and marks job succeeded when runAssessment succeeds", async () => {
      findNextRunnableJob.mockResolvedValue({ id: "job-1", submissionId: "sub-1" });
      tryLockPendingJob.mockResolvedValue({ count: 1 });
      markJobSucceeded.mockResolvedValue(undefined);
      const { processNextJob } = await import("../../src/services/AssessmentJobRunner.js");
      const runAssessment = vi.fn().mockResolvedValue(undefined);

      const result = await processNextJob(runAssessment);

      expect(result).toBe(true);
      expect(runAssessment).toHaveBeenCalledWith("job-1");
      expect(markJobSucceeded).toHaveBeenCalledWith("job-1");
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
      markJobForRetryOrFailure.mockResolvedValue(undefined);
      const { processNextJob } = await import("../../src/services/AssessmentJobRunner.js");
      const runAssessment = vi.fn().mockRejectedValue(new Error("LLM timeout"));

      const result = await processNextJob(runAssessment);

      expect(result).toBe(true);
      expect(markJobForRetryOrFailure).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({ status: "PENDING" }),
      );
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "assessment_job_retry_scheduled" }),
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
      markJobForRetryOrFailure.mockResolvedValue(undefined);
      const { processNextJob } = await import("../../src/services/AssessmentJobRunner.js");
      const runAssessment = vi.fn().mockRejectedValue(new Error("Persistent error"));

      await processNextJob(runAssessment);

      expect(markJobForRetryOrFailure).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({ status: "FAILED" }),
      );
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "assessment_job_failed" }),
      );
    });
  });

  describe("enqueueAssessmentJob", () => {
    it("returns existing job when a pending/running job already exists", async () => {
      const existingJob = { id: "job-existing", submissionId: "sub-1" };
      findPendingOrRunningJobForSubmission.mockResolvedValue(existingJob);
      const { enqueueAssessmentJob } = await import("../../src/services/AssessmentJobRunner.js");

      const result = await enqueueAssessmentJob("sub-1");

      expect(result).toBe(existingJob);
      expect(createAssessmentJob).not.toHaveBeenCalled();
    });

    it("creates a new job when no existing job is found", async () => {
      findPendingOrRunningJobForSubmission.mockResolvedValue(null);
      const newJob = { id: "job-new", submissionId: "sub-1" };
      createAssessmentJob.mockResolvedValue(newJob);
      const { enqueueAssessmentJob } = await import("../../src/services/AssessmentJobRunner.js");

      const result = await enqueueAssessmentJob("sub-1");

      expect(result).toBe(newJob);
      expect(createAssessmentJob).toHaveBeenCalledWith(
        expect.objectContaining({ submissionId: "sub-1", status: "PENDING" }),
      );
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "assessment_job_enqueued" }),
      );
    });
  });
});
