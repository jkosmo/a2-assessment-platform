import { DecisionType, SubmissionStatus } from "../../db/prismaRuntime.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { createDecisionRepository } from "../../repositories/decisionRepository.js";
import { runInTransaction } from "../../db/transaction.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { upsertRecertificationStatusFromDecision } from "../certification/index.js";
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
  rubricCriteriaIds?: string[];
};

export type ResolvedAssessmentDecision = {
  totalScore: number;
  practicalPercent: number | null;
  hasOpenRedFlag: boolean;
  passesThresholds: boolean;
  autoFailForInsufficientEvidence: boolean;
  needsManualReview: boolean;
  passFailTotal: boolean;
  decisionReason: string;
};

type ResolveAssessmentDecisionInput = Pick<
  BuildDecisionInput,
  "mcqScaledScore" | "mcqPercentScore" | "llmResult" | "forceManualReviewReason" | "assessmentPolicy" | "rubricMaxTotal" | "rubricCriteriaIds"
>;

export function resolveAssessmentDecision(input: ResolveAssessmentDecisionInput): ResolvedAssessmentDecision {
  const rules = getAssessmentRules();
  const totalMin = input.assessmentPolicy?.passRules?.totalMin ?? rules.thresholds.totalMin;
  const rubricMaxTotal = input.rubricMaxTotal ?? 20;

  // Recompute rubric total server-side: filter to known criteria (if provided),
  // clamp each score to [0,4], then sum. Never trust LLM-reported totals.
  const knownCriteriaIds = input.rubricCriteriaIds ?? [];
  const rawScores = input.llmResult.rubric_scores;
  const validatedScores =
    knownCriteriaIds.length > 0
      ? Object.fromEntries(
          knownCriteriaIds.map((id) => [id, Math.max(0, Math.min(4, rawScores[id] ?? 0))]),
        )
      : Object.fromEntries(
          Object.entries(rawScores).map(([id, score]) => [id, Math.max(0, Math.min(4, score))]),
        );

  const recomputedRubricTotal = Object.values(validatedScores).reduce((sum, s) => sum + s, 0);
  const totalsInconsistent = recomputedRubricTotal !== input.llmResult.rubric_total;

  const recomputedPracticalScoreScaled =
    rubricMaxTotal > 0 ? Number(((recomputedRubricTotal / rubricMaxTotal) * 70).toFixed(2)) : 0;

  const effectivePracticalScaledScore =
    input.assessmentPolicy?.scoring?.practicalWeight != null
      ? (recomputedPracticalScoreScaled / rules.weights.practicalMaxScore) * input.assessmentPolicy.scoring.practicalWeight
      : recomputedPracticalScoreScaled;
  const effectiveMcqScaledScore =
    input.assessmentPolicy?.scoring?.mcqWeight != null
      ? (input.mcqPercentScore / 100) * input.assessmentPolicy.scoring.mcqWeight
      : input.mcqScaledScore;
  const totalScore = Number((effectivePracticalScaledScore + effectiveMcqScaledScore).toFixed(2));
  const practicalPercent = rubricMaxTotal > 0 ? (recomputedRubricTotal / rubricMaxTotal) * 100 : null;

  const mcqMinPercent = input.assessmentPolicy?.passRules?.mcqMinPercent ?? null;
  const practicalMinPercent = input.assessmentPolicy?.passRules?.practicalMinPercent ?? null;

  const hasOpenRedFlag = hasForcingRedFlag(input.llmResult, rules.manualReview.redFlagSeverities);
  const hasOnlyInsufficientEvidenceFlags = hasOnlyInsufficientEvidenceRedFlags(input.llmResult);

  const mcqGatePasses = mcqMinPercent === null || input.mcqPercentScore >= mcqMinPercent;
  const practicalGatePasses =
    practicalMinPercent === null ||
    (practicalPercent !== null && practicalPercent >= practicalMinPercent);

  const passesThresholds =
    totalScore >= totalMin && !hasOpenRedFlag && mcqGatePasses && practicalGatePasses;

  const llmRecommendsManualReview = recommendsManualReview(input.llmResult);

  const autoFailForInsufficientEvidence =
    !input.forceManualReviewReason &&
    !hasOpenRedFlag &&
    !passesThresholds &&
    (hasInsufficientEvidenceSignal(input.llmResult) || hasOnlyInsufficientEvidenceFlags);

  // v1.2.20 (#464): borderline-window — totalScore i [min, max] router til manuell
  // vurdering. Overstyrer auto-pass selv om threshold-rules ellers passerer. Brukes til
  // grensetilfeller forfatter vil ha assessor til å se på.
  const borderlineWindow = input.assessmentPolicy?.passRules?.borderlineWindow;
  const isInBorderlineWindow =
    borderlineWindow !== undefined &&
    typeof borderlineWindow.min === "number" &&
    typeof borderlineWindow.max === "number" &&
    totalScore >= borderlineWindow.min &&
    totalScore <= borderlineWindow.max;

  const needsManualReview =
    Boolean(input.forceManualReviewReason) ||
    totalsInconsistent ||
    hasOpenRedFlag ||
    (llmRecommendsManualReview && !autoFailForInsufficientEvidence) ||
    isInBorderlineWindow;

  const componentFailReason = !mcqGatePasses
    ? "Automatic fail: MCQ score below required minimum."
    : !practicalGatePasses
      ? "Automatic fail: practical score below required minimum."
      : null;

  const decisionReason = needsManualReview
    ? input.forceManualReviewReason ??
      (totalsInconsistent
        ? "LLM score inconsistency detected — routed to manual review."
        : isInBorderlineWindow
          ? `Routed to manual review: total score ${totalScore} is in the borderline window [${borderlineWindow!.min}, ${borderlineWindow!.max}].`
          : "Automatically routed to manual review due to red flag / confidence rule.")
    : autoFailForInsufficientEvidence
      ? "Automatic fail due to insufficient submission evidence."
      : passesThresholds
        ? "Automatic pass by threshold rules."
        : componentFailReason ?? "Automatic fail by threshold rules.";

  return {
    totalScore,
    practicalPercent,
    hasOpenRedFlag,
    passesThresholds,
    autoFailForInsufficientEvidence,
    needsManualReview,
    // v1.2.20 (#464): passFailTotal er false når i borderline-window — kandidaten har
    // ikke automatisk bestått selv om threshold-rules ellers passerte. Assessor må
    // bekrefte.
    passFailTotal: passesThresholds && !isInBorderlineWindow,
    decisionReason,
  };
}

