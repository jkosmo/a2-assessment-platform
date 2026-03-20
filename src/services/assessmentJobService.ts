import { SubmissionStatus } from "../db/prismaRuntime.js";
import { assessmentJobRepository } from "../repositories/assessmentJobRepository.js";
import { recordAuditEvent } from "./auditService.js";
import { normalizeLocale } from "../i18n/locale.js";
import { buildAssessmentInputContext } from "./AssessmentInputFactory.js";
import { runLlmEvaluationPipeline } from "./AssessmentEvaluator.js";
import { applyAssessmentDecision } from "./AssessmentDecisionApplicationService.js";
import {
  processAssessmentJobsNow as runnerProcessAssessmentJobsNow,
  processSubmissionJobNow as runnerProcessSubmissionJobNow,
  processNextJob as runnerProcessNextJob,
} from "./AssessmentJobRunner.js";

export { enqueueAssessmentJob } from "./AssessmentJobRunner.js";

export async function processAssessmentJobsNow(maxJobs = 1) {
  return runnerProcessAssessmentJobsNow(runAssessment, maxJobs);
}

export async function processSubmissionJobNow(submissionId: string, maxCycles = 25) {
  return runnerProcessSubmissionJobNow(runAssessment, submissionId, maxCycles);
}

export async function processNextJob(submissionId?: string): Promise<boolean> {
  return runnerProcessNextJob(runAssessment, submissionId);
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

  const inputContext = buildAssessmentInputContext(submission, submissionLocale);

  await recordAuditEvent({
    entityType: "submission",
    entityId: submission.id,
    action: "sensitive_data_preprocessed",
    actorId: submission.userId,
    metadata: {
      moduleId: submission.moduleId,
      maskingEnabled: inputContext.sensitiveDataPreprocess.maskingEnabled,
      maskingApplied: inputContext.sensitiveDataPreprocess.maskingApplied,
      totalMatches: inputContext.sensitiveDataPreprocess.totalMatches,
      ruleHits: inputContext.sensitiveDataPreprocess.ruleHits,
      fieldsMasked: inputContext.sensitiveDataPreprocess.fieldsMasked,
    },
  });

  const { finalLlmResult, forceManualReviewReason } = await runLlmEvaluationPipeline({
    jobId,
    submissionId: submission.id,
    userId: submission.userId,
    moduleId: submission.moduleId,
    moduleVersionId: submission.moduleVersionId,
    promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
    inputContext,
  });

  await applyAssessmentDecision({
    jobId,
    submissionId: submission.id,
    userId: submission.userId,
    moduleId: submission.moduleId,
    moduleVersionId: submission.moduleVersionId,
    rubricVersionId: submission.moduleVersion.rubricVersionId,
    promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
    mcqScaledScore: mcqAttempt.scaledScore,
    mcqPercentScore: mcqAttempt.percentScore,
    llmResult: finalLlmResult,
    forceManualReviewReason,
    assessmentPolicy: inputContext.assessmentPolicy,
    rubricMaxTotal: inputContext.rubricMaxTotal,
    moduleTitle: submission.moduleVersion.module.title,
    submissionLocale,
    submittedAt: submission.submittedAt,
    recipientEmail: submission.user.email,
    recipientName: submission.user.name,
  });
}
