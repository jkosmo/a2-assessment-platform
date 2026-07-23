import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { syncEntraUsersFromGroup } from "./entraUserSyncService.js";

// #690: scheduled background sync of the configured Entra group's members into the platform's user
// table, so the employee list stays current automatically (new hires appear, etc.). Only runs when
// ENTRA_USER_SYNC_GROUP_ID is configured; failures are logged and never crash the worker.

export type EntraUserSyncMonitorStatus = {
  enabled: boolean;
  lastCycleAt: string | null;
  lastError: string | null;
};

const SYSTEM_ACTOR = "system_entra_user_sync";

export class EntraUserSyncMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly pollIntervalMs = env.ENTRA_USER_SYNC_INTERVAL_MS,
    private readonly runSync: (actorId: string) => Promise<unknown> = syncEntraUsersFromGroup,
  ) {}

  start() {
    if (this.timer || !env.ENTRA_USER_SYNC_GROUP_ID) {
      return; // not configured → don't schedule
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

  getStatus(): EntraUserSyncMonitorStatus {
    return {
      enabled: Boolean(env.ENTRA_USER_SYNC_GROUP_ID),
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  // #809: standardized snapshot for the worker readiness check.
  health(): MonitorHealthSnapshot {
    return {
      name: "entraUserSyncMonitor",
      enabled: Boolean(env.ENTRA_USER_SYNC_GROUP_ID),
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }

  private async tick() {
    if (this.running || !env.ENTRA_USER_SYNC_GROUP_ID) return;
    this.running = true;
    this.tickStartedAt = new Date();
    try {
      await this.runSync(SYSTEM_ACTOR);
      this.lastCycleAt = new Date();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[#690] Entra user sync failed: ${this.lastError}`);
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
