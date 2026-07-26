import { createAssessmentDecision, createMcqOnlyDecision, type ModuleAssessmentPolicy } from "./decisionService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { enqueueOutboxEvents, OUTBOX_EVENT_TYPES } from "../outbox/outboxService.js";
import { localizeContentText } from "../../i18n/content.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import type { SupportedLocale } from "../../i18n/locale.js";

type ApplyDecisionInput = {
  jobId: string;
  submissionId: string;
  userId: string;
  moduleId: string;
  moduleVersionId: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqScaledScore: number;
  mcqPercentScore: number;
  llmResult: LlmStructuredAssessment;
  forceManualReviewReason: string | undefined;
  assessmentPolicy: ModuleAssessmentPolicy | null;
  rubricMaxTotal: number;
  rubricCriteriaIds: string[];
  /** #578: FREETEXT_ONLY — practical/LLM-only scoring, no MCQ component. */
  freetextOnly?: boolean;
  /** #475: AI-influence review trigger (undefined = no trigger). Routes to review, never fails. */
  aiInfluence?: { forcesReview: boolean; reason: string };
  /** Localized module title text (may be a raw localization JSON string). */
  moduleTitle: string;
  submissionLocale: SupportedLocale;
  submittedAt: Date;
  recipientEmail: string;
  recipientName: string;
};

/**
 * Orchestrates the final phase of an assessment job:
 * 1. Creates the assessment decision (via decisionService, already transactional)
 * 2. Sends participant notification when no manual review is needed
 * 3. Writes the job-completion audit event
 *
 * Aligns with the transactional command work implemented in decisionService.ts
 * (prisma.$transaction already wraps createAssessmentDecision internally).
 */
export async function applyAssessmentDecision(input: ApplyDecisionInput): Promise<void> {
  const decisionResult = await createAssessmentDecision({
    submissionId: input.submissionId,
    userId: input.userId,
    moduleVersionId: input.moduleVersionId,
    rubricVersionId: input.rubricVersionId,
    promptTemplateVersionId: input.promptTemplateVersionId,
    mcqScaledScore: input.mcqScaledScore,
    mcqPercentScore: input.mcqPercentScore,
    llmResult: input.llmResult,
    forceManualReviewReason: input.forceManualReviewReason,
    assessmentPolicy: input.assessmentPolicy,
    rubricMaxTotal: input.rubricMaxTotal,
    rubricCriteriaIds: input.rubricCriteriaIds,
    freetextOnly: input.freetextOnly,
    aiInfluence: input.aiInfluence,
  });

  if (!decisionResult.needsManualReview) {
    await enqueuePostDecisionSideEffects(input, decisionResult.decision.passFailTotal);
  }

  await recordJobCompletedAudit(input.jobId, input.submissionId, input.userId);
}

type ApplyMcqOnlyDecisionInput = {
  jobId: string;
  submissionId: string;
  userId: string;
  moduleId: string;
  moduleVersionId: string;
  mcqScaledScore: number;
  mcqPercentScore: number;
  assessmentPolicy: ModuleAssessmentPolicy | null;
  moduleTitle: string;
  submissionLocale: SupportedLocale;
  submittedAt: Date;
  recipientEmail: string;
  recipientName: string;
};

/**
 * Final phase for an MCQ_ONLY module (#525): create the MCQ-only decision (no LLM, no manual
 * review), notify the participant, and run the course-completion check — same side effects as a
 * passed/failed free-text decision, minus the rubric/prompt pieces.
 */
export async function applyMcqOnlyDecision(input: ApplyMcqOnlyDecisionInput): Promise<void> {
  const decisionResult = await createMcqOnlyDecision({
    submissionId: input.submissionId,
    userId: input.userId,
    moduleVersionId: input.moduleVersionId,
    mcqScaledScore: input.mcqScaledScore,
    mcqPercentScore: input.mcqPercentScore,
    assessmentPolicy: input.assessmentPolicy,
  });

  await enqueuePostDecisionSideEffects(input, decisionResult.decision.passFailTotal);

  await recordJobCompletedAudit(input.jobId, input.submissionId, input.userId);
}

type NotifyInput = {
  submissionId: string;
  userId: string;
  moduleId: string;
  moduleTitle: string;
  submissionLocale: SupportedLocale;
  submittedAt: Date;
  recipientEmail: string;
  recipientName: string;
};

// #795: durably enqueue the participant notification + course-completion check instead of firing them
// and forgetting. Awaited before the job is marked SUCCEEDED, so a crash after SUCCEEDED can no longer
// lose them — the outbox delivery worker delivers them (with retries) from the persisted rows.
async function enqueuePostDecisionSideEffects(input: NotifyInput, passFailTotal: boolean): Promise<void> {
  const moduleTitle = localizeContentText(input.submissionLocale, input.moduleTitle) ?? input.moduleId;

  await enqueueOutboxEvents([
    {
      type: OUTBOX_EVENT_TYPES.assessmentNotification,
      payload: {
        submissionId: input.submissionId,
        submittedAt: input.submittedAt.toISOString(),
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        moduleTitle,
        moduleId: input.moduleId,
        passFailTotal,
        locale: input.submissionLocale,
      },
    },
    {
      type: OUTBOX_EVENT_TYPES.courseCompletionCheck,
      payload: { userId: input.userId, moduleId: input.moduleId },
    },
  ]);
}

async function recordJobCompletedAudit(jobId: string, submissionId: string, userId: string): Promise<void> {
  await recordAuditEvent({
    entityType: auditEntityTypes.assessmentJob,
    entityId: jobId,
    action: auditActions.assessment.assessmentJobCompleted,
    actorId: userId,
    metadata: { submissionId },
  });
}
