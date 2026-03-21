import { AssessmentJobStatus } from "../db/prismaRuntime.js";
import { env } from "../config/env.js";
import { assessmentJobRepository } from "../repositories/assessmentJobRepository.js";
import { recordAuditEvent } from "./auditService.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { scanAndResetStaleJobs } from "./staleLockScanner.js";

export type AssessmentRunFn = (jobId: string) => Promise<void>;

export async function enqueueAssessmentJob(submissionId: string) {
  const existingPending = await assessmentJobRepository.findPendingOrRunningJobForSubmission(submissionId, [
    AssessmentJobStatus.PENDING,
    AssessmentJobStatus.RUNNING,
  ]);

  if (existingPending) {
    return existingPending;
  }

  const job = await assessmentJobRepository.createAssessmentJob({
    submissionId,
    status: AssessmentJobStatus.PENDING,
    maxAttempts: env.ASSESSMENT_JOB_MAX_ATTEMPTS,
  });

  await recordAuditEvent({
    entityType: "assessment_job",
    entityId: job.id,
    action: "assessment_job_enqueued",
    metadata: { submissionId },
  });
  await logQueueBacklog("enqueue", submissionId);

  return job;
}

export async function processAssessmentJobsNow(runAssessment: AssessmentRunFn, maxJobs = 1) {
  for (let i = 0; i < maxJobs; i += 1) {
    const processed = await processNextJob(runAssessment);
    if (!processed) {
      break;
    }
  }
}

export async function processSubmissionJobNow(runAssessment: AssessmentRunFn, submissionId: string, maxCycles = 25) {
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    const submissionJob = await assessmentJobRepository.findPendingOrRunningJobIdForSubmission(submissionId, [
      AssessmentJobStatus.PENDING,
      AssessmentJobStatus.RUNNING,
    ]);

    if (!submissionJob) {
      return;
    }

    const processed = await processNextJob(runAssessment, submissionId);
    if (!processed) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  const unresolved = await assessmentJobRepository.findPendingOrRunningJobIdForSubmission(submissionId, [
    AssessmentJobStatus.PENDING,
    AssessmentJobStatus.RUNNING,
  ]);
  if (unresolved) {
    throw new Error("Timed out while synchronously processing submission assessment.");
  }
}

export async function processNextJob(runAssessment: AssessmentRunFn, submissionId?: string): Promise<boolean> {
  await scanAndResetStaleJobs();

  const now = new Date();
  const candidate = await assessmentJobRepository.findNextRunnableJob(
    now,
    env.ASSESSMENT_JOB_MAX_ATTEMPTS,
    submissionId,
  );

  if (!candidate) {
    return false;
  }

  const leaseExpiresAt = new Date(now.getTime() + env.ASSESSMENT_JOB_LEASE_DURATION_MS);
  const lockResult = await assessmentJobRepository.tryLockPendingJob(candidate.id, now, "default-worker", leaseExpiresAt);

  if (lockResult.count === 0) {
    return false;
  }

  try {
    await runAssessment(candidate.id);
    await assessmentJobRepository.markJobSucceeded(candidate.id);
  } catch (error) {
    const job = await assessmentJobRepository.findAssessmentJobOrThrow(candidate.id);
    const willRetry = job.attempts < job.maxAttempts;
    await assessmentJobRepository.markJobForRetryOrFailure(candidate.id, {
      status: willRetry ? AssessmentJobStatus.PENDING : AssessmentJobStatus.FAILED,
      availableAt: willRetry ? new Date(Date.now() + 30_000) : job.availableAt,
      errorMessage: error instanceof Error ? error.message : "Unknown assessment error",
    });

    await recordAuditEvent({
      entityType: "assessment_job",
      entityId: candidate.id,
      action: willRetry ? "assessment_job_retry_scheduled" : "assessment_job_failed",
      metadata: {
        submissionId: candidate.submissionId,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        errorMessage: error instanceof Error ? error.message : "Unknown assessment error",
      },
    });
  } finally {
    await logQueueBacklog("worker_cycle", candidate.submissionId);
  }
  return true;
}

async function logQueueBacklog(trigger: string, submissionId: string) {
  const pendingJobs = await assessmentJobRepository.countJobsByStatus(AssessmentJobStatus.PENDING);
  const runningJobs = await assessmentJobRepository.countJobsByStatus(AssessmentJobStatus.RUNNING);

  logOperationalEvent("assessment_queue_backlog", {
    trigger,
    submissionId,
    pendingJobs,
    runningJobs,
  });
}
