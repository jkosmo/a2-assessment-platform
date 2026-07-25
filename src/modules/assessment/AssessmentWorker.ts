import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import type { MonitorHealthSnapshot } from "../../observability/workerHealth.js";
import { processNextJob } from "./assessmentJobService.js";

type AssessmentWorkerRunner = () => Promise<boolean>;

export type AssessmentWorkerStatus = {
  instanceId: string;
  lastCycleAt: string | null;
};

export class AssessmentWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickStartedAt: Date | null = null;
  private lastCycleAt: Date | null = null;
  readonly instanceId: string;

  constructor(
    private readonly pollIntervalMs = env.ASSESSMENT_JOB_POLL_INTERVAL_MS,
    private readonly runJob: AssessmentWorkerRunner = () => processNextJob(),
    instanceId?: string,
  ) {
    this.instanceId = instanceId ?? randomUUID();
  }

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
    return this.runJob();
  }

  getStatus(): AssessmentWorkerStatus {
    return {
      instanceId: this.instanceId,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
    };
  }

  // #809: standardized snapshot for the worker readiness check. Always enabled while workers run.
  health(): MonitorHealthSnapshot {
    return {
      name: "assessmentWorker",
      enabled: true,
      intervalMs: this.pollIntervalMs,
      running: this.running,
      tickStartedAt: this.tickStartedAt?.toISOString() ?? null,
      lastCycleAt: this.lastCycleAt?.toISOString() ?? null,
      lastError: null,
      // #856: a tick spans a full job execution (up to a couple of LLM calls), so its wedge window is
      // governed by the per-job runtime cap — NOT the 4 s poll interval. Sized above the cap so the
      // runner's own deadline (which fails the job and returns the tick) fires first; wedge is the
      // backstop for if that deadline mechanism itself breaks.
      maxTickMs: env.ASSESSMENT_JOB_MAX_RUNTIME_MS + 60_000,
    };
  }

  private async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.tickStartedAt = new Date();
    try {
      await this.runJob();
      this.lastCycleAt = new Date();
    } catch {
      // The job runner handles error logging and retry internally.
      // Suppress here so the void-fired tick does not become an unhandled rejection.
    } finally {
      this.running = false;
      this.tickStartedAt = null;
    }
  }
}
