import { runAuditRetentionScan, type AuditRetentionResult } from "./auditRetentionService.js";

type ScanRunner = () => Promise<AuditRetentionResult>;

/**
 * Periodic monitor that purges old operational-category audit events.
 * Runs once every 24 hours — daily pruning is sufficient for a 7-day window.
 */
export type AuditRetentionMonitorStatus = {
  lastCycleAt: string | null;
};

export class AuditRetentionMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastCycleAt: Date | null = null;

  constructor(
    private readonly pollIntervalMs = 24 * 60 * 60 * 1_000,
    private readonly runScan: ScanRunner = () => runAuditRetentionScan(),
  ) {}

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  runOnce() {
    return this.runScan();
  }

  getStatus(): AuditRetentionMonitorStatus {
    return { lastCycleAt: this.lastCycleAt?.toISOString() ?? null };
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.runScan();
      this.lastCycleAt = new Date();
    } finally {
      this.running = false;
    }
  }
}
