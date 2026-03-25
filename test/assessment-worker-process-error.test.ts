import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findNextRunnableJob = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../src/modules/assessment/assessmentJobRepository.js", () => ({
  assessmentJobRepository: {
    findNextRunnableJob,
    findExpiredRunningJobs: vi.fn().mockResolvedValue([]),
    resetExpiredJob: vi.fn().mockResolvedValue(undefined),
    findLongRunningJobs: vi.fn().mockResolvedValue([]),
    countJobsByStatus: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("assessment worker process error handling", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    findNextRunnableJob.mockReset();
    logOperationalEvent.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("swallows errors from tick so void-fired ticks do not become unhandled rejections", async () => {
    // tick() catches all errors internally — processErrorHandlers should NOT be triggered.
    // Previously this test verified the unhandledRejection path, but tick() now has an
    // explicit catch block so the error is swallowed silently. The job runner handles
    // logging and retry logic itself before the error reaches tick().
    const error = new Error("worker tick failed");
    findNextRunnableJob.mockRejectedValue(error);

    const { registerProcessErrorHandlers } = await import("../src/process/processErrorHandlers.js");
    const { AssessmentWorker } = await import("../src/modules/assessment/AssessmentWorker.js");

    const detachHandlers = registerProcessErrorHandlers(vi.fn());
    const worker = new AssessmentWorker(10);

    try {
      worker.start();

      // Wait long enough for at least one tick to fire and complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // unhandled_rejection must NOT have been logged — tick() suppresses it
      expect(logOperationalEvent).not.toHaveBeenCalledWith(
        "unhandled_rejection",
        expect.anything(),
        expect.anything(),
      );
    } finally {
      worker.stop();
      detachHandlers();
    }
  });
});
