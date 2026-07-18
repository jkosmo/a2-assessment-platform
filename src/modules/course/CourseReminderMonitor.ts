import { env } from "../../config/env.js";
import { runCourseReminderSchedule } from "./courseReminderService.js";

// #497: scheduled background job that sends course due-date reminders (due-soon + overdue) to
// enrolled participants. Only runs when a notification channel is active
// (PARTICIPANT_NOTIFICATION_CHANNEL !== "disabled"); failures are logged and never crash the worker.
// Env-gated setInterval class, same shape as EntraUserSyncMonitor.

export type CourseReminderMonitorStatus = {
  enabled: boolean;
  lastCycleAt: string | null;
  lastError: string | null;
  lastSummary: unknown | null;
};

export class CourseReminderMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastCycleAt: Date | null = null;
  private lastError: string | null = null;
  private lastSummary: unknown | null = null;

  constructor(
    private readonly pollIntervalMs = env.COURSE_REMINDER_INTERVAL_MS,
    private readonly runSchedule: () => Promise<unknown> = () => runCourseReminderSchedule({ asOf: new Date() }),
  ) {}

  private get enabled(): boolean {
    return env.PARTICIPANT_NOTIFICATION_CHANNEL !== "disabled";
  }

  start() {
    if (this.timer || !this.enabled) {
      return; // notification channel disabled → don't schedule
    }
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

  getStatus(): CourseReminderMonitorStatus {
    return {
      enabled: this.enabled,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
    };
  }

  private async tick() {
    if (this.running || !this.enabled) return;
    this.running = true;
    try {
      this.lastSummary = await this.runSchedule();
      this.lastCycleAt = new Date();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[#497] Course reminder schedule failed: ${this.lastError}`);
    } finally {
      this.running = false;
    }
  }
}
