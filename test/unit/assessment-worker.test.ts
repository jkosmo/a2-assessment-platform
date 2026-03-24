import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentWorker } from "../../src/modules/assessment/AssessmentWorker.js";

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

  it("processes immediately on start without waiting for first interval", () => {
    const runJob = vi.fn().mockResolvedValue(true);
    const worker = new AssessmentWorker(10_000, runJob);

    worker.start();

    // runJob is invoked synchronously up to its first await inside tick()
    expect(runJob).toHaveBeenCalledTimes(1);
    worker.stop();
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

    // Immediate tick fired on start; interval ticks at t=100 and t=200 were skipped
    expect(runJob).toHaveBeenCalledTimes(1);

    expect(pendingRun).not.toBeNull();
    pendingRun!.resolve(true);
    await vi.advanceTimersByTimeAsync(100);

    expect(runJob).toHaveBeenCalledTimes(2);
    worker.stop();
  });

  it("exposes a stable instanceId", () => {
    const worker = new AssessmentWorker(1_000, vi.fn());
    expect(typeof worker.instanceId).toBe("string");
    expect(worker.instanceId.length).toBeGreaterThan(0);
  });

  it("accepts an explicit instanceId", () => {
    const worker = new AssessmentWorker(1_000, vi.fn(), "test-instance-id");
    expect(worker.getStatus().instanceId).toBe("test-instance-id");
  });

  it("getStatus returns null lastCycleAt before first tick completes", () => {
    const worker = new AssessmentWorker(1_000, vi.fn().mockResolvedValue(true));
    expect(worker.getStatus().lastCycleAt).toBeNull();
  });

  it("getStatus updates lastCycleAt after a tick completes", async () => {
    const runJob = vi.fn().mockResolvedValue(true);
    const worker = new AssessmentWorker(10_000, runJob);

    worker.start();
    // Yield to microtask queue so the immediate tick can complete
    await Promise.resolve();

    worker.stop();
    expect(worker.getStatus().lastCycleAt).not.toBeNull();
  });

  it("getStatus does not update lastCycleAt when tick throws", async () => {
    const runJob = vi.fn().mockRejectedValue(new Error("job failed"));
    const worker = new AssessmentWorker(10_000, runJob);

    worker.start();
    await Promise.resolve();

    worker.stop();
    expect(worker.getStatus().lastCycleAt).toBeNull();
  });
});
