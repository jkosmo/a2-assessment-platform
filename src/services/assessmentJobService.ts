import { AssessmentJobStatus, SubmissionStatus } from "../db/prismaRuntime.js";
import { env } from "../config/env.js";
import { assessmentJobRepository } from "../repositories/assessmentJobRepository.js";
import { evaluatePracticalWithLlm } from "./llmAssessmentService.js";
import { sha256 } from "../utils/hash.js";
import { createAssessmentDecision } from "./decisionService.js";
import { recordAuditEvent } from "./auditService.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { preprocessSensitiveDataForLlm } from "./sensitiveDataMaskingService.js";
import {
  evaluateSecondaryAssessmentDisagreement,
  evaluateSecondaryAssessmentTrigger,
} from "./secondaryAssessmentService.js";
import { shouldSuppressManualReviewForInsufficientEvidenceDisagreement } from "./assessmentDecisionSignals.js";
import { localizeContentText } from "../i18n/content.js";
import { normalizeLocale } from "../i18n/locale.js";

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
    const submissionJob = await assessmentJobRepository.findPendingOrRunningJobIdForSubmission(submissionId, [
      AssessmentJobStatus.PENDING,
      AssessmentJobStatus.RUNNING,
    ]);

    if (!submissionJob) {
      return;
    }

    const processed = await processNextJob(submissionId);
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

