import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { normalizeLocale } from "../../i18n/locale.js";
import { buildAssessmentInputContext } from "./AssessmentInputFactory.js";
import { runLlmEvaluationPipeline } from "./AssessmentEvaluator.js";
import { applyAssessmentDecision, applyMcqOnlyDecision } from "./AssessmentDecisionApplicationService.js";
import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
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
  const assessmentMode = submission.moduleVersion.assessmentMode;
  const mcqAttempt = submission.mcqAttempts[0];

  // FREETEXT_ONLY (#578) has no MCQ component, so there is no MCQ attempt to wait for. Every other
  // mode must have a completed MCQ before assessment can run. Narrow the scores into locals so the
  // rest of the function has plain numbers (0 for FREETEXT_ONLY).
  let mcqScaledScore = 0;
  let mcqPercentScore = 0;
  if (assessmentMode !== "FREETEXT_ONLY") {
    if (!mcqAttempt || mcqAttempt.scaledScore == null || mcqAttempt.percentScore == null) {
      throw new Error("Cannot assess submission before MCQ completion.");
    }
    mcqScaledScore = mcqAttempt.scaledScore;
    mcqPercentScore = mcqAttempt.percentScore;
  }

  await assessmentJobRepository.updateSubmissionStatus(submission.id, SubmissionStatus.PROCESSING);

  // MCQ_ONLY modules (#525): no free-text, no LLM evaluation. Decide pass/fail purely from the
  // MCQ score and finish — skip the rubric/prompt-based pipeline entirely.
  if (assessmentMode === "MCQ_ONLY") {
    await applyMcqOnlyDecision({
      jobId,
      submissionId: submission.id,
      userId: submission.userId,
      moduleId: submission.moduleId,
      moduleVersionId: submission.moduleVersionId,
      mcqScaledScore,
      mcqPercentScore,
      assessmentPolicy: assessmentPolicyCodec.parse(submission.moduleVersion.assessmentPolicyJson),
      moduleTitle: submission.moduleVersion.module.title,
      submissionLocale,
      submittedAt: submission.submittedAt,
      recipientEmail: submission.user.email,
      recipientName: submission.user.name,
    });
    return;
  }

  // FREETEXT_PLUS_MCQ + FREETEXT_ONLY path: rubric + prompt are required (MCQ_ONLY gated out above).
  const { rubricVersionId, promptTemplateVersionId } = submission.moduleVersion;
  if (rubricVersionId == null || promptTemplateVersionId == null) {
    throw new Error("Free-text module version is missing rubric/prompt configuration.");
  }

  const inputContext = buildAssessmentInputContext(submission, submissionLocale);

  await recordAuditEvent({
    entityType: auditEntityTypes.submission,
    entityId: submission.id,
    action: auditActions.assessment.sensitiveDataPreprocessed,
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
    promptTemplateVersionId,
    inputContext,
  });

  await applyAssessmentDecision({
    jobId,
    submissionId: submission.id,
    userId: submission.userId,
    moduleId: submission.moduleId,
    moduleVersionId: submission.moduleVersionId,
    rubricVersionId,
    promptTemplateVersionId,
    // FREETEXT_ONLY has no MCQ attempt — scores are 0, and freetextOnly tells the decision logic to
    // scale the rubric to the full 0–100 with no MCQ gate.
    mcqScaledScore,
    mcqPercentScore,
    freetextOnly: assessmentMode === "FREETEXT_ONLY",
    llmResult: finalLlmResult,
    forceManualReviewReason,
    assessmentPolicy: inputContext.assessmentPolicy,
    rubricMaxTotal: inputContext.rubricMaxTotal,
    rubricCriteriaIds: inputContext.rubricCriteriaIds,
    moduleTitle: submission.moduleVersion.module.title,
    submissionLocale,
    submittedAt: submission.submittedAt,
    recipientEmail: submission.user.email,
    recipientName: submission.user.name,
  });
}
