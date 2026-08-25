import { randomUUID } from "node:crypto";
import { AssessmentJobStatus, ReviewStatus, SubmissionStatus } from "../../db/prismaRuntime.js";
import { env } from "../../config/env.js";

/**
 * Stable identity for this process instance.  Generated once at module load so
 * all lock acquisitions from this process share the same owner string.  Unique
 * per container restart, which makes it safe in a multi-instance deployment.
 */
const WORKER_INSTANCE_ID = randomUUID();
import { assessmentJobRepository, createAssessmentJobRepository } from "./assessmentJobRepository.js";
import { runInTransaction } from "../../db/transaction.js";
import { createDecisionRepository } from "../../repositories/decisionRepository.js";
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
    // #803: the enqueue create + its audit commit atomically. A P2002 from the partial unique index still
    // surfaces from the transaction and is handled below.
    job = await runInTransaction(async (tx) => {
      const created = await createAssessmentJobRepository(tx).createAssessmentJob({
        submissionId,
        status: AssessmentJobStatus.PENDING,
        maxAttempts: env.ASSESSMENT_JOB_MAX_ATTEMPTS,
      });
      await recordAuditEvent(
        {
          entityType: auditEntityTypes.assessmentJob,
          entityId: created.id,
          action: auditActions.assessment.assessmentJobEnqueued,
          metadata: { submissionId },
        },
        tx,
      );
      return created;
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

  // #792: (WORKER_INSTANCE_ID, now) is the fence for THIS lock acquisition. A heartbeat renews the lease
  // while the assessment runs (a long two-LLM-call run must not have its lease expire and get re-claimed),
  // and every terminal write is conditioned on the fence, so if we DID lose the lease we no-op instead of
  // overwriting the new owner's result.
  const leaseDurationMs = env.ASSESSMENT_JOB_LEASE_DURATION_MS;
  const heartbeat = setInterval(() => {
    void assessmentJobRepository
      .renewLease(candidate.id, WORKER_INSTANCE_ID, now, new Date(Date.now() + leaseDurationMs))
      .catch(() => {
        /* renewal is best-effort — the fenced terminal write is the real guard */
      });
  }, Math.max(1_000, Math.floor(leaseDurationMs / 3)));
  heartbeat.unref?.();

  try {
    // #856: bound the in-process runtime. #792's lease heartbeat renews the lease forever, so without a
    // hard cap a stuck job (observed: a DB lock-wait against a zombie connection — NOT the LLM, which
    // self-aborts at AZURE_OPENAI_TIMEOUT_MS) runs forever and wedges the worker's poll loop. On the
    // deadline we abandon the run and fall into the failure path below (fenced retry), so the tick
    // returns and the scanner/retry re-runs the job instead of it wedging. The deadline is set above the
    // worst-case legit assessment (primary + secondary LLM ≈ 2 × AZURE_OPENAI_TIMEOUT_MS + overhead).
    await runWithDeadline(
      runAssessment(candidate.id),
      env.ASSESSMENT_JOB_MAX_RUNTIME_MS,
      `Assessment job ${candidate.id} exceeded the ${env.ASSESSMENT_JOB_MAX_RUNTIME_MS}ms runtime deadline (#856).`,
    );
    const succeeded = await assessmentJobRepository.markJobSucceeded(candidate.id, WORKER_INSTANCE_ID, now);
    if (succeeded.count === 0) {
      logLeaseLost(candidate.id, candidate.submissionId, "success");
      return true;
    }
  } catch (error) {
    const job = await assessmentJobRepository.findAssessmentJobOrThrow(candidate.id);
    const willRetry = job.attempts < job.maxAttempts;
    // #803: the fenced terminal write + its retry/failure audit commit atomically. The audit is written
    // only when the fence still holds (count>0) — a lost lease (count===0) writes neither.
    const finalised = await runInTransaction(async (tx) => {
      const res = await createAssessmentJobRepository(tx).markJobForRetryOrFailure(
        candidate.id,
        WORKER_INSTANCE_ID,
        now,
        {
          status: willRetry ? AssessmentJobStatus.PENDING : AssessmentJobStatus.FAILED,
          availableAt: willRetry ? new Date(Date.now() + 30_000) : job.availableAt,
          errorMessage: error instanceof Error ? error.message : "Unknown assessment error",
        },
      );
      if (res.count === 0) {
        return res;
      }

      // ⚠️ #953: ved ENDELIG feil ble bare jobben oppdatert. Innleveringen ble stående `PROCESSING`
      // — for alltid.
      //
      // Konsekvensen for kandidaten: «Assessment is still processing» som aldri gikk over, og hen
      // kunne ikke starte et nytt MCQ-forsøk heller, fordi `mcqService` blokkerer på `PROCESSING`.
      // Ingen ble varslet, og rapportene telte innleveringen verken som bestått, strøket eller
      // under vurdering. Den var usynlig i alle tre retninger.
      //
      // Kuren finner ikke opp en ny tilstand: dette er nettopp «maskinen klarte ikke avgjøre», og
      // den veien finnes — UNDER_REVIEW pluss en rad i vurdererkøen. Samme maskineri som når en
      // vurdering rutes til manuell behandling av andre grunner.
      //
      // ⚠️ Å sette REJECTED ville vært galt: det leses som en dom mot kandidaten, og her har
      // ingen vurdert noe. Feilen er vår, ikke hens.
      if (!willRetry) {
        const decisionRepo = createDecisionRepository(tx);
        // Idempotent: en jobb kan i prinsippet nå hit to ganger, og to køsaker for samme
        // innlevering ville gitt vurdereren dobbeltarbeid.
        const openReview = await decisionRepo.findOpenManualReviewForSubmission(candidate.submissionId);
        if (!openReview) {
          await decisionRepo.createManualReview({
            submissionId: candidate.submissionId,
            triggerReason: "Automatic assessment failed — routed to manual review (#953).",
            reviewStatus: ReviewStatus.OPEN,
          });
        }
        await decisionRepo.updateSubmissionStatus(candidate.submissionId, SubmissionStatus.UNDER_REVIEW);
      }

      await recordAuditEvent(
        {
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
        },
        tx,
      );
      return res;
    });
    if (finalised.count === 0) {
      logLeaseLost(candidate.id, candidate.submissionId, "failure");
      return true;
    }
  } finally {
    clearInterval(heartbeat);
    await logQueueBacklog("worker_cycle", candidate.submissionId);
  }
  return true;
}

// #856: race a unit of work against a wall-clock deadline. If the deadline wins, reject (the caller
// treats it as a job failure). The abandoned work keeps running to completion in the background — we
// cannot cancel it — but its terminal job write is a no-op once the fence has moved on. The timer is
// cleared as soon as the work settles so a fast job doesn't keep a pending timer alive.
function runWithDeadline<T>(work: Promise<T>, deadlineMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), deadlineMs);
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// #792: the lease was reset + re-claimed by another worker before we could finalize — do not overwrite it.
function logLeaseLost(jobId: string, submissionId: string, phase: "success" | "failure") {
  console.warn(
    `[#792] assessment job ${jobId} (submission ${submissionId}) lost its lease before the ${phase} write; ` +
      "another worker now owns it — skipping the terminal write to avoid clobbering its result.",
  );
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
