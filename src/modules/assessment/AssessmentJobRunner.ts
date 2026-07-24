import { randomUUID } from "node:crypto";
import { AssessmentJobStatus } from "../../db/prismaRuntime.js";
import { env } from "../../config/env.js";

/**
 * Stable identity for this process instance.  Generated once at module load so
 * all lock acquisitions from this process share the same owner string.  Unique
 * per container restart, which makes it safe in a multi-instance deployment.
 */
const WORKER_INSTANCE_ID = randomUUID();
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { alertOnStuckJobs, scanAndResetStaleJobs } from "./staleLockScanner.js";

export type AssessmentRunFn = (jobId: string) => Promise<void>;

const ACTIVE_JOB_STATUSES = [AssessmentJobStatus.PENDING, AssessmentJobStatus.RUNNING];

export async function enqueueAssessmentJob(submissionId: string) {
  const existingPending = await assessmentJobRepository.findPendingOrRunningJobForSubmission(
    submissionId,
    ACTIVE_JOB_STATUSES,
  );

  if (existingPending) {
    return existingPending;
  }

  let job;
  try {
    job = await assessmentJobRepository.createAssessmentJob({
      submissionId,
      status: AssessmentJobStatus.PENDING,
      maxAttempts: env.ASSESSMENT_JOB_MAX_ATTEMPTS,
    });
  } catch (error) {
    // #793: the partial unique index (one active job per submission) rejected this create — a concurrent
    // enqueue won the race. Return the job it created instead of a duplicate (no extra LLM run/decision).
    if (isActiveJobUniqueViolation(error)) {
      const winner = await assessmentJobRepository.findPendingOrRunningJobForSubmission(
        submissionId,
        ACTIVE_JOB_STATUSES,
      );
      if (winner) return winner;
    }
    throw error;
  }

  await recordAuditEvent({
    entityType: auditEntityTypes.assessmentJob,
    entityId: job.id,
    action: auditActions.assessment.assessmentJobEnqueued,
    metadata: { submissionId },
  });
  await logQueueBacklog("enqueue", submissionId);

  return job;
}

// A P2002 on the AssessmentJob active-submission unique index — the concurrent-enqueue loser.
function isActiveJobUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
  await alertOnStuckJobs();

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
  const lockResult = await assessmentJobRepository.tryLockPendingJob(candidate.id, now, WORKER_INSTANCE_ID, leaseExpiresAt);

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
      entityType: auditEntityTypes.assessmentJob,
      entityId: candidate.id,
      action: willRetry
        ? auditActions.assessment.assessmentJobRetryScheduled
        : auditActions.assessment.assessmentJobFailed,
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

  logOperationalEvent(operationalEvents.assessment.queueBacklog, {
    trigger,
    submissionId,
    pendingJobs,
    runningJobs,
  });
}
