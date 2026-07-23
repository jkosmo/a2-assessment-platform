import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { runAppealSlaMonitorNow, type AppealSlaMonitorSnapshot } from "./appealSlaMonitorService.js";

type AppealSlaMonitorRunner = () => Promise<AppealSlaMonitorSnapshot>;

export type AppealSlaMonitorStatus = {
  lastCycleAt: string | null;
};

export class AppealSlaMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;

  constructor(
    private readonly pollIntervalMs = env.APPEAL_SLA_MONITOR_INTERVAL_MS,
    private readonly runMonitor: AppealSlaMonitorRunner = () => runAppealSlaMonitorNow(),
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
    return this.runMonitor();
  }

  getStatus(): AppealSlaMonitorStatus {
    return { lastCycleAt: this.lastCycleAt?.toISOString() ?? null };
  }

  // #809: standardized snapshot for the worker readiness check. Always enabled while workers run.
  health(): MonitorHealthSnapshot {
    return {
      name: "appealSlaMonitor",
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
      await this.runMonitor();
      this.lastCycleAt = new Date();
    } catch (error) {
      // #497-incident: a failing tick (e.g. a DB connection-pool timeout during the startup storm)
      // must never escape as an unhandled rejection — log and let the monitor keep ticking.
      console.warn(`[appeal-sla] monitor tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
