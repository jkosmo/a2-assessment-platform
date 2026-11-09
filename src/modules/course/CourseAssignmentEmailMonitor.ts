import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { runCourseAssignmentEmailSchedule } from "./courseAssignmentNotice.js";

// #1142: jobben som lager radene for e-posten om nye kurs og samler dem per person (courseAssignmentNotice.ts). Samme form
// som CourseMajorEmailMonitor: setInterval i worker-rollen, feil logges og velter aldri workeren.
//
// Kjører hvert minutt når varselkanalen ikke er `disabled`. Ingen egen bryter (produkteier 2026-11-08, spørsmål 3):
// `PARTICIPANT_NOTIFICATION_CHANNEL=disabled` på workeren er nødstoppen, og stopper all annen e-post også. Av: ingen rader
// lages og ingen hendelse legges i køen; det som har kommet til, tas i første runde etter at kanalen er på igjen.
//
// Verifisering etter utrulling: `courseAssignmentEmailMonitor` i workerens helsesvar, med siste sammendrag (`lastSummary`).

/** Hvert minutt (planen, punkt 4). Ingen ny innstilling i Azure (punkt 7). */
export const COURSE_ASSIGNMENT_EMAIL_INTERVAL_MS = 60_000;

export type CourseAssignmentEmailMonitorStatus = {
  enabled: boolean;
  lastCycleAt: string | null;
  lastError: string | null;
  lastSummary: unknown | null;
};

export class CourseAssignmentEmailMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;
  private lastError: string | null = null;
  private lastSummary: unknown | null = null;

  constructor(
    private readonly pollIntervalMs = COURSE_ASSIGNMENT_EMAIL_INTERVAL_MS,
    private readonly runSchedule: () => Promise<unknown> = () => runCourseAssignmentEmailSchedule(),
  ) {}

  private get enabled(): boolean {
    return env.PARTICIPANT_NOTIFICATION_CHANNEL !== "disabled";
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

  getStatus(): CourseAssignmentEmailMonitorStatus {
    return {
      enabled: this.enabled,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
    };
  }

  // #809: samme øyeblikksbilde som de andre jobbene, for workerens helsesjekk — med siste sammendrag, så utrullingen kan
  // se at jobben går og hva den gjorde (planen, punkt 7).
  health(): MonitorHealthSnapshot {
    return {
      name: "courseAssignmentEmailMonitor",
      enabled: this.enabled,
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
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
      console.warn(`[#1142] Course assignment e-mail schedule failed: ${this.lastError}`);
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
