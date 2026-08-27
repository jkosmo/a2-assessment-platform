import { llmResponseCodec } from "../../codecs/llmResponseCodec.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";
import { parseDecisionReasonParams } from "../assessment/decisionReason.js";
import { resolveMcqMinPercent, resolveTotalMin } from "../assessment/mcqPassRule.js";
import { deriveConfidenceLevel } from "../assessment/assessmentDecisionSignals.js";
import type { ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";

/**
 * #940: modulens regler, lest tolerant.
 *
 * ⚠️ En ødelagt policy-JSON skal gi en resultatskjerm UTEN krav-tall, ikke en 500 på resultatsiden.
 * Deltakeren har bestått eller ikke uansett hva som står i dette feltet.
 */
function parseAssessmentPolicy(value: string | null | undefined): ModuleAssessmentPolicy | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ModuleAssessmentPolicy)
      : null;
  } catch {
    return null;
  }
}

export type SubmissionHistoryItem = {
  id: string;
  submittedAt: Date;
  submissionStatus: string;
  module: { id: string; title: string };
  decisions: Array<{
    id: string;
    decisionType: string;
    passFailTotal: boolean;
    totalScore: number;
    decisionReason: string;
    finalisedAt: Date | null;
  }>;
  mcqAttempts: Array<{
    id: string;
    scaledScore: number | null;
    percentScore: number | null;
    passFailMcq: boolean | null;
    completedAt: Date | null;
  }>;
  llmEvaluations: Array<{
    id: string;
    practicalScoreScaled: number;
    passFailPractical: boolean;
    manualReviewRecommended: boolean;
    createdAt: Date;
  }>;
};

export type OwnedSubmission = {
  id: string;
  submissionStatus: string;
  decisions: Array<{
    id: string;
    decisionReason: string;
    // #950: null når et menneske skrev grunnen selv, eller når raden er eldre enn feltet.
    decisionReasonCode?: string | null;
    decisionReasonParams?: string | null;
    mcqScaledScore: number;
    practicalScaledScore: number;
    totalScore: number;
  }>;
  appeals: Array<{
    id: string;
    appealStatus: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }>;
  mcqAttempts: Array<{
    id: string;
    scaledScore: number | null;
    // #940: prosenten er det deltakeren skal se — «du fikk 60 %» sier noe, «du fikk 18» gjør det
    // ikke uten en nevner, og nevneren finnes ikke lagret noe sted.
    percentScore: number | null;
    completedAt: Date | null;
  }>;
  llmEvaluations: Array<{
    id: string;
    practicalScoreScaled: number;
    confidenceNote: string | null;
    responseJson: string;
  }>;
  // #940: modulens vurderingsmodus og regler. Dataene har alltid fulgt med spørringen
  // (`include: { moduleVersion: true }`); typen nevnte dem bare ikke.
  moduleVersion?: {
    assessmentMode?: string | null;
    assessmentPolicyJson?: string | null;
  } | null;
};

function parseStructuredLlmResponse(responseJson: string | null | undefined) {
  if (!responseJson) {
    return null;
  }

  try {
    return llmResponseCodec.parse(JSON.parse(responseJson));
  } catch {
    return null;
  }
}

function getSubmissionStatusExplanation(status: string) {
  if (status === "UNDER_REVIEW") {
    return "Your submission is under manual review because confidence/red-flag rules require a human decision.";
  }
  if (status === "COMPLETED") {
    return "Final decision is available.";
  }
  return "Assessment is still processing.";
}

export function toSubmissionHistoryItemView(submission: SubmissionHistoryItem, locale: string) {
  const normalizedLocale = normalizeLocale(locale) ?? "en-GB";

  return {
    submissionId: submission.id,
    module: {
      ...submission.module,
      title: localizeContentText(normalizedLocale, submission.module.title) ?? submission.module.title,
    },
    submittedAt: submission.submittedAt,
    status: submission.submissionStatus,
    latestDecision: submission.decisions[0] ?? null,
    latestMcqAttempt: submission.mcqAttempts[0] ?? null,
    latestLlmEvaluation: submission.llmEvaluations[0] ?? null,
  };
}

