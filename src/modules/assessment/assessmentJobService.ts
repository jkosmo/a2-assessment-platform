import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { assessmentJobRepository } from "./assessmentJobRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { normalizeLocale } from "../../i18n/locale.js";
import { buildAssessmentInputContext } from "./AssessmentInputFactory.js";
import { runLlmEvaluationPipeline } from "./AssessmentEvaluator.js";
import { applyAssessmentDecision, applyMcqOnlyDecision } from "./AssessmentDecisionApplicationService.js";
import { assessmentPolicyCodec } from "../../codecs/assessmentPolicyCodec.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import {
  evaluateAiInfluence,
  evaluateContentSimilarity,
  buildAiInfluenceOutcome,
  parseAiInfluenceSignals,
  resolveContentSimilarityRules,
} from "./aiInfluence.js";
import { generateModelAnswer } from "./llmAssessmentService.js";
import { extractAnswerText } from "./contentSimilarity.js";
import {
  processAssessmentJobsNow as runnerProcessAssessmentJobsNow,
  processSubmissionJobNow as runnerProcessSubmissionJobNow,
  processNextJob as runnerProcessNextJob,
  type AssessmentRunFence,
} from "./AssessmentJobRunner.js";

export { enqueueAssessmentJob } from "./AssessmentJobRunner.js";

export async function processAssessmentJobsNow(maxJobs = 1) {
  return runnerProcessAssessmentJobsNow(runAssessment, maxJobs);
}

// The caller awaits the verdict and renders it, so an MCQ_ONLY result reaches the participant in the
// UI — `gradedSynchronously` tells the decision layer to suppress the redundant result e-mail. Every
// other entry point (the async worker, incl. the fallback when synchronous grading throws) leaves it
// false, so a participant who never saw the UI verdict is still notified by e-mail.
export async function processSubmissionJobNow(submissionId: string, maxCycles = 25) {
  return runnerProcessSubmissionJobNow(
    (jobId, fence) => runAssessment(jobId, fence, { gradedSynchronously: true }),
    submissionId,
    maxCycles,
  );
}

export async function processNextJob(submissionId?: string): Promise<boolean> {
  return runnerProcessNextJob(runAssessment, submissionId);
}

