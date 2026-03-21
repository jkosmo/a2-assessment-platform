import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findNextRunnableJob = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../src/repositories/assessmentJobRepository.js", () => ({
  assessmentJobRepository: {
    findNextRunnableJob,
    findExpiredRunningJobs: vi.fn().mockResolvedValue([]),
    resetExpiredJob: vi.fn().mockResolvedValue(undefined),
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

  it("records an unhandled rejection when the worker interval tick rejects", async () => {
    const error = new Error("worker tick failed");
    findNextRunnableJob.mockRejectedValue(error);

    const { registerProcessErrorHandlers } = await import("../src/process/processErrorHandlers.js");
    const { AssessmentWorker } = await import("../src/services/AssessmentWorker.js");

    const detachHandlers = registerProcessErrorHandlers(vi.fn());
    const worker = new AssessmentWorker(10);

    try {
      worker.start();

      await vi.waitFor(() => {
        expect(logOperationalEvent).toHaveBeenCalledWith(
          "unhandled_rejection",
          expect.objectContaining({
            reason: "worker tick failed",
            stack: expect.any(String),
          }),
          "error",
        );
      });
    } finally {
      worker.stop();
      detachHandlers();
    }
  });
});