export function toSubmissionHistoryResponseView(submissions: SubmissionHistoryItem[], locale: string) {
  return {
    history: submissions.map((submission) => toSubmissionHistoryItemView(submission, locale)),
  };
}

export function toSubmissionResultView(submission: OwnedSubmission) {
  const decision = submission.decisions[0] ?? null;
  const latestAppeal = submission.appeals[0] ?? null;
  const llmEvaluation = submission.llmEvaluations[0] ?? null;
  const mcqAttempt = submission.mcqAttempts.find((attempt) => attempt.completedAt !== null) ?? null;
  const llmStructured = parseStructuredLlmResponse(llmEvaluation?.responseJson);

  // #940: resultatskjermen skal si «kravet var 80 %», og det tallet fantes ikke på klienten.
  //
  // ⚠️ Oppslaget MÅ være det samme som avgjørelsen brukte. Regner visningen ut kravet på egen hånd,
  // kan skjermen si 70 % mens vedtaket ble fattet på 80 — nøyaktig utakten #949 rettet.
  const assessmentPolicy = parseAssessmentPolicy(submission.moduleVersion?.assessmentPolicyJson);
  const assessmentMode = submission.moduleVersion?.assessmentMode ?? null;

  return {
    submissionId: submission.id,
    status: submission.submissionStatus,
    statusExplanation: getSubmissionStatusExplanation(submission.submissionStatus),
    assessmentMode,
    requirement: {
      // null = ikke aktuelt for denne modultypen, ikke «ingen grense». Klienten må kunne skille
      // «kravet var 80 %» fra «denne modulen har ingen flervalgsport».
      mcqMinPercent: resolveMcqMinPercent(assessmentMode, assessmentPolicy),
      // ⚠️ SAMME oppslag som vedtaket. `?? null` her ville skjult kravet for enhver modul uten
      // eksplisitt grense — mens vedtaket ble fattet mot plattformens standard.
      totalMin: resolveTotalMin(assessmentPolicy),
      practicalMinPercent: assessmentPolicy?.passRules?.practicalMinPercent ?? null,
    },
    scoreComponents: {
      mcqScaledScore: decision?.mcqScaledScore ?? mcqAttempt?.scaledScore ?? null,
      mcqPercentScore: mcqAttempt?.percentScore ?? null,
      practicalScaledScore: decision?.practicalScaledScore ?? llmEvaluation?.practicalScoreScaled ?? null,
      totalScore: decision?.totalScore ?? null,
    },
    decision,
    latestAppeal,
    participantGuidance: {
      decisionReason: decision?.decisionReason ?? null,
      // #950: koden og tallene, slik at klienten kan skrive setningen på deltakerens språk i stedet
      // for å slå opp serverens engelske prosa i et kart. Null kode = et menneskes egne ord (eller
      // en rad fra før feltet fantes) — da vises `decisionReason` ordrett.
      decisionReasonCode: decision?.decisionReasonCode ?? null,
      decisionReasonParams: parseDecisionReasonParams(decision?.decisionReasonParams),
      confidenceNote: llmEvaluation?.confidenceNote ?? null,
      // #1019: nivået som en verdi. Klienten gjettet tidligere på delstrenger i den engelske
      // fritteksten over — se `deriveConfidenceLevel`.
      confidenceLevel: llmStructured ? deriveConfidenceLevel(llmStructured) : null,
      improvementAdvice: llmStructured?.improvement_advice ?? [],
      criterionRationales: llmStructured?.criterion_rationales ?? null,
      decisionMetadata: llmStructured
        ? {
            evidenceSufficiency: llmStructured.evidence_sufficiency ?? null,
            recommendedOutcome: llmStructured.recommended_outcome ?? null,
            manualReviewReasonCode: llmStructured.manual_review_reason_code ?? null,
          }
        : null,
    },
  };
}

export type SubmissionHistoryResponseView = ReturnType<typeof toSubmissionHistoryResponseView>;
export type SubmissionResultView = ReturnType<typeof toSubmissionResultView>;
