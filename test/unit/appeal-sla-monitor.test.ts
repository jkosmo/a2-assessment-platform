import { afterEach, describe, expect, it, vi } from "vitest";
import { AppealSlaMonitor } from "../../src/modules/appeal/AppealSlaMonitor.js";

describe("AppealSlaMonitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates runOnce to the injected monitor runner", async () => {
    const runMonitor = vi.fn().mockResolvedValue({
      checkedAt: new Date().toISOString(),
      openAppeals: 1,
      inReviewAppeals: 0,
      onTrackAppeals: 1,
      atRiskAppeals: 0,
      overdueAppeals: 0,
      overdueThreshold: 1,
      thresholdBreached: false,
      oldestOverdueHours: null,
    });
    const monitor = new AppealSlaMonitor(1_000, runMonitor);

    await expect(monitor.runOnce()).resolves.toEqual(expect.objectContaining({ openAppeals: 1 }));
    expect(runMonitor).toHaveBeenCalledTimes(1);
  });

  it("runs immediately on start without overlapping monitor ticks", async () => {
    vi.useFakeTimers();

    let pendingRun:
      | {
          resolve: (value: {
            checkedAt: string;
            openAppeals: number;
            inReviewAppeals: number;
            onTrackAppeals: number;
            atRiskAppeals: number;
            overdueAppeals: number;
            overdueThreshold: number;
            thresholdBreached: boolean;
            oldestOverdueHours: null;
          }) => void;
        }
      | null = null;
    const runMonitor = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingRun = { resolve };
        }),
    );
    const monitor = new AppealSlaMonitor(100, runMonitor);

    monitor.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(runMonitor).toHaveBeenCalledTimes(1);

    expect(pendingRun).not.toBeNull();
    pendingRun!.resolve({
      checkedAt: new Date().toISOString(),
      openAppeals: 0,
      inReviewAppeals: 0,
      onTrackAppeals: 0,
      atRiskAppeals: 0,
      overdueAppeals: 0,
      overdueThreshold: 1,
      thresholdBreached: false,
      oldestOverdueHours: null,
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(runMonitor).toHaveBeenCalledTimes(2);
    monitor.stop();
  });
});
