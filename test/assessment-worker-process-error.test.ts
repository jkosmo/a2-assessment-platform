import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assessmentJobFindFirst = vi.fn();
const logOperationalEvent = vi.fn();

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    assessmentJob: {
      findFirst: assessmentJobFindFirst,
    },
  },
}));

vi.mock("../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

describe("assessment worker process error handling", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    assessmentJobFindFirst.mockReset();
    logOperationalEvent.mockReset();
    vi.resetModules();
  });

  afterEach(async () => {
    const { stopAssessmentWorker } = await import("../src/services/assessmentJobService.js");
    stopAssessmentWorker();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("records an unhandled rejection when the worker interval tick rejects", async () => {
    const error = new Error("worker tick failed");
    assessmentJobFindFirst.mockRejectedValue(error);

    const { registerProcessErrorHandlers } = await import("../src/process/processErrorHandlers.js");
    const { startAssessmentWorker } = await import("../src/services/assessmentJobService.js");

    const detachHandlers = registerProcessErrorHandlers(vi.fn());

    try {
      startAssessmentWorker();

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
      detachHandlers();
    }
  });
});
