import { DecisionType, SubmissionStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import { getAssessmentRules } from "../config/assessmentRules.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import { recordAuditEvent } from "./auditService.js";

type BuildDecisionInput = {
  submissionId: string;
  userId: string;
  moduleVersionId: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqScaledScore: number;
  mcqPercentScore: number;
  llmResult: LlmStructuredAssessment;
};

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

  const needsManualReview =
    hasOpenRedFlag || input.llmResult.manual_review_recommended || inBorderlineWindow;

  const decision = await prisma.assessmentDecision.create({
    data: {
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
        ? "Automatically routed to manual review due to red flag / confidence / borderline rule."
        : passesThresholds
          ? "Automatic pass by threshold rules."
          : "Automatic fail by threshold rules.",
      finalisedById: input.userId,
    },
  });

  if (needsManualReview) {
    await prisma.manualReview.create({
      data: {
        submissionId: input.submissionId,
        triggerReason: decision.decisionReason,
        reviewStatus: "OPEN",
      },
    });
  }

  await prisma.submission.update({
    where: { id: input.submissionId },
    data: { submissionStatus: needsManualReview ? SubmissionStatus.UNDER_REVIEW : SubmissionStatus.COMPLETED },
  });

  await recordAuditEvent({
    entityType: "assessment_decision",
    entityId: decision.id,
    action: "decision_created",
    actorId: input.userId,
    metadata: {
      submissionId: input.submissionId,
      totalScore,
      needsManualReview,
      passFailTotal: decision.passFailTotal,
    },
  });

  return { decision, needsManualReview };
}
