import { env } from "../../config/env.js";
import { processNextJob } from "./assessmentJobService.js";

type AssessmentWorkerRunner = () => Promise<boolean>;

export class AssessmentWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly pollIntervalMs = env.ASSESSMENT_JOB_POLL_INTERVAL_MS,
    private readonly runJob: AssessmentWorkerRunner = () => processNextJob(),
  ) {}

  start() {
    if (this.timer) {
      return;
    }

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

  private async tick() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.runJob();
    } finally {
      this.running = false;
    }
  }
}
