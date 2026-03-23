type AdditionalMetadata = Record<string, unknown>;
type EventMetadata<T extends AdditionalMetadata> = T & AdditionalMetadata;
type NestedValue<T> = T extends string ? T : { [K in keyof T]: NestedValue<T[K]> }[keyof T];

export const auditEntityTypes = {
  appeal: "appeal",
  assessmentDecision: "assessment_decision",
  assessmentJob: "assessment_job",
  calibrationWorkspace: "calibration_workspace",
  certificationStatus: "certification_status",
  llmEvaluation: "llm_evaluation",
  manualReview: "manual_review",
  mcqAttempt: "mcq_attempt",
  module: "module",
  moduleVersion: "module_version",
  orgSync: "org_sync",
  promptTemplateVersion: "prompt_template_version",
  submission: "submission",
  user: "user",
} as const;

export type AuditEntityType = NestedValue<typeof auditEntityTypes>;

export const auditActions = {
  adminContent: {
    moduleCreated: "module_created",
    moduleDeleted: "module_deleted",
    moduleUnpublished: "module_unpublished",
    benchmarkExampleVersionCreated: "benchmark_example_version_created",
    moduleVersionPublished: "module_version_published",
    calibrationThresholdsPublished: "calibration_thresholds_published",
  },
  appeal: {
    created: "appeal_created",
    claimed: "appeal_claimed",
    resolutionDecisionCreated: "appeal_resolution_decision_created",
    resolved: "appeal_resolved",
    superseded: "appeal_superseded",
  },
  assessment: {
    decisionCreated: "decision_created",
    llmEvaluationCreated: "llm_evaluation_created",
    assessmentJobEnqueued: "assessment_job_enqueued",
    assessmentJobCompleted: "assessment_job_completed",
    assessmentJobFailed: "assessment_job_failed",
    assessmentJobRetryScheduled: "assessment_job_retry_scheduled",
    assessmentJobStaleLockFailed: "assessment_job_stale_lock_failed",
    assessmentJobStaleLockReset: "assessment_job_stale_lock_reset",
    secondaryAssessmentTriggered: "secondary_assessment_triggered",
    secondaryAssessmentCompleted: "secondary_assessment_completed",
    sensitiveDataPreprocessed: "sensitive_data_preprocessed",
    mcqSubmitted: "mcq_submitted",
  },
  calibration: {
    workspaceSessionStarted: "calibration_workspace_session_started",
  },
  certification: {
    recertificationStatusUpserted: "recertification_status_upserted",
    recertificationReminderSent: "recertification_reminder_sent",
    recertificationReminderFailed: "recertification_reminder_failed",
    participantNotificationSent: "participant_notification_sent",
    participantNotificationFailed: "participant_notification_failed",
  },
  manualReview: {
    opened: "manual_review_opened",
    claimed: "manual_review_claimed",
    overrideDecisionCreated: "manual_override_decision_created",
    resolved: "manual_review_resolved",
    superseded: "review_superseded",
  },
  orgSync: {
    recordFailed: "org_sync_record_failed",
    completed: "org_sync_completed",
  },
  submission: {
    created: "submission_created",
    retakeSupersedeCompleted: "retake_supersede_completed",
  },
  user: {
    pseudonymized: "user_pseudonymized",
  },
} as const;

export type AuditAction = NestedValue<typeof auditActions>;

