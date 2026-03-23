import { env } from "../../config/env.js";
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { evaluatePracticalWithLlm, type LlmStructuredAssessment } from "./llmAssessmentService.js";
import { llmResponseCodec } from "../../codecs/llmResponseCodec.js";
import { sha256 } from "../../utils/hash.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import {
  evaluateSecondaryAssessmentDisagreement,
  evaluateSecondaryAssessmentTrigger,
} from "./secondaryAssessmentService.js";
import { shouldSuppressManualReviewForInsufficientEvidenceDisagreement } from "./assessmentDecisionSignals.js";
import type { AssessmentInputContext } from "./AssessmentInputFactory.js";

export type EvaluationResult = {
  /** The final LLM result to use for decision-making (secondary result when run, otherwise primary). */
  finalLlmResult: LlmStructuredAssessment;
  /**
   * Set when the primary and secondary assessments disagree in a way that requires manual review.
   * Undefined otherwise.
   */
  forceManualReviewReason: string | undefined;
};

type EvaluatorContext = {
  jobId: string;
  submissionId: string;
  userId: string;
  moduleId: string;
  moduleVersionId: string;
  promptTemplateVersionId: string;
  inputContext: AssessmentInputContext;
};

/**
 * Runs the LLM evaluation pipeline for an assessment job:
 * 1. Primary LLM call
 * 2. Records the primary LLM evaluation to the database
 * 3. Optionally runs a secondary LLM call based on the secondary assessment trigger policy
 * 4. Records the secondary LLM evaluation and evaluates disagreement
 * Returns the final LLM result and an optional force-manual-review reason.
 */
export async function runLlmEvaluationPipeline(ctx: EvaluatorContext): Promise<EvaluationResult> {
  const { jobId, submissionId, userId, moduleId, moduleVersionId, promptTemplateVersionId, inputContext } = ctx;
  const { sensitiveDataPreprocess, rubricCriteriaIds, submissionFieldLabels } = inputContext;

  const createLlmEvaluationRecord = async (
    llmResult: LlmStructuredAssessment,
    assessmentPass: "primary" | "secondary",
  ) => {
    const requestPayload = {
      moduleId,
      moduleVersionId,
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
      submissionId,
      moduleVersionId,
      modelName:
        env.LLM_MODE === "stub"
          ? `${env.LLM_STUB_MODEL_NAME}:${assessmentPass}`
          : `${env.AZURE_OPENAI_DEPLOYMENT ?? "azure_openai"}:${assessmentPass}`,
      promptTemplateVersionId,
      requestPayloadHash: sha256(JSON.stringify(requestPayload)),
      responseJson: llmResponseCodec.serialize(llmResult),
      rubricTotal: llmResult.rubric_total,
      practicalScoreScaled: llmResult.practical_score_scaled,
      passFailPractical: llmResult.pass_fail_practical,
      manualReviewRecommended: llmResult.manual_review_recommended,
      confidenceNote: llmResult.confidence_note,
    });

    await recordAuditEvent({
      entityType: auditEntityTypes.llmEvaluation,
      entityId: llmEvaluation.id,
      action: auditActions.assessment.llmEvaluationCreated,
      actorId: userId,
      metadata: {
        submissionId,
        assessmentPass,
        modelName: llmEvaluation.modelName,
        practicalScoreScaled: llmEvaluation.practicalScoreScaled,
        passFailPractical: llmEvaluation.passFailPractical,
        manualReviewRecommended: llmEvaluation.manualReviewRecommended,
      },
    });

    return llmEvaluation;
  };

  // --- Primary assessment pass ---
  let primaryLlmResult: LlmStructuredAssessment;
  try {
    primaryLlmResult = await evaluatePracticalWithLlm({
      moduleId,
      responseJson: sensitiveDataPreprocess.payload.responseJson,
      responseLocale: inputContext.submissionLocale,
      assessmentPass: "primary",
      promptTemplateSystem: inputContext.promptTemplateSystem,
      promptTemplateUserTemplate: inputContext.promptTemplateUserTemplate,
      promptTemplateExamplesJson: inputContext.promptTemplateExamplesJson,
      moduleTaskText: inputContext.moduleTaskText,
      moduleGuidanceText: inputContext.moduleGuidanceText,
      rubricCriteriaIds,
      submissionFieldLabels,
    });
  } catch (error) {
    logOperationalEvent(
      operationalEvents.assessment.llmEvaluationFailed,
      {
        jobId,
        submissionId,
        assessmentPass: "primary",
        llmMode: env.LLM_MODE,
        errorMessage: error instanceof Error ? error.message : "Unknown LLM evaluation error",
      },
      "error",
    );
    throw error;
  }
  await createLlmEvaluationRecord(primaryLlmResult, "primary");

  // --- Secondary assessment pass (conditional) ---
  let finalLlmResult: LlmStructuredAssessment = primaryLlmResult;
  let forceManualReviewReason: string | undefined;

  const secondaryTrigger = evaluateSecondaryAssessmentTrigger({
    moduleId,
    primaryResult: primaryLlmResult,
  });

  if (secondaryTrigger.shouldRun) {
    await recordAuditEvent({
      entityType: auditEntityTypes.assessmentJob,
      entityId: jobId,
      action: auditActions.assessment.secondaryAssessmentTriggered,
      actorId: userId,
      metadata: {
        submissionId,
        reasons: secondaryTrigger.reasons,
      },
    });

    let secondaryLlmResult: LlmStructuredAssessment;
    try {
      secondaryLlmResult = await evaluatePracticalWithLlm({
        moduleId,
        responseJson: sensitiveDataPreprocess.payload.responseJson,
        responseLocale: inputContext.submissionLocale,
        assessmentPass: "secondary",
        promptTemplateSystem: inputContext.promptTemplateSystem,
        promptTemplateUserTemplate: inputContext.promptTemplateUserTemplate,
        promptTemplateExamplesJson: inputContext.promptTemplateExamplesJson,
        moduleTaskText: inputContext.moduleTaskText,
        moduleGuidanceText: inputContext.moduleGuidanceText,
        rubricCriteriaIds,
        submissionFieldLabels,
      });
    } catch (error) {
      logOperationalEvent(
        operationalEvents.assessment.llmEvaluationFailed,
        {
          jobId,
          submissionId,
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
      entityType: auditEntityTypes.assessmentJob,
      entityId: jobId,
      action: auditActions.assessment.secondaryAssessmentCompleted,
      actorId: userId,
      metadata: {
        submissionId,
        hasDisagreement: disagreement.hasDisagreement,
        disagreementReasons: disagreement.reasons,
      },
    });

    if (
      disagreement.hasDisagreement &&
      !shouldSuppressManualReviewForInsufficientEvidenceDisagreement(primaryLlmResult, secondaryLlmResult)
    ) {
      forceManualReviewReason =
        "Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.";
    }
  }

  return { finalLlmResult, forceManualReviewReason };
}