export async function processNextJob(submissionId?: string): Promise<boolean> {
  const now = new Date();
  const candidate = await assessmentJobRepository.findNextRunnableJob(
    now,
    env.ASSESSMENT_JOB_MAX_ATTEMPTS,
    submissionId,
  );

  if (!candidate) {
    return false;
  }

  const lockResult = await assessmentJobRepository.tryLockPendingJob(candidate.id, now, "default-worker");

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

async function runAssessment(jobId: string) {
  const job = await assessmentJobRepository.findAssessmentJobWithSubmissionOrThrow(jobId);

  const submission = job.submission;
  const submissionLocale = normalizeLocale(submission.locale) ?? "en-GB";
  const mcqAttempt = submission.mcqAttempts[0];
  if (!mcqAttempt || mcqAttempt.scaledScore == null || mcqAttempt.percentScore == null) {
    throw new Error("Cannot assess submission before MCQ completion.");
  }

  await assessmentJobRepository.updateSubmissionStatus(submission.id, SubmissionStatus.PROCESSING);

  const sensitiveDataPreprocess = preprocessSensitiveDataForLlm({
    moduleId: submission.moduleId,
    rawText: submission.rawText ?? "",
    reflectionText: submission.reflectionText,
    promptExcerpt: submission.promptExcerpt,
  });

  await recordAuditEvent({
    entityType: "submission",
    entityId: submission.id,
    action: "sensitive_data_preprocessed",
    actorId: submission.userId,
    metadata: {
      moduleId: submission.moduleId,
      maskingEnabled: sensitiveDataPreprocess.maskingEnabled,
      maskingApplied: sensitiveDataPreprocess.maskingApplied,
      totalMatches: sensitiveDataPreprocess.totalMatches,
      ruleHits: sensitiveDataPreprocess.ruleHits,
      fieldsMasked: sensitiveDataPreprocess.fieldsMasked,
    },
  });

  const createLlmEvaluationRecord = async (
    llmResult: Awaited<ReturnType<typeof evaluatePracticalWithLlm>>,
    assessmentPass: "primary" | "secondary",
  ) => {
    const requestPayload = {
      moduleId: submission.moduleId,
      moduleVersionId: submission.moduleVersionId,
      assessmentPass,
      rawText: sensitiveDataPreprocess.payload.rawText,
      reflectionText: sensitiveDataPreprocess.payload.reflectionText,
      promptExcerpt: sensitiveDataPreprocess.payload.promptExcerpt,
      sensitiveDataPreprocess: {
        maskingEnabled: sensitiveDataPreprocess.maskingEnabled,
        maskingApplied: sensitiveDataPreprocess.maskingApplied,
        totalMatches: sensitiveDataPreprocess.totalMatches,
        ruleHits: sensitiveDataPreprocess.ruleHits,
      },
    };

    const llmEvaluation = await assessmentJobRepository.createLlmEvaluation({
      submissionId: submission.id,
      moduleVersionId: submission.moduleVersionId,
      modelName:
        env.LLM_MODE === "stub"
          ? `${env.LLM_STUB_MODEL_NAME}:${assessmentPass}`
          : `${env.AZURE_OPENAI_DEPLOYMENT ?? "azure_openai"}:${assessmentPass}`,
      promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
      requestPayloadHash: sha256(JSON.stringify(requestPayload)),
      responseJson: JSON.stringify(llmResult),
      rubricTotal: llmResult.rubric_total,
      practicalScoreScaled: llmResult.practical_score_scaled,
      passFailPractical: llmResult.pass_fail_practical,
      manualReviewRecommended: llmResult.manual_review_recommended,
      confidenceNote: llmResult.confidence_note,
    });

    await recordAuditEvent({
      entityType: "llm_evaluation",
      entityId: llmEvaluation.id,
      action: "llm_evaluation_created",
      actorId: submission.userId,
      metadata: {
        submissionId: submission.id,
        assessmentPass,
        modelName: llmEvaluation.modelName,
        practicalScoreScaled: llmEvaluation.practicalScoreScaled,
        passFailPractical: llmEvaluation.passFailPractical,
        manualReviewRecommended: llmEvaluation.manualReviewRecommended,
      },
    });

    return llmEvaluation;
  };

  let primaryLlmResult: Awaited<ReturnType<typeof evaluatePracticalWithLlm>>;
  try {
    primaryLlmResult = await evaluatePracticalWithLlm({
      moduleId: submission.moduleId,
      rawText: sensitiveDataPreprocess.payload.rawText,
      reflectionText: sensitiveDataPreprocess.payload.reflectionText,
      promptExcerpt: sensitiveDataPreprocess.payload.promptExcerpt,
      responseLocale: submissionLocale,
      assessmentPass: "primary",
      promptTemplateSystem: submission.moduleVersion.promptTemplateVersion.systemPrompt,
      promptTemplateUserTemplate: submission.moduleVersion.promptTemplateVersion.userPromptTemplate,
      promptTemplateExamplesJson: submission.moduleVersion.promptTemplateVersion.examplesJson,
      moduleTaskText: localizeContentText(submissionLocale, submission.moduleVersion.taskText) ?? submission.moduleVersion.taskText,
      moduleGuidanceText: localizeContentText(submissionLocale, submission.moduleVersion.guidanceText) ?? undefined,
    });
  } catch (error) {
    logOperationalEvent(
      "llm_evaluation_failed",
      {
        jobId,
        submissionId: submission.id,
        assessmentPass: "primary",
        llmMode: env.LLM_MODE,
        errorMessage: error instanceof Error ? error.message : "Unknown LLM evaluation error",
      },
      "error",
    );
    throw error;
  }
  await createLlmEvaluationRecord(primaryLlmResult, "primary");

  let finalLlmResult = primaryLlmResult;
  let forceManualReviewReason: string | undefined;

  const secondaryTrigger = evaluateSecondaryAssessmentTrigger({
    moduleId: submission.moduleId,
    primaryResult: primaryLlmResult,
  });

  if (secondaryTrigger.shouldRun) {
    await recordAuditEvent({
      entityType: "assessment_job",
      entityId: jobId,
      action: "secondary_assessment_triggered",
      actorId: submission.userId,
      metadata: {
        submissionId: submission.id,
        reasons: secondaryTrigger.reasons,
      },
    });

    let secondaryLlmResult: Awaited<ReturnType<typeof evaluatePracticalWithLlm>>;
    try {
      secondaryLlmResult = await evaluatePracticalWithLlm({
        moduleId: submission.moduleId,
        rawText: sensitiveDataPreprocess.payload.rawText,
        reflectionText: sensitiveDataPreprocess.payload.reflectionText,
        promptExcerpt: sensitiveDataPreprocess.payload.promptExcerpt,
        responseLocale: submissionLocale,
        assessmentPass: "secondary",
        promptTemplateSystem: submission.moduleVersion.promptTemplateVersion.systemPrompt,
        promptTemplateUserTemplate: submission.moduleVersion.promptTemplateVersion.userPromptTemplate,
        promptTemplateExamplesJson: submission.moduleVersion.promptTemplateVersion.examplesJson,
        moduleTaskText: localizeContentText(submissionLocale, submission.moduleVersion.taskText) ?? submission.moduleVersion.taskText,
        moduleGuidanceText: localizeContentText(submissionLocale, submission.moduleVersion.guidanceText) ?? undefined,
      });
    } catch (error) {
      logOperationalEvent(
        "llm_evaluation_failed",
        {
          jobId,
          submissionId: submission.id,
          assessmentPass: "secondary",
          llmMode: env.LLM_MODE,
          errorMessage: error instanceof Error ? error.message : "Unknown LLM evaluation error",
        },
        "error",
      );
      throw error;
    }

    await createLlmEvaluationRecord(secondaryLlmResult, "secondary");
    finalLlmResult = secondaryLlmResult;

    const disagreement = evaluateSecondaryAssessmentDisagreement(primaryLlmResult, secondaryLlmResult);
    await recordAuditEvent({
      entityType: "assessment_job",
      entityId: jobId,
      action: "secondary_assessment_completed",
      actorId: submission.userId,
      metadata: {
        submissionId: submission.id,
        hasDisagreement: disagreement.hasDisagreement,
        disagreementReasons: disagreement.reasons,
      },
    });

    if (
      disagreement.hasDisagreement &&
      !shouldSuppressManualReviewForInsufficientEvidenceDisagreement(
        primaryLlmResult,
        secondaryLlmResult,
      )
    ) {
      forceManualReviewReason =
        "Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.";
    }
  }

  await createAssessmentDecision({
    submissionId: submission.id,
    userId: submission.userId,
    moduleVersionId: submission.moduleVersionId,
    rubricVersionId: submission.moduleVersion.rubricVersionId,
    promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
    mcqScaledScore: mcqAttempt.scaledScore,
    mcqPercentScore: mcqAttempt.percentScore,
    llmResult: finalLlmResult,
    forceManualReviewReason,
  });

  await recordAuditEvent({
    entityType: "assessment_job",
    entityId: jobId,
    action: "assessment_job_completed",
    actorId: submission.userId,
    metadata: { submissionId: submission.id },
  });
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
