import { SubmissionStatus } from "../db/prismaRuntime.js";
import { env } from "../config/env.js";
import { assessmentJobRepository } from "../repositories/assessmentJobRepository.js";
import { evaluatePracticalWithLlm } from "./llmAssessmentService.js";
import { sha256 } from "../utils/hash.js";
import { createAssessmentDecision, type ModuleAssessmentPolicy } from "./decisionService.js";
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
import { notifyAssessmentResult } from "./participantNotificationService.js";
import {
  enqueueAssessmentJob as runnerEnqueueAssessmentJob,
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

  const assessmentPolicy: ModuleAssessmentPolicy | null = submission.moduleVersion.assessmentPolicyJson
    ? (() => {
        try {
          return JSON.parse(submission.moduleVersion.assessmentPolicyJson) as ModuleAssessmentPolicy;
        } catch {
          return null;
        }
      })()
    : null;

  const rubricCriteriaIds = parseRubricCriteriaIds(submission.moduleVersion.rubricVersion.criteriaJson);
  const rubricMaxTotal = parseRubricMaxTotal(submission.moduleVersion.rubricVersion.scalingRuleJson);
  const submissionFieldLabels = parseSubmissionFieldLabels(submission.moduleVersion.submissionSchemaJson);

  if (!mcqAttempt || mcqAttempt.scaledScore == null || mcqAttempt.percentScore == null) {
    throw new Error("Cannot assess submission before MCQ completion.");
  }

  await assessmentJobRepository.updateSubmissionStatus(submission.id, SubmissionStatus.PROCESSING);

  const sensitiveDataPreprocess = preprocessSensitiveDataForLlm({
    moduleId: submission.moduleId,
    responseJson: JSON.parse(submission.responseJson) as Record<string, unknown>,
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
      responseJson: sensitiveDataPreprocess.payload.responseJson,
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
      responseJson: sensitiveDataPreprocess.payload.responseJson,
      responseLocale: submissionLocale,
      assessmentPass: "primary",
      promptTemplateSystem: submission.moduleVersion.promptTemplateVersion.systemPrompt,
      promptTemplateUserTemplate: submission.moduleVersion.promptTemplateVersion.userPromptTemplate,
      promptTemplateExamplesJson: submission.moduleVersion.promptTemplateVersion.examplesJson,
      moduleTaskText: localizeContentText(submissionLocale, submission.moduleVersion.taskText) ?? submission.moduleVersion.taskText,
      moduleGuidanceText: localizeContentText(submissionLocale, submission.moduleVersion.guidanceText) ?? undefined,
      rubricCriteriaIds,
      submissionFieldLabels,
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
        responseJson: sensitiveDataPreprocess.payload.responseJson,
        responseLocale: submissionLocale,
        assessmentPass: "secondary",
        promptTemplateSystem: submission.moduleVersion.promptTemplateVersion.systemPrompt,
        promptTemplateUserTemplate: submission.moduleVersion.promptTemplateVersion.userPromptTemplate,
        promptTemplateExamplesJson: submission.moduleVersion.promptTemplateVersion.examplesJson,
        moduleTaskText: localizeContentText(submissionLocale, submission.moduleVersion.taskText) ?? submission.moduleVersion.taskText,
        moduleGuidanceText: localizeContentText(submissionLocale, submission.moduleVersion.guidanceText) ?? undefined,
        rubricCriteriaIds,
        submissionFieldLabels,
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

  const decisionResult = await createAssessmentDecision({
    submissionId: submission.id,
    userId: submission.userId,
    moduleVersionId: submission.moduleVersionId,
    rubricVersionId: submission.moduleVersion.rubricVersionId,
    promptTemplateVersionId: submission.moduleVersion.promptTemplateVersionId,
    mcqScaledScore: mcqAttempt.scaledScore,
    mcqPercentScore: mcqAttempt.percentScore,
    llmResult: finalLlmResult,
    forceManualReviewReason,
    assessmentPolicy,
    rubricMaxTotal,
  });

  if (!decisionResult.needsManualReview) {
    const moduleTitle = localizeContentText(submissionLocale, submission.moduleVersion.module.title) ?? submission.moduleId;
    notifyAssessmentResult({
      submissionId: submission.id,
      submittedAt: submission.submittedAt,
      recipientEmail: submission.user.email,
      recipientName: submission.user.name,
      moduleTitle,
      moduleId: submission.moduleId,
      passFailTotal: decisionResult.decision.passFailTotal,
      locale: submissionLocale,
    }).catch((error: unknown) => {
      logOperationalEvent(
        "participant_notification_failed",
        {
          submissionId: submission.id,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
        "error",
      );
    });
  }

  await recordAuditEvent({
    entityType: "assessment_job",
    entityId: jobId,
    action: "assessment_job_completed",
    actorId: submission.userId,
    metadata: { submissionId: submission.id },
  });
}

function parseRubricCriteriaIds(criteriaJson: string): string[] {
  try {
    const parsed = JSON.parse(criteriaJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((c: { id?: string }) => c.id).filter((id): id is string => typeof id === "string");
    }
    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed as Record<string, unknown>);
    }
  } catch {
    // fall through
  }
  return [];
}

function parseRubricMaxTotal(scalingRuleJson: string): number {
  try {
    const parsed = JSON.parse(scalingRuleJson) as { max_total?: unknown };
    if (typeof parsed.max_total === "number") {
      return parsed.max_total;
    }
  } catch {
    // fall through
  }
  return 20;
}

function parseSubmissionFieldLabels(submissionSchemaJson: string | null | undefined): string[] {
  if (!submissionSchemaJson) return [];
  try {
    const parsed = JSON.parse(submissionSchemaJson) as {
      fields?: Array<{ label?: string | Record<string, string>; id?: string }>;
    };
    if (!Array.isArray(parsed.fields)) return [];
    return parsed.fields
      .map((field) => {
        const label = field.label;
        if (!label) return field.id ?? "";
        if (typeof label === "object") return label["en-GB"] ?? Object.values(label)[0] ?? field.id ?? "";
        return label;
      })
      .filter((label) => label.length > 0);
  } catch {
    return [];
  }
}
