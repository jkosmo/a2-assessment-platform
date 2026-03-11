import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentWorker } from "../../src/services/AssessmentWorker.js";

describe("AssessmentWorker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates runOnce to the injected runner", async () => {
    const runJob = vi.fn().mockResolvedValue(true);
    const worker = new AssessmentWorker(1_000, runJob);

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("does not overlap interval ticks while a job is already running", async () => {
    vi.useFakeTimers();

    let pendingRun: { resolve: (value: boolean) => void } | null = null;
    const runJob = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          pendingRun = { resolve };
        }),
    );
    const worker = new AssessmentWorker(100, runJob);

    worker.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(runJob).toHaveBeenCalledTimes(1);

    expect(pendingRun).not.toBeNull();
    pendingRun!.resolve(true);
    await vi.advanceTimersByTimeAsync(100);

    expect(runJob).toHaveBeenCalledTimes(2);
    worker.stop();
  });
});
