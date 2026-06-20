import { createAssessmentDecision, createMcqOnlyDecision, type ModuleAssessmentPolicy } from "./decisionService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { notifyAssessmentResult } from "../certification/index.js";
import { checkAndIssueCourseCompletions } from "../course/index.js";
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
  });

  if (!decisionResult.needsManualReview) {
    notifyAndCheckCompletion(input, decisionResult.decision.passFailTotal);
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

  notifyAndCheckCompletion(input, decisionResult.decision.passFailTotal);

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

/** Fire-and-forget participant notification + course-completion check (shared by both paths). */
function notifyAndCheckCompletion(input: NotifyInput, passFailTotal: boolean): void {
  const moduleTitle =
    localizeContentText(input.submissionLocale, input.moduleTitle) ?? input.moduleId;

  notifyAssessmentResult({
    submissionId: input.submissionId,
    submittedAt: input.submittedAt,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    moduleTitle,
    moduleId: input.moduleId,
    passFailTotal,
    locale: input.submissionLocale,
  }).catch((error: unknown) => {
    logOperationalEvent(
      operationalEvents.certification.participantNotificationPipelineFailed,
      {
        submissionId: input.submissionId,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
      "error",
    );
  });

  checkAndIssueCourseCompletions({ userId: input.userId, moduleId: input.moduleId }).catch(
    (error: unknown) => {
      logOperationalEvent(
        operationalEvents.course.completionCheckFailed,
        {
          userId: input.userId,
          moduleId: input.moduleId,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
        "error",
      );
    },
  );
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
