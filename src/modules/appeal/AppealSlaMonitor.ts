import { env } from "../../config/env.js";
import { runAppealSlaMonitorNow, type AppealSlaMonitorSnapshot } from "./appealSlaMonitorService.js";

type AppealSlaMonitorRunner = () => Promise<AppealSlaMonitorSnapshot>;

export type AppealSlaMonitorStatus = {
  lastCycleAt: string | null;
};

export class AppealSlaMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
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

  private async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.runMonitor();
      this.lastCycleAt = new Date();
    } finally {
      this.running = false;
    }
  }
}
