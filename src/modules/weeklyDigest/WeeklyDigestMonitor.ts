import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { runWeeklyDigestSchedule } from "./weeklyDigestJob.js";

// #1139 skive 3: jobben for den ukentlige e-posten (weeklyDigestJob.ts). Samme form som CourseAssignmentEmailMonitor: setInterval i
// worker-rollen, feil logges og velter aldri workeren.
//
// Kjører hvert 5. minutt når WEEKLY_EMAIL_ENABLED=true OG varselkanalen er på (nødstopp, 12.8). Ingen nye hendelser de første 15
// minuttene etter at workeren startet (12.6, som #1142): under en utrulling går den gamle workeren fortsatt.
//
// Verifisering etter utrulling: `weeklyDigestMonitor` i workerens helsesvar, med siste sammendrag (`lastSummary`).

export const WEEKLY_DIGEST_INTERVAL_MS = 5 * 60_000;
export const WEEKLY_DIGEST_STARTUP_GRACE_MS = 15 * 60_000;

export class WeeklyDigestMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;
  private lastError: string | null = null;
  private lastSummary: unknown | null = null;
  private readonly startedAt = Date.now();

  constructor(
    private readonly pollIntervalMs = WEEKLY_DIGEST_INTERVAL_MS,
    private readonly runSchedule: () => Promise<unknown> = () => runWeeklyDigestSchedule(),
    private readonly startupGraceMs = WEEKLY_DIGEST_STARTUP_GRACE_MS,
  ) {}

  private get enabled(): boolean {
    return env.WEEKLY_EMAIL_ENABLED && env.PARTICIPANT_NOTIFICATION_CHANNEL !== "disabled";
  }

  start() {
    if (this.timer || !this.enabled) return;
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

  health(): MonitorHealthSnapshot {
    return {
      name: "weeklyDigestMonitor",
      enabled: this.enabled,
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
      // Runden har en tidsgrense på 60 s for vurderingen (WEEKLY_DIGEST_RUN_BUDGET_MS) pluss ryddingen. Står den over 5 min, er den
      // fastlåst (QA-porten 2.152.0, bør 4).
      maxTickMs: 5 * 60_000,
    };
  }

  private async tick() {
    if (this.running || !this.enabled) return;
    // Ventetiden etter oppstart er en runde uten arbeid, ikke en uteblitt runde: helsesjekken gir en overvåker 15 minutter før
    // første runde må være fullført, og denne venter like lenge pluss opptil ett intervall.
    if (Date.now() - this.startedAt < this.startupGraceMs) {
      this.lastCycleAt = new Date();
      this.lastSummary = { skipped: "startup_grace" };
      return;
    }
    this.running = true;
    this.tickStartedAt = new Date();
    try {
      this.lastSummary = await this.runSchedule();
      this.lastCycleAt = new Date();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[#1139] Weekly digest schedule failed: ${this.lastError}`);
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
