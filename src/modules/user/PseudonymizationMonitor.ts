import { runPseudonymizationScan, type PseudonymizationScanResult } from "./pseudonymizationScanner.js";

type ScanRunner = () => Promise<PseudonymizationScanResult>;

/**
 * Periodic monitor that executes the pseudonymisation scan on a configurable
 * interval. Follows the same pattern as AppealSlaMonitor.
 *
 * Default interval: 6 hours. Pseudonymisation is not time-critical to the
 * minute, so a long interval keeps database load low.
 */
export type PseudonymizationMonitorStatus = {
  lastCycleAt: string | null;
};

export class PseudonymizationMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastCycleAt: Date | null = null;

  constructor(
    private readonly pollIntervalMs = 6 * 60 * 60 * 1_000,
    private readonly runScan: ScanRunner = () => runPseudonymizationScan(),
  ) {}

  start() {
    if (this.timer) {
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  runOnce() {
    return this.runScan();
  }

  getStatus(): PseudonymizationMonitorStatus {
    return { lastCycleAt: this.lastCycleAt?.toISOString() ?? null };
  }

  private async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.runScan();
      this.lastCycleAt = new Date();
    } finally {
      this.running = false;
    }
  }
}
