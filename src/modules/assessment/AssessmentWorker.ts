import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { processNextJob } from "./assessmentJobService.js";

type AssessmentWorkerRunner = () => Promise<boolean>;

export type AssessmentWorkerStatus = {
  instanceId: string;
  lastCycleAt: string | null;
};

export class AssessmentWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
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

  private async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.runJob();
      this.lastCycleAt = new Date();
    } catch {
      // The job runner handles error logging and retry internally.
      // Suppress here so the void-fired tick does not become an unhandled rejection.
    } finally {
      this.running = false;
    }
  }
}
