import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { runArchivedRetentionRound, type RetentionRoundOptions, type RetentionRoundSummary } from "./archivedRetentionJob.js";

// #1152 skive 4c: overvåkeren for slettejobben (archivedRetentionJob.ts). Samme form som WeeklyDigestMonitor, med to forskjeller fra
// gjennomlesingen av byggenotatet (21.11.2026):
//
//   F. EN RUNDE SOM ER FERDIG, ER FREMDRIFT, OGSÅ NÅR DEN FEILET. `lastCycleAt` settes i `finally`. WeeklyDigestMonitor setter den
//      bare ved suksess; en runde som kastet hver gang (utvalget feilet, et brudd mot databasen), ville gjort workeren «stalled» etter
//      30 minutter, og workeren startes på nytt. Da stopper vurderingene. Bare en runde som HENGER, er «wedged» (`maxTickMs`).
//   G. NØDSTOPPEN ER EN RAD, IKKE EN INNSTILLING. Den leses i hver runde (`isPurgeEnabled`), overlever utrullinger og trenger ingen
//      omstart. Overvåkeren er derfor alltid på; runden selv sier «stopped».
//
// Hvert tiende minutt. Ingen sletting de første 15 minuttene etter at workeren startet: under en utrulling går den gamle fortsatt.
// Verifisering etter utrulling: `archivedContentRetentionMonitor` i workerens helsesvar, med siste sammendrag (`lastSummary`).

export const ARCHIVED_RETENTION_INTERVAL_MS = 10 * 60_000;
export const ARCHIVED_RETENTION_STARTUP_GRACE_MS = 15 * 60_000;

export class ArchivedContentRetentionMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;
  private lastError: string | null = null;
  private lastSummary: unknown | null = null;
  private readonly startedAt = Date.now();
  /** «Beholdes» i natt, mellom rundene (archivedRetentionJob.ts). */
  private readonly keptTonight = new Map<string, string>();

  constructor(
    private readonly pollIntervalMs = ARCHIVED_RETENTION_INTERVAL_MS,
    private readonly runRound: (options: RetentionRoundOptions) => Promise<RetentionRoundSummary> = runArchivedRetentionRound,
    private readonly startupGraceMs = ARCHIVED_RETENTION_STARTUP_GRACE_MS,
  ) {}

  start() {
    if (this.timer) return;
    this.stopping = false;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop() {
    // Runden ser signalet før neste kandidat; den som pågår, får fullføre sin ene transaksjon.
    this.stopping = true;
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  health(): MonitorHealthSnapshot {
    return {
      name: "archivedContentRetentionMonitor",
      enabled: true,
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
      lastSummary: this.lastSummary,
      // Budsjettet er 4 minutter, sjekket før hver kandidat; den siste kandidaten kan ta én kurstransaksjon (20 s arbeid + 15 s kø) og
      // «beholdes»-transaksjonen. Over 10 minutter henger runden.
      maxTickMs: 10 * 60_000,
    };
  }

  /** Én runde. Offentlig for testene; timeren kaller den. */
  async tick() {
    if (this.running || this.stopping) return;
    if (Date.now() - this.startedAt < this.startupGraceMs) {
      this.lastCycleAt = new Date();
      this.lastSummary = { skipped: "startup_grace" };
      return;
    }
    this.running = true;
    this.tickStartedAt = new Date();
    try {
      const summary = await this.runRound({ keptTonight: this.keptTonight, shouldStop: () => this.stopping });
      this.lastSummary = summary;
      // Et element som feilet, er ingen feil i overvåkeren, men står i sammendraget og her.
      this.lastError = summary.failed.length > 0 ? `${summary.failed.length} element(er) feilet; se lastSummary.failed` : summary.skipped === "floor_unavailable" ? "floor_unavailable" : null;
      if (summary.failed.length > 0) console.warn(`[#1152] Archived content retention: ${summary.failed.length} item(s) failed`, summary.failed.slice(0, 5));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[#1152] Archived content retention round failed: ${this.lastError}`);
    } finally {
      // F: en runde som ble ferdig, også med feil, er fremdrift.
      this.lastCycleAt = new Date();
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
