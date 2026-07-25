import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { processNextOutboxEvent } from "./outboxService.js";

type OutboxProcessFn = (workerId: string, leaseMs: number) => Promise<boolean>;

// #795: background delivery worker for the transactional outbox. Each tick drains up to MAX_PER_TICK due
// events (claim → deliver → mark), so a backlog is worked down without one tick running unbounded. Modeled
// on AssessmentWorker (re-entrancy guard, health snapshot). Idempotent handlers make re-delivery safe.
// Each delivery is itself bounded (OUTBOX_DELIVERY_TIMEOUT_MS), so a tick's worst case is MAX_PER_TICK ×
// that timeout — which the wedge window (maxTickMs below) is sized to exceed.
const MAX_PER_TICK = 5;

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
      // #856: a tick delivers up to MAX_PER_TICK events, each bounded by OUTBOX_DELIVERY_TIMEOUT_MS, so its
      // wedge window is the worst-case drain time + buffer — NOT the poll interval. The per-delivery
      // deadline guarantees the tick returns within this, making wedge a pure backstop.
      maxTickMs: MAX_PER_TICK * env.OUTBOX_DELIVERY_TIMEOUT_MS + 60_000,
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
