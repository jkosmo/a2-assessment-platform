import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
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
  private tickStartedAt: Date | null = null;
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

  // #809: standardized snapshot for the worker readiness check. Always enabled while workers run.
  health(): MonitorHealthSnapshot {
    return {
      name: "pseudonymizationMonitor",
      enabled: true,
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: null,
    };
  }

  private async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.tickStartedAt = new Date();
    try {
      await this.runScan();
      this.lastCycleAt = new Date();
    } catch (error) {
      // #497-incident: never let a failing tick escape as an unhandled rejection — log and continue.
      console.warn(`[pseudonymization] monitor tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
