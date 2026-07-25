import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { processNextOutboxEvent } from "./outboxService.js";

type OutboxProcessFn = (workerId: string, leaseMs: number) => Promise<boolean>;

// #795: background delivery worker for the transactional outbox. Each tick drains up to MAX_PER_TICK due
// events (claim → deliver → mark), so a backlog is worked down without one tick running unbounded. Modeled
// on AssessmentWorker (re-entrancy guard, health snapshot). Idempotent handlers make re-delivery safe.
const MAX_PER_TICK = 10;

export type OutboxDeliveryWorkerStatus = {
  instanceId: string;
  lastCycleAt: string | null;
};

export class OutboxDeliveryWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;
  readonly instanceId: string;

  constructor(
    private readonly pollIntervalMs = env.OUTBOX_POLL_INTERVAL_MS,
    private readonly leaseMs = env.OUTBOX_LEASE_DURATION_MS,
    private readonly processFn: OutboxProcessFn = processNextOutboxEvent,
    instanceId?: string,
  ) {
    this.instanceId = instanceId ?? randomUUID();
  }

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

  // Drain one event (test/manual hook).
  runOnce() {
    return this.processFn(this.instanceId, this.leaseMs);
  }

  getStatus(): OutboxDeliveryWorkerStatus {
    return { instanceId: this.instanceId, lastCycleAt: this.lastCycleAt?.toISOString() ?? null };
  }

  health(): MonitorHealthSnapshot {
    return {
      name: "outboxDeliveryWorker",
      enabled: true,
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: null,
      // #856: a tick can deliver up to MAX_PER_TICK events, each an email/ACS or DB call, so its wedge
      // window is governed by the drain budget + lease — not the poll interval.
      maxTickMs: this.leaseMs + 120_000,
    };
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    this.tickStartedAt = new Date();
    try {
      let processed = 0;
      while (processed < MAX_PER_TICK && (await this.processFn(this.instanceId, this.leaseMs))) {
        processed += 1;
      }
      this.lastCycleAt = new Date();
    } catch {
      // processNextOutboxEvent handles per-event errors + retry internally; swallow here so the
      // void-fired tick never becomes an unhandled rejection.
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
