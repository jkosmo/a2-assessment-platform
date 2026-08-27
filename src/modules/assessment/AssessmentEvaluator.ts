import { env } from "../../config/env.js";
import { createAssessmentJobRepository } from "./assessmentJobRepository.js";
import { runInTransaction } from "../../db/transaction.js";
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
import {
  hasStructuredInsufficientEvidenceSignal,
  matchedInsufficientEvidencePatterns,
  shouldSuppressManualReviewForInsufficientEvidenceDisagreement,
} from "./assessmentDecisionSignals.js";
import type { AssessmentInputContext } from "./AssessmentInputFactory.js";
import { decisionReason, decisionReasonCodes, type DecisionReason } from "./decisionReason.js";

export type EvaluationResult = {
  /** The final LLM result to use for decision-making (secondary result when run, otherwise primary). */
  finalLlmResult: LlmStructuredAssessment;
  /**
   * Set when the primary and secondary assessments disagree in a way that requires manual review.
   * Undefined otherwise.
   *
   * #950: bærer koden sammen med teksten. Var en naken streng, og da måtte mottakeren GJETTE hvilken
   * grunn det var for å kunne oversette den. Typen gjør gjettingen umulig.
   */
  forceManualReviewReason: DecisionReason | undefined;
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

    // #803: persisting the LLM evaluation record + its audit commit atomically. The LLM call itself
    // (evaluatePracticalWithLlm) already ran before this and is not inside the transaction.
    const llmEvaluation = await runInTransaction(async (tx) => {
      const created = await createAssessmentJobRepository(tx).createLlmEvaluation({
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

      await recordAuditEvent(
        {
          entityType: auditEntityTypes.llmEvaluation,
          entityId: created.id,
          action: auditActions.assessment.llmEvaluationCreated,
          actorId: userId,
          metadata: {
            submissionId,
            assessmentPass,
            modelName: created.modelName,
            practicalScoreScaled: created.practicalScoreScaled,
            passFailPractical: created.passFailPractical,
            manualReviewRecommended: created.manualReviewRecommended,
          },
        },
        tx,
      );

      return created;
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
  let forceManualReviewReason: DecisionReason | undefined;

  const secondaryTrigger = evaluateSecondaryAssessmentTrigger({
    moduleId,
    primaryResult: primaryLlmResult,
  });

  // #1023: mål den foreslåtte regelen mot den levende, FØR vi vurderer å bytte.
  //
  // ⚠️ Logges bare ved UENIGHET. Er de enige, er det ingen informasjon i hendelsen, og en logg full
  // av «alt som forventet» blir ikke lest. Er de uenige, er det nettopp det vi vil vite: hvor ofte,
  // og i hvilken retning.
  //
  // Ingen fritekst i metadataen — bare hvilke mønstre som traff og hvilke strukturerte verdier som
  // lå bak. Notatet kan i teorien gjengi noe kandidaten skrev.
  if (secondaryTrigger.shadow && !secondaryTrigger.shadow.agrees) {
    logOperationalEvent(operationalEvents.assessment.secondaryTriggerShadowDiff, {
      jobId,
      submissionId,
      moduleId,
      liveConfidenceTrigger: secondaryTrigger.shadow.liveConfidenceTrigger,
      shadowConfidenceTrigger: secondaryTrigger.shadow.shadowConfidenceTrigger,
      liveShouldRun: secondaryTrigger.shouldRun,
      shadowShouldRun: secondaryTrigger.shadow.shadowShouldRun,
      matchedPatterns: secondaryTrigger.shadow.matchedPatterns,
      evidenceSufficiency: primaryLlmResult.evidence_sufficiency ?? "(ikke satt)",
      manualReviewReasonCode: primaryLlmResult.manual_review_reason_code ?? "(ikke satt)",
    });
  }

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
      forceManualReviewReason = decisionReason(
        decisionReasonCodes.manualReviewLlmDisagreement,
        "Automatically routed to manual review due to disagreement between primary and secondary LLM assessments.",
      );
    }
  }

  // #1026: er delstreng-reserven ALENE om å melde «utilstrekkelig grunnlag»?
  //
  // ⚠️ Da er den det eneste som står mellom en manuell vurdering og automatisk stryk: signalet
  // inngår i `autoFailForInsufficientEvidence` (decisionService.ts), som undertrykker
  // `llmRecommendsManualReview`. Et mønster som «additional material» er en vanlig frase i et
  // forbedringsråd til en GOD besvarelse.
  //
  // ⚠️ MÅLT PÅ `finalLlmResult`, ikke på primærresultatet. QA-porten fant at et første utkast så på
  // primæren — men vedtaket fattes på det ENDELIGE resultatet, som er sekundærvurderingen når en
  // slik kjørte. Et treff som bare finnes i sekundærens råd ville da gitt automatisk stryk uten at
  // noe ble logget, og nettopp de tilfellene saken handler om ville blitt undertalt.
  //
  // Logges bare når reserven er alene. Er de strukturerte feltene enige, er det ingen informasjon
  // i hendelsen.
  const patternOnlyMatches = hasStructuredInsufficientEvidenceSignal(finalLlmResult)
    ? []
    : matchedInsufficientEvidencePatterns(finalLlmResult);
  if (patternOnlyMatches.length > 0) {
    logOperationalEvent(
      operationalEvents.assessment.insufficientEvidencePatternOnly,
      {
        jobId,
        submissionId,
        moduleId,
        // Hvilken vurdering treffet kom fra — primæren eller den andre. Uten dette kan vi ikke se
        // om problemet henger sammen med at en andre vurdering kjørte.
        assessmentPass: finalLlmResult === primaryLlmResult ? "primary" : "secondary",
        matchedPatterns: patternOnlyMatches,
        evidenceSufficiency: finalLlmResult.evidence_sufficiency ?? "(ikke satt)",
        manualReviewReasonCode: finalLlmResult.manual_review_reason_code ?? "(ikke satt)",
        // Det er NÅR denne er sann at treffet koster noe: da fjernes sensoren fra sløyfa.
        llmRecommendedManualReview: finalLlmResult.manual_review_recommended === true,
      },
      // ⚠️ «error», ikke «info». Loggnivåene er bare info og error, og dette er ikke rutine: det er
      // et tilfelle der en frase i et forbedringsråd kan ha fjernet sensoren fra sløyfa. Havner det
      // i info-strømmen, blir det aldri lest. Ingen Azure-alarm matcher på nivå, bare på eventnavn,
      // så det drukner heller ikke ekte feil.
      "error",
    );
  }

  return { finalLlmResult, forceManualReviewReason };
}
