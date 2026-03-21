import { env } from "../../config/env.js";
import { runAppealSlaMonitorNow, type AppealSlaMonitorSnapshot } from "./appealSlaMonitorService.js";

type AppealSlaMonitorRunner = () => Promise<AppealSlaMonitorSnapshot>;

export class AppealSlaMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

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

  private async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.runMonitor();
    } finally {
      this.running = false;
    }
  }
}
