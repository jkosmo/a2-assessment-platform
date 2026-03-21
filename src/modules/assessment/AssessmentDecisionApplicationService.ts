import { createAssessmentDecision, type ModuleAssessmentPolicy } from "./decisionService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { notifyAssessmentResult } from "../../services/participantNotificationService.js";
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
  });

  if (!decisionResult.needsManualReview) {
    const moduleTitle =
      localizeContentText(input.submissionLocale, input.moduleTitle) ?? input.moduleId;

    notifyAssessmentResult({
      submissionId: input.submissionId,
      submittedAt: input.submittedAt,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      moduleTitle,
      moduleId: input.moduleId,
      passFailTotal: decisionResult.decision.passFailTotal,
      locale: input.submissionLocale,
    }).catch((error: unknown) => {
      logOperationalEvent(
        "participant_notification_failed",
        {
          submissionId: input.submissionId,
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        },
        "error",
      );
    });
  }

  await recordAuditEvent({
    entityType: "assessment_job",
    entityId: input.jobId,
    action: "assessment_job_completed",
    actorId: input.userId,
    metadata: { submissionId: input.submissionId },
  });
}
