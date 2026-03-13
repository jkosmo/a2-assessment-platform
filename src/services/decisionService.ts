import { DecisionType, SubmissionStatus } from "../db/prismaRuntime.js";
import { getAssessmentRules } from "../config/assessmentRules.js";
import { decisionRepository } from "../repositories/decisionRepository.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import { recordAuditEvent } from "./auditService.js";
import { upsertRecertificationStatusFromDecision } from "./recertificationService.js";

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

const insufficientEvidencePatterns = [
  "minimal artefact content",
  "minimal content",
  "minimal and non-substantive submission",
  "non-substantive submission",
  "little content",
  "lite innhold",
  "partial documentation",
  "delvis dokumentasjon",
  "placeholder",
  "insufficient evidence",
  "insufficient submission evidence",
  "cannot assess reliably",
  "requires additional materials",
  "additional materials",
  "detailed reflection",
  "iteration/qa notes",
  "no iteration history",
  "no qa checks",
];

function hasInsufficientEvidenceSignal(input: LlmStructuredAssessment): boolean {
  const searchableTexts = [
    input.confidence_note,
    ...Object.values(input.criterion_rationales ?? {}),
    ...(input.improvement_advice ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  return searchableTexts.some((text) => insufficientEvidencePatterns.some((pattern) => text.includes(pattern)));
}

export async function createAssessmentDecision(input: BuildDecisionInput) {
  const rules = getAssessmentRules();
  const practicalScoreScaled = input.llmResult.practical_score_scaled;
  const totalScore = Number((practicalScoreScaled + input.mcqScaledScore).toFixed(2));
  const practicalPercent = (input.llmResult.rubric_total / 20) * 100;

  const hasOpenRedFlag = input.llmResult.red_flags.some((flag) =>
    rules.manualReview.redFlagSeverities.includes(flag.severity.toLowerCase()),
  );
  const inBorderlineWindow =
    totalScore >= rules.manualReview.borderlineWindow.min &&
    totalScore <= rules.manualReview.borderlineWindow.max;

  const passesThresholds =
    totalScore >= rules.thresholds.totalMin &&
    practicalPercent >= rules.thresholds.practicalMinPercent &&
    input.mcqPercentScore >= rules.thresholds.mcqMinPercent &&
    !hasOpenRedFlag;

  const autoFailForInsufficientEvidence =
    !input.forceManualReviewReason &&
    !hasOpenRedFlag &&
    !inBorderlineWindow &&
    !passesThresholds &&
    (hasInsufficientEvidenceSignal(input.llmResult) || input.llmResult.manual_review_recommended);

  const needsManualReview =
    Boolean(input.forceManualReviewReason) ||
    hasOpenRedFlag ||
    inBorderlineWindow ||
    (input.llmResult.manual_review_recommended && !autoFailForInsufficientEvidence);

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
