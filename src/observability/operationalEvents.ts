type AdditionalMetadata = Record<string, unknown>;
type EventMetadata<T extends AdditionalMetadata> = T & AdditionalMetadata;
type NestedValue<T> = T extends string ? T : { [K in keyof T]: NestedValue<T[K]> }[keyof T];

export const operationalEvents = {
  appeal: {
    slaBacklog: "appeal_sla_backlog",
    overdueDetected: "appeal_overdue_detected",
  },
  course: {
    completionCheckFailed: "course_completion_check_failed",
  },
  assessment: {
    queueBacklog: "assessment_queue_backlog",
    jobStaleLockDetected: "assessment_job_stale_lock_detected",
    jobStuckAlert: "assessment_job_stuck_alert",
    llmEvaluationFailed: "llm_evaluation_failed",
  },
  certification: {
    participantNotificationFailed: "participant_notification_failed",
    participantNotificationPipelineFailed: "participant_notification_pipeline_failed",
    participantNotificationSent: "participant_notification_sent",
    recertificationDowngradeSkipped: "recertification_downgrade_skipped",
    recertificationReminderSent: "recertification_reminder_sent",
    recertificationReminderFailed: "recertification_reminder_failed",
  },
  http: {
    request: "http_request",
  },
  orgSync: {
    deltaStarted: "org_sync_delta_started",
    failedRecord: "org_sync_delta_failed_record",
    deltaCompleted: "org_sync_delta_completed",
  },
  process: {
    unhandledRejection: "unhandled_rejection",
    uncaughtException: "uncaught_exception",
    unhandledError: "unhandled_error",
  },
  pseudonymization: {
    skipped: "pseudonymization_skipped",
    scanError: "pseudonymization_scan_error",
    scanCompleted: "pseudonymization_scan_completed",
    userPseudonymized: "user_pseudonymized",
  },
  retention: {
    auditScanCompleted: "audit_retention_scan_completed",
  },
  submission: {
    documentParse: "submission_document_parse",
  },
} as const;

export type OperationalEventName = NestedValue<typeof operationalEvents>;

export type OperationalEventMetadataByName = {
  [operationalEvents.course.completionCheckFailed]: EventMetadata<{
    userId: string;
    moduleId: string;
    errorMessage: string;
  }>;
  [operationalEvents.appeal.slaBacklog]: EventMetadata<{
    openAppeals: number;
    inReviewAppeals: number;
    overdueAppeals: number;
  }>;
  [operationalEvents.appeal.overdueDetected]: EventMetadata<{
    overdueAppeals: number;
    overdueThreshold: number;
  }>;
  [operationalEvents.assessment.queueBacklog]: EventMetadata<{
    trigger: string;
    pendingJobs: number;
    runningJobs: number;
  }>;
  [operationalEvents.assessment.jobStaleLockDetected]: EventMetadata<{
    jobId: string;
    submissionId: string;
  }>;
  [operationalEvents.assessment.jobStuckAlert]: EventMetadata<{
    jobId: string;
    submissionId: string;
  }>;
  [operationalEvents.assessment.llmEvaluationFailed]: EventMetadata<{
    jobId: string;
    submissionId: string;
    assessmentPass: string;
    llmMode: string;
    errorMessage: string;
  }>;
  [operationalEvents.certification.participantNotificationFailed]: EventMetadata<{
    channel: string;
  }>;
  [operationalEvents.certification.participantNotificationPipelineFailed]: EventMetadata<{
    submissionId: string;
  }>;
  [operationalEvents.certification.participantNotificationSent]: EventMetadata<{
    channel: string;
  }>;
  [operationalEvents.certification.recertificationDowngradeSkipped]: EventMetadata<{
    userId: string;
    moduleId: string;
    decisionId: string;
  }>;
  [operationalEvents.certification.recertificationReminderSent]: EventMetadata<{
    channel: string;
  }>;
  [operationalEvents.certification.recertificationReminderFailed]: EventMetadata<{
    channel: string;
    failureReason: string;
  }>;
  [operationalEvents.http.request]: EventMetadata<{
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
  }>;
  [operationalEvents.orgSync.deltaStarted]: EventMetadata<{
    runId: string;
    source: string;
    userCount: number;
  }>;
  [operationalEvents.orgSync.failedRecord]: EventMetadata<{
    runId: string;
    source: string;
    externalId: string;
    reason: string;
  }>;
  [operationalEvents.orgSync.deltaCompleted]: EventMetadata<{
    createdCount: number;
    updatedCount: number;
    skippedConflictCount: number;
    failedCount: number;
  }>;
  [operationalEvents.process.unhandledRejection]: EventMetadata<{
    reason: string;
  }>;
  [operationalEvents.process.uncaughtException]: EventMetadata<{
    error: string;
  }>;
  [operationalEvents.process.unhandledError]: EventMetadata<{
    correlationId: string | null;
    error: string;
  }>;
  [operationalEvents.pseudonymization.skipped]: EventMetadata<{
    userId: string;
    reason: string;
    trigger: string;
  }>;
  [operationalEvents.pseudonymization.scanError]: EventMetadata<{
    phase: string;
    error: string;
  }>;
  [operationalEvents.pseudonymization.scanCompleted]: EventMetadata<{
    ranAt: string;
    errors: number;
  }>;
  [operationalEvents.pseudonymization.userPseudonymized]: EventMetadata<{
    userId: string;
    trigger: string;
    cancelledJobCount: number;
  }>;
  [operationalEvents.retention.auditScanCompleted]: EventMetadata<{
    deletedCount: number;
    cutoffDate: string;
    retentionDays: number;
  }>;
  [operationalEvents.submission.documentParse]: EventMetadata<{
    submissionId: string;
    moduleId: string;
    deliveryType: string;
    parser: Record<string, unknown>;
  }>;
};
