type AdditionalMetadata = Record<string, unknown>;
type EventMetadata<T extends AdditionalMetadata> = T & AdditionalMetadata;
type NestedValue<T> = T extends string ? T : { [K in keyof T]: NestedValue<T[K]> }[keyof T];

export const auditEntityTypes = {
  agentAuthoringToken: "agent_authoring_token",
  appeal: "appeal",
  assessmentDecision: "assessment_decision",
  assessmentJob: "assessment_job",
  calibrationWorkspace: "calibration_workspace",
  certificationStatus: "certification_status",
  course: "course",
  courseSection: "course_section",
  class: "class",
  discussionThread: "discussion_thread",
  discussionReply: "discussion_reply",
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
    moduleTitleUpdated: "module_title_updated",
    moduleDeleted: "module_deleted",
    moduleUnpublished: "module_unpublished",
    moduleArchived: "module_archived",
    moduleRestored: "module_restored",
    benchmarkExampleVersionCreated: "benchmark_example_version_created",
    moduleVersionPublished: "module_version_published",
    calibrationThresholdsPublished: "calibration_thresholds_published",
    moduleExported: "module_exported",
    moduleImported: "module_imported",
    courseExported: "course_exported",
    courseImported: "course_imported",
  },
  appeal: {
    created: "appeal_created",
    claimed: "appeal_claimed",
    adminTakeover: "appeal_admin_takeover",
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
  // AA-3 (#651): utstedelse/revokering av kortlivede agent-authoring-tokens.
  agentAuthoring: {
    tokenIssued: "agent_authoring_token_issued",
    tokenRevoked: "agent_authoring_token_revoked",
  },
  course: {
    created: "course_created",
    // AA-5 (#653): item-sekvensen er en write i agent-orkestreringen og må være sporbar.
    itemsUpdated: "course_items_updated",
    published: "course_published",
    unpublished: "course_unpublished",
    archived: "course_archived",
    restored: "course_restored",
    // #705: plain single-course delete (distinct from archive and from cascadeDeleted).
    deleted: "course_deleted",
    // #762: destruktiv opprydding — slett kurs + dets eksklusivt-eide moduler/seksjoner.
    cascadeDeleted: "course_cascade_deleted",
    completionIssued: "course_completion_issued",
    // #497: automatiske frist-påminnelser (frist nærmer seg / forfalt) fra bakgrunnsjobben.
    reminderSent: "course_reminder_sent",
    reminderFailed: "course_reminder_failed",
  },
  section: {
    created: "section_created",
    published: "section_published",
    unpublished: "section_unpublished",
    archived: "section_archived",
    restored: "section_restored",
  },
  enrollment: {
    assigned: "course_enrollment_assigned",
    revoked: "course_enrollment_revoked",
    selfEnrolled: "course_self_enrolled",
  },
  class: {
    created: "class_created",
    archived: "class_archived",
    restored: "class_restored",
    memberAdded: "class_member_added",
    memberRemoved: "class_member_removed",
    courseAssigned: "class_course_assigned",
    courseUnassigned: "class_course_unassigned",
  },
  certification: {
    recertificationStatusUpserted: "recertification_status_upserted",
    recertificationReminderSent: "recertification_reminder_sent",
    recertificationReminderFailed: "recertification_reminder_failed",
    participantNotificationSent: "participant_notification_sent",
    participantNotificationFailed: "participant_notification_failed",
  },
  discussion: {
    threadCreated: "discussion_thread_created",
    threadEdited: "discussion_thread_edited",
    threadDeleted: "discussion_thread_deleted",
    threadModerated: "discussion_thread_moderated",
    answerAccepted: "discussion_answer_accepted",
    replyCreated: "discussion_reply_created",
    replyEdited: "discussion_reply_edited",
    replyDeleted: "discussion_reply_deleted",
  },
  manualReview: {
    opened: "manual_review_opened",
    claimed: "manual_review_claimed",
    adminTakeover: "manual_review_admin_takeover",
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
  [auditActions.adminContent.moduleTitleUpdated]: EventMetadata<{
    moduleId: string;
    title: string;
  }>;
  [auditActions.adminContent.moduleDeleted]: EventMetadata<{
    moduleId: string;
  }>;
  [auditActions.adminContent.moduleUnpublished]: EventMetadata<{
    moduleId: string;
    previousActiveVersionId: string;
  }>;
  [auditActions.adminContent.moduleArchived]: EventMetadata<{
    moduleId: string;
  }>;
  [auditActions.adminContent.moduleRestored]: EventMetadata<{
    moduleId: string;
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
  [auditActions.adminContent.moduleExported]: EventMetadata<{
    moduleId: string;
    exportedAt: string;
  }>;
  [auditActions.adminContent.moduleImported]: EventMetadata<{
    moduleId: string;
    moduleVersionId: string;
    mode: "createNew" | "replaceExisting";
    sourcePublishedAt: string | null;
    sourcePublishedBy: string | null;
    sourceVersionNo: number | null;
  }>;
  [auditActions.adminContent.courseExported]: EventMetadata<{
    courseId: string;
    exportedAt: string;
    moduleCount: number;
  }>;
  [auditActions.adminContent.courseImported]: EventMetadata<{
    courseId: string;
    mode: "createNew" | "replaceExisting";
    moduleCount: number;
    sourcePublishedAt: string | null;
  }>;
  [auditActions.appeal.created]: EventMetadata<{
    submissionId: string;
    appealStatus: string;
  }>;
  [auditActions.appeal.claimed]: EventMetadata<{
    submissionId: string;
    appealStatus: string;
    claimedAt?: string | null;
  }>;
  [auditActions.appeal.adminTakeover]: EventMetadata<{
    submissionId: string;
    previousHandlerId: string;
    newHandlerId: string;
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
  [auditActions.agentAuthoring.tokenIssued]: EventMetadata<{ tokenId: string; expiresAt: string }>;
  [auditActions.agentAuthoring.tokenRevoked]: EventMetadata<{ tokenId: string }>;
  [auditActions.course.created]: EventMetadata<{ courseId: string }>;
  [auditActions.course.itemsUpdated]: EventMetadata<{ courseId: string; itemCount: number }>;
  [auditActions.course.published]: EventMetadata<{ courseId: string }>;
  [auditActions.course.unpublished]: EventMetadata<{ courseId: string }>;
  [auditActions.course.archived]: EventMetadata<{ courseId: string }>;
  [auditActions.course.restored]: EventMetadata<{ courseId: string }>;
  [auditActions.course.deleted]: EventMetadata<{ courseId: string }>;
  [auditActions.course.cascadeDeleted]: EventMetadata<{
    courseId: string;
    deletedModuleIds: string[];
    deletedSectionIds: string[];
    sparedModuleIds: string[];
    sparedSectionIds: string[];
  }>;
  [auditActions.section.created]: EventMetadata<{ sectionId: string; draft: boolean }>;
  [auditActions.section.published]: EventMetadata<{ sectionId: string }>;
  [auditActions.section.unpublished]: EventMetadata<{ sectionId: string }>;
  [auditActions.section.archived]: EventMetadata<{ sectionId: string }>;
  [auditActions.section.restored]: EventMetadata<{ sectionId: string }>;
  [auditActions.course.completionIssued]: EventMetadata<{
    userId: string;
    courseId: string;
    certificateId: string;
  }>;
  // #497: frist-påminnelse sendt/feilet. `daysBefore` er kun satt for kind="due_soon".
  [auditActions.course.reminderSent]: EventMetadata<{
    courseId: string;
    userId: string;
    kind: "due_soon" | "overdue";
    daysBefore?: number;
    asOfDate: string;
    dueAt: string;
    channel: string;
    delivered: boolean;
    failureReason?: string | null;
  }>;
  [auditActions.course.reminderFailed]: EventMetadata<{
    courseId: string;
    userId: string;
    kind: "due_soon" | "overdue";
    daysBefore?: number;
    asOfDate: string;
    dueAt: string;
    channel: string;
    delivered: boolean;
    failureReason?: string | null;
  }>;
  [auditActions.enrollment.assigned]: EventMetadata<{
    userId: string;
    courseId: string;
    source: string;
  }>;
  [auditActions.enrollment.revoked]: EventMetadata<{ userId: string; courseId: string }>;
  [auditActions.enrollment.selfEnrolled]: EventMetadata<{ userId: string; courseId: string }>;
  [auditActions.class.created]: EventMetadata<{ classId: string; name: string }>;
  [auditActions.class.archived]: EventMetadata<{ classId: string }>;
  [auditActions.class.restored]: EventMetadata<{ classId: string }>;
  [auditActions.class.memberAdded]: EventMetadata<{ classId: string; userId: string }>;
  [auditActions.class.memberRemoved]: EventMetadata<{ classId: string; userId: string }>;
  [auditActions.class.courseAssigned]: EventMetadata<{ classId: string; courseId: string }>;
  [auditActions.class.courseUnassigned]: EventMetadata<{ classId: string; courseId: string }>;
  [auditActions.discussion.threadCreated]: EventMetadata<{
    courseId: string;
    courseItemId: string | null;
    kind: string;
  }>;
  [auditActions.discussion.threadEdited]: EventMetadata<{ courseId: string; threadId: string }>;
  [auditActions.discussion.threadDeleted]: EventMetadata<{ courseId: string; threadId: string }>;
  [auditActions.discussion.threadModerated]: EventMetadata<{
    courseId: string;
    threadId: string;
    change: string;
  }>;
  [auditActions.discussion.answerAccepted]: EventMetadata<{
    courseId: string;
    threadId: string;
    replyId: string;
  }>;
  [auditActions.discussion.replyCreated]: EventMetadata<{ courseId: string; threadId: string }>;
  [auditActions.discussion.replyEdited]: EventMetadata<{ courseId: string; threadId: string }>;
  [auditActions.discussion.replyDeleted]: EventMetadata<{ courseId: string; threadId: string }>;
  [auditActions.manualReview.opened]: EventMetadata<{
    submissionId: string;
    decisionId: string;
  }>;
  [auditActions.manualReview.claimed]: EventMetadata<{
    submissionId: string;
    reviewStatus: string;
  }>;
  [auditActions.manualReview.adminTakeover]: EventMetadata<{
    submissionId: string;
    previousReviewerId: string;
    newReviewerId: string;
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

// AA-5 (#653): agent-orchestrated writes carry a trace (source + clientRef +
// agentRunId) in the audit metadata so partial success is reconstructable —
// query audit events by agentRunId to see exactly what a run created.
export type AgentAuthoringContext = { clientRef?: string; agentRunId?: string };

export function agentAuthoringAuditMetadata(agent?: AgentAuthoringContext) {
  if (!agent || (!agent.clientRef && !agent.agentRunId)) return {};
  return {
    source: "agent_authoring" as const,
    ...(agent.clientRef ? { clientRef: agent.clientRef } : {}),
    ...(agent.agentRunId ? { agentRunId: agent.agentRunId } : {}),
  };
}
