import { assessmentJobRepository } from "../repositories/assessmentJobRepository.js";
import { recordAuditEvent } from "./auditService.js";
import { logOperationalEvent } from "../observability/operationalLog.js";

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
      entityType: "assessment_job",
      entityId: job.id,
      action: willFail ? "assessment_job_stale_lock_failed" : "assessment_job_stale_lock_reset",
      metadata: {
        submissionId: job.submissionId,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        outcome: status,
      },
    });

    logOperationalEvent("assessment_job_stale_lock_detected", {
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