// Default MCQ pass threshold (percent) for MCQ-only modules when the author has not set an
// explicit assessmentPolicy.passRules.mcqMinPercent (#525).
export const DEFAULT_MCQ_ONLY_MIN_PERCENT = 70;

type BuildMcqOnlyDecisionInput = {
  submissionId: string;
  userId: string;
  moduleVersionId: string;
  mcqScaledScore: number;
  mcqPercentScore: number;
  assessmentPolicy?: ModuleAssessmentPolicy | null;
};

/**
 * Decision for an MCQ_ONLY module (#525): no free-text, no LLM evaluation. Pass/fail is decided
 * purely by the MCQ score against a threshold (author-configurable via
 * assessmentPolicy.passRules.mcqMinPercent, defaulting to 70%). Always an AUTOMATIC decision —
 * there is no rubric, red-flag or manual-review path.
 */
export function resolveMcqOnlyDecision(
  mcqPercentScore: number,
  mcqMinPercent: number,
): { passFailTotal: boolean; decisionReason: string } {
  const passFailTotal = mcqPercentScore >= mcqMinPercent;
  // Round the displayed score to 2 decimals (raw can be e.g. 66.6666… ) — #546 feedback.
  const shownScore = Math.round(mcqPercentScore * 100) / 100;
  const decisionReason = passFailTotal
    ? `Automatic pass: MCQ score ${shownScore}% meets the required minimum of ${mcqMinPercent}%.`
    : `Automatic fail: MCQ score ${shownScore}% is below the required minimum of ${mcqMinPercent}%.`;
  return { passFailTotal, decisionReason };
}

export async function createMcqOnlyDecision(input: BuildMcqOnlyDecisionInput) {
  const mcqMinPercent =
    input.assessmentPolicy?.passRules?.mcqMinPercent ?? DEFAULT_MCQ_ONLY_MIN_PERCENT;
  const { passFailTotal, decisionReason } = resolveMcqOnlyDecision(input.mcqPercentScore, mcqMinPercent);

  return runInTransaction(async (tx) => {
    const repo = createDecisionRepository(tx);

    const decision = await repo.createAssessmentDecision({
      submissionId: input.submissionId,
      moduleVersionId: input.moduleVersionId,
      rubricVersionId: null,
      promptTemplateVersionId: null,
      mcqScaledScore: input.mcqScaledScore,
      practicalScaledScore: 0,
      totalScore: input.mcqScaledScore,
      redFlagsJson: redFlagsCodec.serialize([]),
      passFailTotal,
      decisionType: DecisionType.AUTOMATIC,
      decisionReason,
      finalisedById: input.userId,
    });

    await repo.updateSubmissionStatus(input.submissionId, SubmissionStatus.COMPLETED);

    await upsertRecertificationStatusFromDecision({
      decisionId: decision.id,
      actorId: input.userId,
    }, tx);

    await recordAuditEvent({
      entityType: auditEntityTypes.assessmentDecision,
      entityId: decision.id,
      action: auditActions.assessment.decisionCreated,
      actorId: input.userId,
      metadata: {
        submissionId: input.submissionId,
        totalScore: input.mcqScaledScore,
        needsManualReview: false,
        assessmentMode: "MCQ_ONLY",
        passFailTotal: decision.passFailTotal,
      },
    }, tx);

    return { decision, needsManualReview: false as const };
  });
}

export async function createAssessmentDecision(input: BuildDecisionInput) {
  const practicalScoreScaled = input.llmResult.practical_score_scaled;
  const resolved = resolveAssessmentDecision(input);

  return runInTransaction(async (tx) => {
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
        entityType: auditEntityTypes.manualReview,
        entityId: review.id,
        action: auditActions.manualReview.opened,
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
      entityType: auditEntityTypes.assessmentDecision,
      entityId: decision.id,
      action: auditActions.assessment.decisionCreated,
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
