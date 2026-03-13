import { DecisionType, SubmissionStatus } from "../db/prismaRuntime.js";
import { getAssessmentRules } from "../config/assessmentRules.js";
import { decisionRepository } from "../repositories/decisionRepository.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import { recordAuditEvent } from "./auditService.js";
import { upsertRecertificationStatusFromDecision } from "./recertificationService.js";
import {
  hasForcingRedFlag,
  hasInsufficientEvidenceSignal,
  hasOnlyInsufficientEvidenceRedFlags,
  recommendsManualReview,
} from "./assessmentDecisionSignals.js";

type BuildDecisionInput = {
  submissionId: string;
  userId: string;
  moduleVersionId: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqScaledScore: number;
  mcqPercentScore: number;
  llmResult: LlmStructuredAssessment;
  forceManualReviewReason?: string;
};

export async function createAssessmentDecision(input: BuildDecisionInput) {
  const rules = getAssessmentRules();
  const practicalScoreScaled = input.llmResult.practical_score_scaled;
  const totalScore = Number((practicalScoreScaled + input.mcqScaledScore).toFixed(2));
  const practicalPercent = (input.llmResult.rubric_total / 20) * 100;

  const hasOpenRedFlag = hasForcingRedFlag(input.llmResult, rules.manualReview.redFlagSeverities);
  const hasOnlyInsufficientEvidenceFlags = hasOnlyInsufficientEvidenceRedFlags(input.llmResult);
  const inBorderlineWindow =
    totalScore >= rules.manualReview.borderlineWindow.min &&
    totalScore <= rules.manualReview.borderlineWindow.max;

  const passesThresholds =
    totalScore >= rules.thresholds.totalMin &&
    practicalPercent >= rules.thresholds.practicalMinPercent &&
    input.mcqPercentScore >= rules.thresholds.mcqMinPercent &&
    !hasOpenRedFlag;
  const llmRecommendsManualReview = recommendsManualReview(input.llmResult);

  const autoFailForInsufficientEvidence =
    !input.forceManualReviewReason &&
    !hasOpenRedFlag &&
    !inBorderlineWindow &&
    !passesThresholds &&
    (hasInsufficientEvidenceSignal(input.llmResult) || hasOnlyInsufficientEvidenceFlags);

  const needsManualReview =
    Boolean(input.forceManualReviewReason) ||
    hasOpenRedFlag ||
    inBorderlineWindow ||
    (llmRecommendsManualReview && !autoFailForInsufficientEvidence);

  const decision = await decisionRepository.createAssessmentDecision({
    submissionId: input.submissionId,
    moduleVersionId: input.moduleVersionId,
    rubricVersionId: input.rubricVersionId,
    promptTemplateVersionId: input.promptTemplateVersionId,
    mcqScaledScore: input.mcqScaledScore,
    practicalScaledScore: practicalScoreScaled,
    totalScore,
    redFlagsJson: JSON.stringify(input.llmResult.red_flags),
    passFailTotal: passesThresholds,
    decisionType: DecisionType.AUTOMATIC,
    decisionReason: needsManualReview
      ? input.forceManualReviewReason ??
        "Automatically routed to manual review due to red flag / confidence / borderline rule."
      : autoFailForInsufficientEvidence
        ? "Automatic fail due to insufficient submission evidence."
      : passesThresholds
        ? "Automatic pass by threshold rules."
        : "Automatic fail by threshold rules.",
    finalisedById: input.userId,
  });

  if (needsManualReview) {
    const review = await decisionRepository.createManualReview({
      submissionId: input.submissionId,
      triggerReason: decision.decisionReason,
      reviewStatus: "OPEN",
    });

    await recordAuditEvent({
      entityType: "manual_review",
      entityId: review.id,
      action: "manual_review_opened",
      actorId: input.userId,
      metadata: {
        submissionId: input.submissionId,
        decisionId: decision.id,
        triggerReason: review.triggerReason,
      },
    });
  }

  await decisionRepository.updateSubmissionStatus(
    input.submissionId,
    needsManualReview ? SubmissionStatus.UNDER_REVIEW : SubmissionStatus.COMPLETED,
  );

  if (!needsManualReview) {
    await upsertRecertificationStatusFromDecision({
      decisionId: decision.id,
      actorId: input.userId,
    });
  }

  await recordAuditEvent({
    entityType: "assessment_decision",
    entityId: decision.id,
    action: "decision_created",
    actorId: input.userId,
    metadata: {
      submissionId: input.submissionId,
      totalScore,
      needsManualReview,
      forceManualReviewReason: input.forceManualReviewReason ?? null,
      passFailTotal: decision.passFailTotal,
    },
  });

  return { decision, needsManualReview };
}