export type AuditMetadataByAction = {
  [auditActions.adminContent.moduleCreated]: EventMetadata<{
    moduleId: string;
  }>;
  [auditActions.adminContent.moduleDeleted]: EventMetadata<{
    moduleId: string;
  }>;
  [auditActions.adminContent.moduleUnpublished]: EventMetadata<{
    moduleId: string;
    previousActiveVersionId: string;
  }>;
  [auditActions.adminContent.benchmarkExampleVersionCreated]: EventMetadata<{
    moduleId: string;
    promptTemplateVersionId: string;
  }>;
  [auditActions.adminContent.moduleVersionPublished]: EventMetadata<{
    moduleId: string;
    moduleVersionId: string;
  }>;
  [auditActions.adminContent.calibrationThresholdsPublished]: EventMetadata<{
    moduleId: string;
    moduleVersionId: string;
  }>;
  [auditActions.appeal.created]: EventMetadata<{
    submissionId: string;
    appealStatus: string;
  }>;
  [auditActions.appeal.claimed]: EventMetadata<{
    submissionId: string;
    appealStatus: string;
  }>;
  [auditActions.appeal.resolutionDecisionCreated]: EventMetadata<{
    submissionId: string;
    appealId: string;
    parentDecisionId: string;
    passFailTotal: boolean;
  }>;
  [auditActions.appeal.resolved]: EventMetadata<{
    submissionId: string;
    resolutionDecisionId: string;
    appealStatus: string;
  }>;
  [auditActions.appeal.superseded]: EventMetadata<{
    newSubmissionId: string;
    supersededAt: string;
  }>;
  [auditActions.assessment.decisionCreated]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.llmEvaluationCreated]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.assessmentJobEnqueued]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.assessmentJobCompleted]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.assessmentJobFailed]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.assessmentJobRetryScheduled]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.assessmentJobStaleLockFailed]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.assessmentJobStaleLockReset]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.assessment.secondaryAssessmentTriggered]: EventMetadata<{
    submissionId: string;
    reasons: unknown[];
  }>;
  [auditActions.assessment.secondaryAssessmentCompleted]: EventMetadata<{
    submissionId: string;
    hasDisagreement: boolean;
  }>;
  [auditActions.assessment.sensitiveDataPreprocessed]: EventMetadata<{
    moduleId: string;
    maskingEnabled: boolean;
    maskingApplied: boolean;
  }>;
  [auditActions.assessment.mcqSubmitted]: EventMetadata<{
    submissionId: string;
  }>;
  [auditActions.calibration.workspaceSessionStarted]: EventMetadata<{
    moduleId: string;
  }>;
  [auditActions.certification.recertificationStatusUpserted]: EventMetadata<{
    userId: string;
    moduleId: string;
    decisionId: string;
  }>;
  [auditActions.certification.recertificationReminderSent]: EventMetadata<{
    certificationId: string;
    userId: string;
    recipientEmail: string;
  }>;
  [auditActions.certification.recertificationReminderFailed]: EventMetadata<{
    certificationId: string;
    userId: string;
    recipientEmail: string;
  }>;
  [auditActions.certification.participantNotificationSent]: EventMetadata<{
    channel: string;
  }>;
  [auditActions.certification.participantNotificationFailed]: EventMetadata<{
    channel: string;
  }>;
  [auditActions.manualReview.opened]: EventMetadata<{
    submissionId: string;
    decisionId: string;
  }>;
  [auditActions.manualReview.claimed]: EventMetadata<{
    submissionId: string;
    reviewStatus: string;
  }>;
  [auditActions.manualReview.overrideDecisionCreated]: EventMetadata<{
    submissionId: string;
    reviewId: string;
    parentDecisionId: string;
    passFailTotal: boolean;
  }>;
  [auditActions.manualReview.resolved]: EventMetadata<{
    submissionId: string;
    overrideDecisionId: string;
    overrideDecision: string | null;
  }>;
  [auditActions.manualReview.superseded]: EventMetadata<{
    newSubmissionId: string;
    supersededAt: string;
  }>;
  [auditActions.orgSync.recordFailed]: EventMetadata<{
    source: string;
    externalId: string;
  }>;
  [auditActions.orgSync.completed]: EventMetadata<{
    createdCount: number;
    updatedCount: number;
    skippedConflictCount: number;
    failedCount: number;
  }>;
  [auditActions.submission.created]: EventMetadata<{
    submissionId: string;
    moduleId: string;
    moduleVersionId: string;
  }>;
  [auditActions.submission.retakeSupersedeCompleted]: EventMetadata<{
    supersededReviewCount: number;
    supersededAppealCount: number;
  }>;
  [auditActions.user.pseudonymized]: EventMetadata<{
    trigger: string;
    cancelledJobCount: number;
    pseudonymizedAt: string;
  }>;
};

export type AuditEventInput<TAction extends AuditAction = AuditAction> = {
  entityType: AuditEntityType;
  entityId: string;
  action: TAction;
  actorId?: string;
  metadata?: AuditMetadataByAction[TAction];
};