async function runAssessment(
  jobId: string,
  fence: AssessmentRunFence,
  options: { gradedSynchronously?: boolean } = {},
) {
  const job = await assessmentJobRepository.findAssessmentJobWithSubmissionOrThrow(jobId);

  const submission = job.submission;
  const submissionLocale = normalizeLocale(submission.locale) ?? "en-GB";
  const assessmentMode = submission.moduleVersion.assessmentMode;
  const mcqAttempt = submission.mcqAttempts[0];

  // FREETEXT_ONLY (#578) has no MCQ component, so there is no MCQ attempt to wait for. Every other
  // mode must have a completed MCQ before assessment can run. Narrow the scores into locals so the
  // rest of the function has plain numbers (0 for FREETEXT_ONLY).
  let mcqScaledScore = 0;
  let mcqPercentScore = 0;
  if (assessmentMode !== "FREETEXT_ONLY") {
    if (!mcqAttempt || mcqAttempt.scaledScore == null || mcqAttempt.percentScore == null) {
      throw new Error("Cannot assess submission before MCQ completion.");
    }
    mcqScaledScore = mcqAttempt.scaledScore;
    mcqPercentScore = mcqAttempt.percentScore;
  }

  // #953, spesifikasjonens krav 2: «Ikke rør en innlevering med et endelig vedtak fra før. Statusen
  // alene er ikke nok som predikat.»
  //
  // ⚠️ Gjerdet (claimDecisionWrite) lukker ÉN retning av kappløpet: en forlatt kjøring som våkner
  // etter at et gjenforsøk tok over. Den motsatte rekkefølgen sto åpen: vedtakstransaksjonen
  // COMMITER rett før tidsgrensen utløper, men `runAssessment` rekker ikke returnere (utboks og
  // revisjon skjer etter transaksjonen). Runneren ser da en deadline-feil, setter jobben PENDING,
  // og gjenforsøket starter med friskt gjerde — overskriver COMPLETED med PROCESSING og skriver
  // dom nummer to, som kan være motsatt av den første.
  //
  // Vedtaket er predikatet, ikke statusen. Finnes det ett, er jobben ferdig — den skal ikke feile,
  // for da ville den blitt forsøkt igjen i det uendelige.
  const existingDecision = await assessmentJobRepository.findDecisionIdForSubmission(submission.id);
  if (existingDecision) {
    logOperationalEvent(
      operationalEvents.assessment.decisionAlreadyPresent,
      { jobId, submissionId: submission.id, decisionId: existingDecision.id },
    );
    return;
  }

  await assessmentJobRepository.updateSubmissionStatus(submission.id, SubmissionStatus.PROCESSING);

  // MCQ_ONLY modules (#525): no free-text, no LLM evaluation. Decide pass/fail purely from the
  // MCQ score and finish — skip the rubric/prompt-based pipeline entirely.
  if (assessmentMode === "MCQ_ONLY") {
    await applyMcqOnlyDecision({
      jobId,
      fence,
      submissionId: submission.id,
      userId: submission.userId,
      moduleId: submission.moduleId,
      moduleVersionId: submission.moduleVersionId,
      mcqScaledScore,
      mcqPercentScore,
      assessmentPolicy: assessmentPolicyCodec.parse(submission.moduleVersion.assessmentPolicyJson),
      moduleTitle: submission.moduleVersion.module.title,
      submissionLocale,
      submittedAt: submission.submittedAt,
      recipientEmail: submission.user.email,
      recipientName: submission.user.name,
      gradedSynchronously: options.gradedSynchronously === true,
    });
    return;
  }

  // FREETEXT_PLUS_MCQ + FREETEXT_ONLY path: rubric + prompt are required (MCQ_ONLY gated out above).
  const { rubricVersionId, promptTemplateVersionId } = submission.moduleVersion;
  if (rubricVersionId == null || promptTemplateVersionId == null) {
    throw new Error("Free-text module version is missing rubric/prompt configuration.");
  }

  const inputContext = buildAssessmentInputContext(submission, submissionLocale);

  // #475: evaluate the AI-influence signals into a review trigger (never a fail).
  //  • Phase 1 — the participant's AI-use declaration (+ their choice to submit after the nudge).
  //  • Phase 2 — content-similarity between the answer and an independently generated model answer.
  // Each only routes when enabled + live; in shadow mode the signals are still computed and persisted
  // (the pilot dataset). A content-similarity draft failure never breaks assessment (skipped).
  const aiRules = getAssessmentRules().aiInfluence;
  const declarationSignals = parseAiInfluenceSignals(submission.processSignalsJson);
  const declarationResult = evaluateAiInfluence({
    signals: declarationSignals,
    policy: inputContext.assessmentPolicy,
    rules: aiRules,
  });
  // Content-similarity needs its own LLM call (the model answer) but does NOT depend on the assessment
  // pipeline, so kick it off here and await it alongside the pipeline below — the extra call overlaps
  // the assessment instead of adding to it. Returns null (no extra call) when the feature is disabled.
  const contentSignalPromise = evaluateContentSimilarity({
    taskText: inputContext.moduleTaskText,
    studentAnswer: extractAnswerText(JSON.parse(submission.responseJson) as Record<string, unknown>),
    generateDraft: generateModelAnswer,
    moduleGuidanceText: inputContext.moduleGuidanceText,
    responseLocale: submissionLocale,
    rules: resolveContentSimilarityRules(inputContext.assessmentPolicy, aiRules.contentSimilarity),
  });

  await recordAuditEvent({
    entityType: auditEntityTypes.submission,
    entityId: submission.id,
    action: auditActions.assessment.sensitiveDataPreprocessed,
    actorId: submission.userId,
    metadata: {
      moduleId: submission.moduleId,
      maskingEnabled: inputContext.sensitiveDataPreprocess.maskingEnabled,
      maskingApplied: inputContext.sensitiveDataPreprocess.maskingApplied,
      totalMatches: inputContext.sensitiveDataPreprocess.totalMatches,
      ruleHits: inputContext.sensitiveDataPreprocess.ruleHits,
      fieldsMasked: inputContext.sensitiveDataPreprocess.fieldsMasked,
    },
  });

  // Run the (independent) content-similarity and the main assessment concurrently; total added latency
  // is the slower of the two, not the sum.
  const [{ finalLlmResult, forceManualReviewReason }, contentSignal] = await Promise.all([
    runLlmEvaluationPipeline({
      jobId,
      submissionId: submission.id,
      userId: submission.userId,
      moduleId: submission.moduleId,
      moduleVersionId: submission.moduleVersionId,
      promptTemplateVersionId,
      inputContext,
    }),
    contentSignalPromise,
  ]);

  const aiOutcome = buildAiInfluenceOutcome({
    declaration: declarationSignals?.declaration,
    declarationResult,
    contentSignal,
  });
  const aiInfluence = aiOutcome.decision;
  const aiInfluenceJson = aiOutcome.signalsJson;

  await applyAssessmentDecision({
    jobId,
    fence,
    submissionId: submission.id,
    userId: submission.userId,
    moduleId: submission.moduleId,
    moduleVersionId: submission.moduleVersionId,
    rubricVersionId,
    promptTemplateVersionId,
    // FREETEXT_ONLY has no MCQ attempt — scores are 0, and freetextOnly tells the decision logic to
    // scale the rubric to the full 0–100 with no MCQ gate.
    mcqScaledScore,
    mcqPercentScore,
    freetextOnly: assessmentMode === "FREETEXT_ONLY",
    aiInfluence,
    aiInfluenceJson,
    llmResult: finalLlmResult,
    forceManualReviewReason,
    assessmentPolicy: inputContext.assessmentPolicy,
    rubricMaxTotal: inputContext.rubricMaxTotal,
    rubricCriteriaIds: inputContext.rubricCriteriaIds,
    moduleTitle: submission.moduleVersion.module.title,
    submissionLocale,
    submittedAt: submission.submittedAt,
    recipientEmail: submission.user.email,
    recipientName: submission.user.name,
  });
}
