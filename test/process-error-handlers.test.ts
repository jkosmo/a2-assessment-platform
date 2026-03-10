import { afterEach, describe, expect, it, vi } from "vitest";

const logOperationalEvent = vi.fn();

vi.mock("../src/observability/operationalLog.js", () => ({
  logOperationalEvent,
}));

afterEach(() => {
  logOperationalEvent.mockReset();
});

describe("process error handlers", () => {
  it("logs unhandled rejections with structured metadata", async () => {
    const { logUnhandledRejection } = await import("../src/process/processErrorHandlers.js");

    const error = new Error("worker tick failed");
    logUnhandledRejection(error);

    expect(logOperationalEvent).toHaveBeenCalledWith(
      "unhandled_rejection",
      expect.objectContaining({
        reason: "worker tick failed",
        stack: expect.any(String),
      }),
      "error",
    );
  });

  it("logs uncaught exceptions and requests shutdown", async () => {
    const { logUncaughtException } = await import("../src/process/processErrorHandlers.js");
    const gracefulShutdown = vi.fn();
    const error = new Error("uncaught worker failure");

    logUncaughtException(error, gracefulShutdown);

    expect(logOperationalEvent).toHaveBeenCalledWith(
      "uncaught_exception",
      expect.objectContaining({
        error: "uncaught worker failure",
        stack: expect.any(String),
      }),
      "error",
    );
    expect(gracefulShutdown).toHaveBeenCalledWith(1);
  });
});
