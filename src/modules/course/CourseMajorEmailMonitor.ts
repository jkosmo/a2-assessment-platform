import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { runCourseMajorEmailSchedule } from "./courseMajorVersionEmail.js";

// #934 skive 4b: jobben som sender e-posten om en ny hovedversjon (courseMajorVersionEmail.ts). Samme form som
// CourseReminderMonitor: setInterval i worker-rollen, feil logges og velter aldri workeren.
//
// Kjører bare når COURSE_MAJOR_EMAIL_ENABLED=true OG varselkanalen er på. Av: ingen hendelse av den nye typen legges
// i outboxen, og radene venter. ⚠️ En endret innstilling er ikke virksom før workeren har startet på nytt, og det
// kan ta ~15 min på B1, eller ikke skje (målt 2026-11-07): sjekk `startedAt` på workerens /version før du stoler på den.

export type CourseMajorEmailMonitorStatus = {
  enabled: boolean;
  lastCycleAt: string | null;
  lastError: string | null;
  lastSummary: unknown | null;
};

export class CourseMajorEmailMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;
  private lastError: string | null = null;
  private lastSummary: unknown | null = null;

  constructor(
    private readonly pollIntervalMs = env.COURSE_MAJOR_EMAIL_INTERVAL_MS,
    private readonly runSchedule: () => Promise<unknown> = () => runCourseMajorEmailSchedule(),
  ) {}

  private get enabled(): boolean {
    return env.COURSE_MAJOR_EMAIL_ENABLED && env.PARTICIPANT_NOTIFICATION_CHANNEL !== "disabled";
  }

  start() {
    if (this.timer || !this.enabled) {
      return; // av → ikke planlagt
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

  getStatus(): CourseMajorEmailMonitorStatus {
    return {
      enabled: this.enabled,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
    };
  }

  // #809: samme øyeblikksbilde som de andre jobbene, for workerens helsesjekk.
  health(): MonitorHealthSnapshot {
    return {
      name: "courseMajorEmailMonitor",
      enabled: this.enabled,
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  private async tick() {
    if (this.running || !this.enabled) return;
    this.running = true;
    this.tickStartedAt = new Date();
    try {
      this.lastSummary = await this.runSchedule();
      this.lastCycleAt = new Date();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[#934] Course major version e-mail schedule failed: ${this.lastError}`);
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
