import { AssessmentJobStatus, SubmissionStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { evaluatePracticalWithLlm } from "./llmAssessmentService.js";
import { sha256 } from "../utils/hash.js";
import { createAssessmentDecision } from "./decisionService.js";
import { recordAuditEvent } from "./auditService.js";

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

export async function enqueueAssessmentJob(submissionId: string) {
  const existingPending = await prisma.assessmentJob.findFirst({
    where: {
      submissionId,
      status: { in: [AssessmentJobStatus.PENDING, AssessmentJobStatus.RUNNING] },
    },
  });

  if (existingPending) {
    return existingPending;
  }

  const job = await prisma.assessmentJob.create({
    data: {
      submissionId,
      status: AssessmentJobStatus.PENDING,
      maxAttempts: env.ASSESSMENT_JOB_MAX_ATTEMPTS,
    },
  });

  await recordAuditEvent({
    entityType: "assessment_job",
    entityId: job.id,
    action: "assessment_job_enqueued",
    metadata: { submissionId },
  });

  return job;
}

export function startAssessmentWorker() {
  if (workerTimer || process.env.NODE_ENV === "test") {
    return;
  }

  workerTimer = setInterval(async () => {
    if (workerRunning) {
      return;
    }
    workerRunning = true;
    try {
      await processNextJob();
    } finally {
      workerRunning = false;
    }
  }, env.ASSESSMENT_JOB_POLL_INTERVAL_MS);
}

export function stopAssessmentWorker() {
  if (!workerTimer) {
    return;
  }
  clearInterval(workerTimer);
  workerTimer = null;
}

export async function processAssessmentJobsNow(maxJobs = 1) {
  for (let i = 0; i < maxJobs; i += 1) {
    const processed = await processNextJob();
    if (!processed) {
      break;
    }
  }
}

export async function processSubmissionJobNow(submissionId: string, maxCycles = 25) {
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    const submissionJob = await prisma.assessmentJob.findFirst({
      where: {
        submissionId,
        status: { in: [AssessmentJobStatus.PENDING, AssessmentJobStatus.RUNNING] },
      },
      select: { id: true },
    });

    if (!submissionJob) {
      return;
    }

    const processed = await processNextJob();
    if (!processed) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  const unresolved = await prisma.assessmentJob.findFirst({
    where: {
      submissionId,
      status: { in: [AssessmentJobStatus.PENDING, AssessmentJobStatus.RUNNING] },
    },
    select: { id: true },
  });
  if (unresolved) {
    throw new Error("Timed out while synchronously processing submission assessment.");
  }
}

async function processNextJob(): Promise<boolean> {
  const now = new Date();
  const candidate = await prisma.assessmentJob.findFirst({
    where: {
      status: AssessmentJobStatus.PENDING,
      availableAt: { lte: now },
      attempts: { lt: env.ASSESSMENT_JOB_MAX_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!candidate) {
    return false;
  }

  const lockResult = await prisma.assessmentJob.updateMany({
    where: {
      id: candidate.id,
      status: AssessmentJobStatus.PENDING,
    },
    data: {
      status: AssessmentJobStatus.RUNNING,
      lockedAt: now,
      lockedBy: "default-worker",
      attempts: { increment: 1 },
    },
  });

  if (lockResult.count === 0) {
    return false;
  }

  try {
    await runAssessment(candidate.id);
    await prisma.assessmentJob.update({
      where: { id: candidate.id },
      data: { status: AssessmentJobStatus.SUCCEEDED, errorMessage: null },
    });
  } catch (error) {
    const job = await prisma.assessmentJob.findUniqueOrThrow({ where: { id: candidate.id } });
    const willRetry = job.attempts < job.maxAttempts;
    await prisma.assessmentJob.update({
      where: { id: candidate.id },
      data: {
        status: willRetry ? AssessmentJobStatus.PENDING : AssessmentJobStatus.FAILED,
        availableAt: willRetry ? new Date(Date.now() + 30_000) : job.availableAt,
        errorMessage: error instanceof Error ? error.message : "Unknown assessment error",
      },
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
  }
  return true;
}

async function runAssessment(jobId: string) {
  const job = await prisma.assessmentJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      submission: {
        include: {
          moduleVersion: true,
          mcqAttempts: { where: { completedAt: { not: null } }, orderBy: { completedAt: "desc" } },
        },
      },
    },
  });

  const submission = job.submission;
  const mcqAttempt = submission.mcqAttempts[0];
  if (!mcqAttempt || mcqAttempt.scaledScore == null || mcqAttempt.percentScore == null) {
    throw new Error("Cannot assess submission before MCQ completion.");
  }

  await prisma.submission.update({
    where: { id: submission.id },
    data: { submissionStatus: SubmissionStatus.PROCESSING },
  });

  const llmResult = await evaluatePracticalWithLlm({
    moduleId: submission.moduleId,
    rawText: submission.rawText ?? "",
    reflectionText: submission.reflectionText,
    promptExcerpt: submission.promptExcerpt,
  });

  const requestPayload = {
    moduleId: submission.moduleId,
    moduleVersionId: submission.moduleVersionId,
    rawText: submission.rawText,
    reflectionText: submission.reflectionText,
    promptExcerpt: submission.promptExcerpt,
  };

  const llmEvaluation = await prisma.lLMEvaluation.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: submission.moduleVersionId,
      modelName: env.LLM_MODE === "stub" ? env.LLM_STUB_MODEL_NAME : "azure_openai",
      promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
      requestPayloadHash: sha256(JSON.stringify(requestPayload)),
      responseJson: JSON.stringify(llmResult),
      rubricTotal: llmResult.rubric_total,
      practicalScoreScaled: llmResult.practical_score_scaled,
      passFailPractical: llmResult.pass_fail_practical,
      manualReviewRecommended: llmResult.manual_review_recommended,
      confidenceNote: llmResult.confidence_note,
    },
  });

  await recordAuditEvent({
    entityType: "llm_evaluation",
    entityId: llmEvaluation.id,
    action: "llm_evaluation_created",
    actorId: submission.userId,
    metadata: {
      submissionId: submission.id,
      modelName: llmEvaluation.modelName,
      practicalScoreScaled: llmEvaluation.practicalScoreScaled,
      passFailPractical: llmEvaluation.passFailPractical,
      manualReviewRecommended: llmEvaluation.manualReviewRecommended,
    },
  });

  await createAssessmentDecision({
    submissionId: submission.id,
    userId: submission.userId,
    moduleVersionId: submission.moduleVersionId,
    rubricVersionId: submission.moduleVersion.rubricVersionId,
    promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
    mcqScaledScore: mcqAttempt.scaledScore,
    mcqPercentScore: mcqAttempt.percentScore,
    llmResult,
  });

  await recordAuditEvent({
    entityType: "assessment_job",
    entityId: jobId,
    action: "assessment_job_completed",
    actorId: submission.userId,
    metadata: { submissionId: submission.id },
  });
}
