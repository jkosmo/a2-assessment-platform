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
    // #967: tildelings-e-posten ble holdt tilbake fordi kurset ikke var publisert. Tildelingen
    // gikk gjennom — det er VARSELET som ikke ble sendt, og en e-post som aldri kom er stille.
    assignmentMailSuppressed: "course_assignment_mail_suppressed",
  },
  audit: {
    // #1000: tilgangsloggen for et revisjonsspor kunne ikke skrives. Skjer typisk mens
    // backfill/skrubbing holder kjedelåsen. Lesingen gikk gjennom — det er SPORET av den som
    // mangler, og et hull i en tilgangslogg oppdages ellers først når noen spør hvem som har lest hva.
    trailAccessLogFailed: "audit_trail_access_log_failed",
  },
  assessment: {
    queueBacklog: "assessment_queue_backlog",
    jobStaleLockDetected: "assessment_job_stale_lock_detected",
    jobStuckAlert: "assessment_job_stuck_alert",
    failedBacklogAlert: "assessment_failed_backlog_alert",
    decisionAlreadyPresent: "assessment_decision_already_present",
    llmEvaluationFailed: "llm_evaluation_failed",
    // #1023: skyggemåling av utløseren for andre vurdering. Logges BARE ved uenighet.
    secondaryTriggerShadowDiff: "secondary_trigger_shadow_diff",
    // #1026: delstreng-reserven for «utilstrekkelig grunnlag». Logges når den er ALENE om
    // å fyre — da er den det eneste som står mellom en manuell vurdering og automatisk stryk.
    insufficientEvidencePatternOnly: "insufficient_evidence_pattern_only",
    // #1023: hvilke regler instansen faktisk lastet. Logges én gang ved oppstart.
    rulesLoaded: "assessment_rules_loaded",
    // #1023: HVORFOR en andre vurdering ble kjørt. Uten dette kan vi ikke se om en ny utløser virker.
    secondaryAssessmentRan: "secondary_assessment_ran",
  },
  certification: {
    participantNotificationFailed: "participant_notification_failed",
    participantNotificationPipelineFailed: "participant_notification_pipeline_failed",
    participantNotificationSent: "participant_notification_sent",
    // #989: resertifiseringspåminnelsene er borte. Dette er vakta mot at en sen FAIL fra en ELDRE
    // innlevering overskriver en bestått sertifisering — den har aldri handlet om resertifisering,
    // og heter nå det den gjør.
    certificationDowngradeSkipped: "certification_downgrade_skipped",
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
  // #967: hvor mange medlemmer som IKKE fikk «nytt kurs tildelt», og hvorfor.
  [operationalEvents.course.assignmentMailSuppressed]: EventMetadata<{
    courseId: string;
    classId: string;
    recipientCount: number;
    reason: "unpublished";
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
  // #953: opphopning av vurderinger som ga opp. Ingen jobId — dette er et TALL over flere jobber,
  // ikke en hendelse om én av dem. `recipientCount` er med fordi «varselet gikk ut» og «noen fikk
  // det» ikke er samme sak: en plattform uten administrator-tildelinger har null mottakere.
  [operationalEvents.assessment.failedBacklogAlert]: EventMetadata<{
    failedCount: number;
    threshold: number;
    recipientCount: number;
  }>;
  // #953 krav 2: kjøringen stanset fordi innleveringen allerede var avgjort. Ikke en feil — en
  // jobb som kom for sent. Loggnivået er info — dette er en vakt som gjorde jobben sin, ikke en
  // driftsfeil. Skjer det ofte, er DET funnet, og telleren i loggen bærer mønsteret.
  [operationalEvents.assessment.decisionAlreadyPresent]: EventMetadata<{
    jobId: string;
    submissionId: string;
    decisionId: string;
  }>;
  [operationalEvents.assessment.llmEvaluationFailed]: EventMetadata<{
    jobId: string;
    submissionId: string;
    assessmentPass: string;
    llmMode: string;
    errorMessage: string;
  }>;
  // #1023: dagens utløser leter etter delstrenger i språkmodellens frie tekst («medium confidence»,
  // «low confidence»). Den strukturerte regelen leser felt modellen faktisk fyller ut. Denne
  // hendelsen logges når de to er UENIGE, slik at vi kan måle før vi bytter — et bytte endrer hvor
  // ofte vi betaler for en ekstra LLM-kjøring.
  //
  // ⚠️ Ingen fritekst i metadataen. Notatet kan i teorien gjengi noe kandidaten skrev; her lagres
  // bare hvilke MØNSTRE som traff, og hvilke strukturerte verdier som lå bak.
  // #1026: reserven søker i FORBEDRINGSRÅDENE, med mønstre som «additional material» — vanlige
  // fraser i et råd til en god besvarelse. Et treff undertrykker manuell vurdering og gir
  // automatisk stryk i stedet. Denne hendelsen sier hvor ofte reserven er alene om å fyre.
  //
  // ⚠️ Ingen fritekst: bare hvilke mønstre som traff, og hvor de traff.
  [operationalEvents.audit.trailAccessLogFailed]: EventMetadata<{
    subjectSubmissionId: string;
    readerUserId: string;
    errorMessage: string;
  }>;
  [operationalEvents.assessment.insufficientEvidencePatternOnly]: EventMetadata<{
    jobId: string;
    submissionId: string;
    moduleId: string;
    /** «primary» eller «secondary» — hvilken vurdering treffet kom fra. */
    assessmentPass: string;
    matchedPatterns: string[];
    evidenceSufficiency: string;
    manualReviewReasonCode: string;
    llmRecommendedManualReview: boolean;
  }>;
  [operationalEvents.assessment.rulesLoaded]: EventMetadata<{
    rulesPath: string;
    redFlagCodes: number;
    /** Bare nøklene, aldri tekstene — linja skal kunne leses i en driftslogg. */
    manualReviewReasonKeys: string[];
    evidenceSufficiencyKeys: string[];
  }>;
  [operationalEvents.assessment.secondaryAssessmentRan]: EventMetadata<{
    jobId: string;
    submissionId: string;
    moduleId: string;
    /** Utløserne som slo til, fra konfigurasjonen — ingen fritekst. */
    reasons: string[];
    /** Primærvurderingens samlede poengsum, eller null når den ikke kunne regnes ut. */
    totalScore: number | null;
  }>;
  [operationalEvents.assessment.secondaryTriggerShadowDiff]: EventMetadata<{
    jobId: string;
    submissionId: string;
    moduleId: string;
    liveConfidenceTrigger: boolean;
    shadowConfidenceTrigger: boolean;
    liveShouldRun: boolean;
    shadowShouldRun: boolean;
    matchedPatterns: string[];
    evidenceSufficiency: string;
    manualReviewReasonCode: string;
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
  [operationalEvents.certification.certificationDowngradeSkipped]: EventMetadata<{
    userId: string;
    moduleId: string;
    decisionId: string;
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
