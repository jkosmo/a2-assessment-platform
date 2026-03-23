import { env } from "../../config/env.js";
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";

export type StaleLockScanResult = {
  scannedAt: string;
  reset: number;
  failed: number;
};

export async function scanAndResetStaleJobs(): Promise<StaleLockScanResult> {
  const now = new Date();
  const expiredJobs = await assessmentJobRepository.findExpiredRunningJobs(now);

  let reset = 0;
  let failed = 0;

  for (const job of expiredJobs) {
    const willFail = job.attempts >= job.maxAttempts;
    const status = willFail ? "FAILED" : "PENDING";

    await assessmentJobRepository.resetExpiredJob(job.id, {
      status,
      availableAt: now,
      errorMessage: "Stale lock: job exceeded lease duration without completing.",
    });

    await recordAuditEvent({
      entityType: auditEntityTypes.assessmentJob,
      entityId: job.id,
      action: willFail
        ? auditActions.assessment.assessmentJobStaleLockFailed
        : auditActions.assessment.assessmentJobStaleLockReset,
      metadata: {
        submissionId: job.submissionId,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        outcome: status,
      },
    });

    logOperationalEvent(operationalEvents.assessment.jobStaleLockDetected, {
      jobId: job.id,
      submissionId: job.submissionId,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      outcome: status,
    });

    if (willFail) {
      failed += 1;
    } else {
      reset += 1;
    }
  }

  return { scannedAt: now.toISOString(), reset, failed };
}

export async function alertOnStuckJobs(): Promise<void> {
  const now = new Date();
  const lockedBefore = new Date(now.getTime() - env.ASSESSMENT_JOB_STUCK_THRESHOLD_MS);
  const stuckJobs = await assessmentJobRepository.findLongRunningJobs(lockedBefore);

  for (const job of stuckJobs) {
    logOperationalEvent(
      operationalEvents.assessment.jobStuckAlert,
      {
        correlationId: job.id,
        jobId: job.id,
        submissionId: job.submissionId,
        lockedAt: job.lockedAt?.toISOString() ?? null,
        lockedBy: job.lockedBy,
        attempts: job.attempts,
        stuckThresholdMs: env.ASSESSMENT_JOB_STUCK_THRESHOLD_MS,
      },
      "error",
    );
  }
}
