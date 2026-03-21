import { DecisionType, SubmissionStatus } from "../../db/prismaRuntime.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { createDecisionRepository } from "../../repositories/decisionRepository.js";
import { prisma } from "../../db/prisma.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { upsertRecertificationStatusFromDecision } from "../../services/recertificationService.js";
import {
  hasForcingRedFlag,
  hasInsufficientEvidenceSignal,
  hasOnlyInsufficientEvidenceRedFlags,
  recommendsManualReview,
} from "./assessmentDecisionSignals.js";
import { redFlagsCodec } from "../../codecs/redFlagsCodec.js";
import type { ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";
export type { ModuleAssessmentPolicy };

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
  assessmentPolicy?: ModuleAssessmentPolicy | null;
  rubricMaxTotal?: number;
};

export type ResolvedAssessmentDecision = {
  totalScore: number;
  practicalPercent: number | null;
  hasOpenRedFlag: boolean;
  inBorderlineWindow: boolean;
  passesThresholds: boolean;
  autoFailForInsufficientEvidence: boolean;
  needsManualReview: boolean;
  passFailTotal: boolean;
  decisionReason: string;
};

type ResolveAssessmentDecisionInput = Pick<
  BuildDecisionInput,
  "mcqScaledScore" | "mcqPercentScore" | "llmResult" | "forceManualReviewReason" | "assessmentPolicy" | "rubricMaxTotal"
>;

export function resolveAssessmentDecision(input: ResolveAssessmentDecisionInput): ResolvedAssessmentDecision {
  const rules = getAssessmentRules();
  const totalMin = input.assessmentPolicy?.passRules?.totalMin ?? rules.thresholds.totalMin;
  const practicalMinPercent =
    input.assessmentPolicy?.passRules?.practicalMinPercent ?? rules.thresholds.practicalMinPercent;
  const mcqMinPercent =
    input.assessmentPolicy?.passRules?.mcqMinPercent ?? rules.thresholds.mcqMinPercent;
  const borderlineMin =
    input.assessmentPolicy?.passRules?.borderlineWindow?.min ?? rules.manualReview.borderlineWindow.min;
  const borderlineMax =
    input.assessmentPolicy?.passRules?.borderlineWindow?.max ?? rules.manualReview.borderlineWindow.max;

  const practicalScoreScaled = input.llmResult.practical_score_scaled;
  const effectivePracticalScaledScore = input.assessmentPolicy?.scoring?.practicalWeight != null
    ? (practicalScoreScaled / rules.weights.practicalMaxScore) * input.assessmentPolicy.scoring.practicalWeight
    : practicalScoreScaled;
  const effectiveMcqScaledScore = input.assessmentPolicy?.scoring?.mcqWeight != null
    ? (input.mcqPercentScore / 100) * input.assessmentPolicy.scoring.mcqWeight
    : input.mcqScaledScore;
  const totalScore = Number((effectivePracticalScaledScore + effectiveMcqScaledScore).toFixed(2));
  const rubricMaxTotal = input.rubricMaxTotal ?? 20;
  // When there is no submission scoring component (rubricMaxTotal === 0), skip the
  // practicalMinPercent gate entirely — it cannot be evaluated and should not block passing.
  const practicalPercent = rubricMaxTotal > 0
    ? (input.llmResult.rubric_total / rubricMaxTotal) * 100
    : null;

  const hasOpenRedFlag = hasForcingRedFlag(input.llmResult, rules.manualReview.redFlagSeverities);
  const hasOnlyInsufficientEvidenceFlags = hasOnlyInsufficientEvidenceRedFlags(input.llmResult);
  const inBorderlineWindow =
    totalScore >= borderlineMin &&
    totalScore <= borderlineMax;

  const passesThresholds =
    totalScore >= totalMin &&
    (practicalPercent === null || practicalPercent >= practicalMinPercent) &&
    input.mcqPercentScore >= mcqMinPercent &&
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

  const decisionReason = needsManualReview
    ? input.forceManualReviewReason ??
      "Automatically routed to manual review due to red flag / confidence / borderline rule."
    : autoFailForInsufficientEvidence
      ? "Automatic fail due to insufficient submission evidence."
      : passesThresholds
        ? "Automatic pass by threshold rules."
        : "Automatic fail by threshold rules.";

  return {
    totalScore,
    practicalPercent,
    hasOpenRedFlag,
    inBorderlineWindow,
    passesThresholds,
    autoFailForInsufficientEvidence,
    needsManualReview,
    passFailTotal: passesThresholds,
    decisionReason,
  };
}

export async function createAssessmentDecision(input: BuildDecisionInput) {
  const practicalScoreScaled = input.llmResult.practical_score_scaled;
  const resolved = resolveAssessmentDecision(input);

  return prisma.$transaction(async (tx) => {
    const repo = createDecisionRepository(tx);

    const decision = await repo.createAssessmentDecision({
      submissionId: input.submissionId,
      moduleVersionId: input.moduleVersionId,
      rubricVersionId: input.rubricVersionId,
      promptTemplateVersionId: input.promptTemplateVersionId,
      mcqScaledScore: input.mcqScaledScore,
      practicalScaledScore: practicalScoreScaled,
      totalScore: resolved.totalScore,
      redFlagsJson: redFlagsCodec.serialize(input.llmResult.red_flags),
      passFailTotal: resolved.passFailTotal,
      decisionType: DecisionType.AUTOMATIC,
      decisionReason: resolved.decisionReason,
      finalisedById: input.userId,
    });

    if (resolved.needsManualReview) {
      const review = await repo.createManualReview({
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
      }, tx);
    }

    await repo.updateSubmissionStatus(
      input.submissionId,
      resolved.needsManualReview ? SubmissionStatus.UNDER_REVIEW : SubmissionStatus.COMPLETED,
    );

    if (!resolved.needsManualReview) {
      await upsertRecertificationStatusFromDecision({
        decisionId: decision.id,
        actorId: input.userId,
      }, tx);
    }

    await recordAuditEvent({
      entityType: "assessment_decision",
      entityId: decision.id,
      action: "decision_created",
      actorId: input.userId,
      metadata: {
        submissionId: input.submissionId,
        totalScore: resolved.totalScore,
        needsManualReview: resolved.needsManualReview,
        forceManualReviewReason: input.forceManualReviewReason ?? null,
        passFailTotal: decision.passFailTotal,
      },
    }, tx);

    return { decision, needsManualReview: resolved.needsManualReview };
  });
}
