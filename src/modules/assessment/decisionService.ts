import { DecisionType, SubmissionStatus } from "../../db/prismaRuntime.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { createDecisionRepository } from "../../repositories/decisionRepository.js";
import { createAssessmentJobRepository } from "./assessmentJobRepository.js";
import type { AssessmentRunFence } from "./AssessmentJobRunner.js";
import { ConflictError } from "../../errors/AppError.js";
import { runInTransaction } from "../../db/transaction.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { upsertCertificationStatusFromDecision } from "../certification/index.js";
import {
  hasForcingRedFlag,
  hasInsufficientEvidenceSignal,
  hasOnlyInsufficientEvidenceRedFlags,
  recommendsManualReview,
} from "./assessmentDecisionSignals.js";
import { redFlagsCodec } from "../../codecs/redFlagsCodec.js";
import { AssessmentMode } from "../../db/prismaRuntime.js";
import type { ModuleAssessmentPolicy } from "../../codecs/assessmentPolicyCodec.js";
import type { AiInfluenceDecision } from "./aiInfluence.js";
import {
  decisionReason as buildReason,
  decisionReasonCodes,
  serializeDecisionReasonParams,
  type DecisionReason,
  type DecisionReasonCode,
  type DecisionReasonParams,
} from "./decisionReason.js";
import {
  DEFAULT_MCQ_ONLY_MIN_PERCENT as DEFAULT_MCQ_ONLY_MIN_PERCENT_VALUE,
  resolveMcqMinPercent,
  resolveTotalMin,
} from "./mcqPassRule.js";
export type { ModuleAssessmentPolicy };

type BuildDecisionInput = {
  jobId: string;
  fence: AssessmentRunFence;
  submissionId: string;
  userId: string;
  moduleVersionId: string;
  rubricVersionId: string;
  promptTemplateVersionId: string;
  mcqScaledScore: number;
  mcqPercentScore: number;
  llmResult: LlmStructuredAssessment;
  forceManualReviewReason?: DecisionReason;
  assessmentPolicy?: ModuleAssessmentPolicy | null;
  rubricMaxTotal?: number;
  rubricCriteriaIds?: string[];
  // #578: FREETEXT_ONLY — practical/LLM-only scoring, no MCQ component. The rubric score spans the
  // full 0–100 and there is no MCQ gate.
  freetextOnly?: boolean;
  // #475: AI-influence review trigger. When present with forcesReview, routes to UNDER_REVIEW —
  // NEVER contributes to a FAIL (feeds `needsManualReview` only). Computed upstream from the
  // participant's AI-use declaration + content-similarity; see aiInfluence.ts.
  aiInfluence?: AiInfluenceDecision;
  // #475 Phase 2: the computed AI-influence signals JSON, persisted on the decision for transparency
  // and pilot analysis. Purely informational at the decision layer.
  aiInfluenceJson?: string | null;
};

export type ResolvedAssessmentDecision = {
  totalScore: number;
  practicalPercent: number | null;
  hasOpenRedFlag: boolean;
  passesThresholds: boolean;
  autoFailForInsufficientEvidence: boolean;
  needsManualReview: boolean;
  passFailTotal: boolean;
  decisionReason: string;
  /** #950: hvilken regel som avgjorde, som data. Klienten formulerer setningen fra denne. */
  decisionReasonCode: DecisionReasonCode;
  /** Tallene setningen trenger (terskler, poeng). Tomt objekt når grunnen ikke har tall. */
  decisionReasonParams: DecisionReasonParams;
};

type ResolveAssessmentDecisionInput = Pick<
  BuildDecisionInput,
  "mcqScaledScore" | "mcqPercentScore" | "llmResult" | "forceManualReviewReason" | "assessmentPolicy" | "rubricMaxTotal" | "rubricCriteriaIds" | "freetextOnly" | "aiInfluence"
>;

export function resolveAssessmentDecision(input: ResolveAssessmentDecisionInput): ResolvedAssessmentDecision {
  const rules = getAssessmentRules();
  const totalMin = resolveTotalMin(input.assessmentPolicy);
  const rubricMaxTotal = input.rubricMaxTotal ?? 20;

  // Recompute rubric total server-side: filter to known criteria (if provided),
  // clamp each score to [0,4], then sum. Never trust LLM-reported totals.
  const knownCriteriaIds = input.rubricCriteriaIds ?? [];
  const rawScores = input.llmResult.rubric_scores;
  const validatedScores =
    knownCriteriaIds.length > 0
      ? Object.fromEntries(
          knownCriteriaIds.map((id) => [id, Math.max(0, Math.min(4, rawScores[id] ?? 0))]),
        )
      : Object.fromEntries(
          Object.entries(rawScores).map(([id, score]) => [id, Math.max(0, Math.min(4, score))]),
        );

  const recomputedRubricTotal = Object.values(validatedScores).reduce((sum, s) => sum + s, 0);
  const totalsInconsistent = recomputedRubricTotal !== input.llmResult.rubric_total;

  // #578: FREETEXT_ONLY has no MCQ component, so the rubric/practical score spans the full 0–100
  // (instead of the 0–70 practical band that leaves 30 for MCQ in FREETEXT_PLUS_MCQ).
  const freetextOnly = input.freetextOnly === true;
  const practicalScaleMax = freetextOnly ? 100 : 70;
  const recomputedPracticalScoreScaled =
    rubricMaxTotal > 0 ? Number(((recomputedRubricTotal / rubricMaxTotal) * practicalScaleMax).toFixed(2)) : 0;

  const effectivePracticalScaledScore =
    !freetextOnly && input.assessmentPolicy?.scoring?.practicalWeight != null
      ? (recomputedPracticalScoreScaled / rules.weights.practicalMaxScore) * input.assessmentPolicy.scoring.practicalWeight
      : recomputedPracticalScoreScaled;
  const effectiveMcqScaledScore =
    freetextOnly
      ? 0
      : input.assessmentPolicy?.scoring?.mcqWeight != null
        ? (input.mcqPercentScore / 100) * input.assessmentPolicy.scoring.mcqWeight
        : input.mcqScaledScore;
  const totalScore = Number((effectivePracticalScaledScore + effectiveMcqScaledScore).toFixed(2));
  const practicalPercent = rubricMaxTotal > 0 ? (recomputedRubricTotal / rubricMaxTotal) * 100 : null;

  const mcqMinPercent = input.assessmentPolicy?.passRules?.mcqMinPercent ?? null;
  const practicalMinPercent = input.assessmentPolicy?.passRules?.practicalMinPercent ?? null;

  const hasOpenRedFlag = hasForcingRedFlag(input.llmResult, rules.manualReview.redFlagSeverities);
  const hasOnlyInsufficientEvidenceFlags = hasOnlyInsufficientEvidenceRedFlags(input.llmResult);

  // FREETEXT_ONLY has no MCQ gate.
  const mcqGatePasses = freetextOnly || mcqMinPercent === null || input.mcqPercentScore >= mcqMinPercent;
  const practicalGatePasses =
    practicalMinPercent === null ||
    (practicalPercent !== null && practicalPercent >= practicalMinPercent);

  const passesThresholds =
    totalScore >= totalMin && !hasOpenRedFlag && mcqGatePasses && practicalGatePasses;

  const llmRecommendsManualReview = recommendsManualReview(input.llmResult);

  const autoFailForInsufficientEvidence =
    !input.forceManualReviewReason &&
    !hasOpenRedFlag &&
    !passesThresholds &&
    (hasInsufficientEvidenceSignal(input.llmResult) || hasOnlyInsufficientEvidenceFlags);

  // v1.2.20 (#464): borderline-window — totalScore i [min, max] router til manuell
  // vurdering. Overstyrer auto-pass selv om threshold-rules ellers passerer. Brukes til
  // grensetilfeller forfatter vil ha assessor til å se på.
  const borderlineWindow = input.assessmentPolicy?.passRules?.borderlineWindow;
  const isInBorderlineWindow =
    borderlineWindow !== undefined &&
    typeof borderlineWindow.min === "number" &&
    typeof borderlineWindow.max === "number" &&
    totalScore >= borderlineWindow.min &&
    totalScore <= borderlineWindow.max;

  // #475: AI-influence is a review TRIGGER only. It feeds `needsManualReview` (below) and forces
  // `passFailTotal` to false so a would-pass submission is not auto-passed — mirroring borderlineWindow.
  // It NEVER touches `passesThresholds` or `autoFailForInsufficientEvidence`, so it can never turn a
  // pass into a fail; at most it turns an outcome into a review a human resolves.
  const aiInfluenceForcesReview = Boolean(input.aiInfluence?.forcesReview);

  const needsManualReview =
    Boolean(input.forceManualReviewReason) ||
    totalsInconsistent ||
    hasOpenRedFlag ||
    (llmRecommendsManualReview && !autoFailForInsufficientEvidence) ||
    isInBorderlineWindow ||
    aiInfluenceForcesReview;

  // #950: hver gren gir en KODE og tallene setningen trenger, ved siden av den engelske teksten.
  // Teksten er uendret fra før — den lagres, logges og vises til sensor. Koden er det deltakerens
  // grensesnitt formulerer setningen fra, på sitt eget språk.
  const componentFailReason: DecisionReason | null = !mcqGatePasses
    ? buildReason(
        decisionReasonCodes.autoFailMcqBelowMinimum,
        "Automatic fail: MCQ score below required minimum.",
      )
    : !practicalGatePasses
      ? buildReason(
          decisionReasonCodes.autoFailPracticalBelowMinimum,
          "Automatic fail: practical score below required minimum.",
        )
      : null;

  const resolvedReason: DecisionReason = needsManualReview
    ? input.forceManualReviewReason ??
      (totalsInconsistent
        ? buildReason(
            decisionReasonCodes.manualReviewScoreInconsistency,
            "LLM score inconsistency detected — routed to manual review.",
          )
        : isInBorderlineWindow
          ? buildReason(
              decisionReasonCodes.manualReviewBorderline,
              `Routed to manual review: total score ${totalScore} is in the borderline window [${borderlineWindow!.min}, ${borderlineWindow!.max}].`,
              { totalScore, min: borderlineWindow!.min, max: borderlineWindow!.max },
            )
          : hasOpenRedFlag || llmRecommendsManualReview
            ? buildReason(
                decisionReasonCodes.manualReviewRedFlagOrConfidence,
                "Automatically routed to manual review due to red flag / confidence rule.",
              )
            : aiInfluenceForcesReview
              ? buildReason(input.aiInfluence!.code, input.aiInfluence!.reason, input.aiInfluence!.params)
              : buildReason(
                  decisionReasonCodes.manualReviewRedFlagOrConfidence,
                  "Automatically routed to manual review due to red flag / confidence rule.",
                ))
    : autoFailForInsufficientEvidence
      ? buildReason(
          decisionReasonCodes.autoFailInsufficientEvidence,
          "Automatic fail due to insufficient submission evidence.",
        )
      : passesThresholds
        ? buildReason(decisionReasonCodes.autoPassThresholds, "Automatic pass by threshold rules.")
        : componentFailReason ??
          buildReason(decisionReasonCodes.autoFailThresholds, "Automatic fail by threshold rules.");

  const decisionReason = resolvedReason.text;

  return {
    totalScore,
    practicalPercent,
    hasOpenRedFlag,
    passesThresholds,
    autoFailForInsufficientEvidence,
    needsManualReview,
    // v1.2.20 (#464): passFailTotal er false når i borderline-window — kandidaten har
    // ikke automatisk bestått selv om threshold-rules ellers passerte. Assessor må
    // bekrefte. #475: samme for AI-influence review — en besvarelse rutet til review er
    // ikke automatisk bestått.
    // #948: et vedtak kan ALDRI baere `passFailTotal: true` mens innleveringen gaar til manuell
    // vurdering. Seks ting kan utloese en slik vurdering; foer denne linja tvang bare to av dem
    // (`isInBorderlineWindow` og `aiInfluenceForcesReview`) flagget til false. De oevrige — et
    // paatvunget `forceManualReviewReason`, `totalsInconsistent`, og en modell som ber om
    // menneskeblikk — lot et «bestaatt» vedtak staa mens sensor ennaa ikke hadde sett saken.
    //
    // ⚠️ Konsekvensen laa hos LESERNE, og de er tolv: deltakeren saa modulkortet som bestaatt,
    // kalibreringsrapporten talte forsoeket som PASS, kursrapporten sa IN_PROGRESS. Aa lappe tolv
    // lesere ville vaert feil form — og én ville blitt glemt. Invarianten hoerer i kilden.
    //
    // Dette gjoer ikke en bestaatt til en stroeket: `passFailTotal: false` + UNDER_REVIEW leses som
    // «til vurdering», ikke som «ikke bestaatt» — samme moenster #475 allerede etablerte for
    // ai-influence, med den uttrykkelige begrunnelsen at et signal aldri skal kunne felle noen.
    passFailTotal: passesThresholds && !needsManualReview,
    decisionReason,
    decisionReasonCode: resolvedReason.code,
    decisionReasonParams: resolvedReason.params,
  };
}

// Default MCQ pass threshold (percent) for MCQ-only modules when the author has not set an
// explicit assessmentPolicy.passRules.mcqMinPercent (#525).
// #949: konstanten bor nå i mcqPassRule.ts, sammen med regelen som bruker den. Re-eksporteres
// her fordi eksisterende kallsteder og tester importerer den herfra.
export { DEFAULT_MCQ_ONLY_MIN_PERCENT } from "./mcqPassRule.js";

type BuildMcqOnlyDecisionInput = {
  jobId: string;
  fence: AssessmentRunFence;
  submissionId: string;
  userId: string;
  moduleVersionId: string;
  mcqScaledScore: number;
  mcqPercentScore: number;
  assessmentPolicy?: ModuleAssessmentPolicy | null;
};

/**
 * Decision for an MCQ_ONLY module (#525): no free-text, no LLM evaluation. Pass/fail is decided
 * purely by the MCQ score against a threshold (author-configurable via
 * assessmentPolicy.passRules.mcqMinPercent, defaulting to 70%). Always an AUTOMATIC decision —
 * there is no rubric, red-flag or manual-review path.
 */
export function resolveMcqOnlyDecision(
  mcqPercentScore: number,
  mcqMinPercent: number,
): { passFailTotal: boolean; decisionReason: string; decisionReasonCode: DecisionReasonCode; decisionReasonParams: DecisionReasonParams } {
  const passFailTotal = mcqPercentScore >= mcqMinPercent;
  // Round the displayed score to 2 decimals (raw can be e.g. 66.6666… ) — #546 feedback.
  const shownScore = Math.round(mcqPercentScore * 100) / 100;
  // #950: DENNE var den synligste. En ren MCQ-modul er den vanligste veien gjennom systemet, og
  // grunnen har tall i seg — den kunne aldri slås opp i et tekstkart, så en norsk deltaker fikk
  // «Automatic pass: MCQ score 100% meets the required minimum of 70%.» i et ellers norsk skjermbilde.
  const reason = passFailTotal
    ? buildReason(
        decisionReasonCodes.mcqOnlyPass,
        `Automatic pass: MCQ score ${shownScore}% meets the required minimum of ${mcqMinPercent}%.`,
        { scorePercent: shownScore, minPercent: mcqMinPercent },
      )
    : buildReason(
        decisionReasonCodes.mcqOnlyFail,
        `Automatic fail: MCQ score ${shownScore}% is below the required minimum of ${mcqMinPercent}%.`,
        { scorePercent: shownScore, minPercent: mcqMinPercent },
      );
  return {
    passFailTotal,
    decisionReason: reason.text,
    decisionReasonCode: reason.code,
    decisionReasonParams: reason.params,
  };
}

export async function createMcqOnlyDecision(input: BuildMcqOnlyDecisionInput) {
  // #949: samme oppslag som visningsfeltet, så de to ikke kan komme i utakt igjen.
  const mcqMinPercent =
    resolveMcqMinPercent(AssessmentMode.MCQ_ONLY, input.assessmentPolicy)
    ?? DEFAULT_MCQ_ONLY_MIN_PERCENT_VALUE;
  const { passFailTotal, decisionReason, decisionReasonCode, decisionReasonParams } =
    resolveMcqOnlyDecision(input.mcqPercentScore, mcqMinPercent);

  return runInTransaction(async (tx) => {
    const repo = createDecisionRepository(tx);
    // #953: gjerdet FØRST i transaksjonen. Er dette en forlatt kjøring (#856) som våknet etter at
    // et gjenforsøk overtok, eier den ikke lenger jobben — og da skal vedtaket ikke skrives. Kastes
    // her, ruller hele transaksjonen tilbake, så ingen halv dom blir liggende.
    const stillOurs = await createAssessmentJobRepository(tx).claimDecisionWrite(
      input.jobId,
      input.fence.lockedBy,
      input.fence.lockedAt,
    );
    if (stillOurs.count === 0) {
      throw new ConflictError(
        "assessment_run_superseded",
        "This assessment run no longer owns its job — a newer run has taken over. Discarding the verdict.",
      );
    }


    const decision = await repo.createAssessmentDecision({
      submissionId: input.submissionId,
      moduleVersionId: input.moduleVersionId,
      rubricVersionId: null,
      promptTemplateVersionId: null,
      mcqScaledScore: input.mcqScaledScore,
      practicalScaledScore: 0,
      totalScore: input.mcqScaledScore,
      redFlagsJson: redFlagsCodec.serialize([]),
      passFailTotal,
      decisionType: DecisionType.AUTOMATIC,
      decisionReason,
      decisionReasonCode,
      decisionReasonParams: serializeDecisionReasonParams(decisionReasonParams),
      finalisedById: input.userId,
    });

    await repo.updateSubmissionStatus(input.submissionId, SubmissionStatus.COMPLETED);

    await upsertCertificationStatusFromDecision({
      decisionId: decision.id,
      actorId: input.userId,
    }, tx);

    await recordAuditEvent({
      entityType: auditEntityTypes.assessmentDecision,
      entityId: decision.id,
      action: auditActions.assessment.decisionCreated,
      actorId: input.userId,
      metadata: {
        submissionId: input.submissionId,
        totalScore: input.mcqScaledScore,
        needsManualReview: false,
        assessmentMode: "MCQ_ONLY",
        passFailTotal: decision.passFailTotal,
      },
    }, tx);

    return { decision, needsManualReview: false as const };
  });
}

export async function createAssessmentDecision(input: BuildDecisionInput) {
  const practicalScoreScaled = input.llmResult.practical_score_scaled;
  const resolved = resolveAssessmentDecision(input);

  return runInTransaction(async (tx) => {
    const repo = createDecisionRepository(tx);
    // #953: gjerdet FØRST i transaksjonen. Er dette en forlatt kjøring (#856) som våknet etter at
    // et gjenforsøk overtok, eier den ikke lenger jobben — og da skal vedtaket ikke skrives. Kastes
    // her, ruller hele transaksjonen tilbake, så ingen halv dom blir liggende.
    const stillOurs = await createAssessmentJobRepository(tx).claimDecisionWrite(
      input.jobId,
      input.fence.lockedBy,
      input.fence.lockedAt,
    );
    if (stillOurs.count === 0) {
      throw new ConflictError(
        "assessment_run_superseded",
        "This assessment run no longer owns its job — a newer run has taken over. Discarding the verdict.",
      );
    }


    const decision = await repo.createAssessmentDecision({
      submissionId: input.submissionId,
      moduleVersionId: input.moduleVersionId,
      rubricVersionId: input.rubricVersionId,
      promptTemplateVersionId: input.promptTemplateVersionId,
      mcqScaledScore: input.mcqScaledScore,
      practicalScaledScore: practicalScoreScaled,
      totalScore: resolved.totalScore,
      redFlagsJson: redFlagsCodec.serialize(input.llmResult.red_flags),
      aiInfluenceJson: input.aiInfluenceJson ?? null,
      passFailTotal: resolved.passFailTotal,
      decisionType: DecisionType.AUTOMATIC,
      decisionReason: resolved.decisionReason,
      decisionReasonCode: resolved.decisionReasonCode,
      decisionReasonParams: serializeDecisionReasonParams(resolved.decisionReasonParams),
      finalisedById: input.userId,
    });

    if (resolved.needsManualReview) {
      const review = await repo.createManualReview({
        submissionId: input.submissionId,
        triggerReason: decision.decisionReason,
        reviewStatus: "OPEN",
      });

      await recordAuditEvent({
        entityType: auditEntityTypes.manualReview,
        entityId: review.id,
        action: auditActions.manualReview.opened,
        actorId: input.userId,
        metadata: {
          submissionId: input.submissionId,
          decisionId: decision.id,
          triggerReason: review.triggerReason,
        },
      }, tx);
    }

    await repo.updateSubmissionStatus(
      input.submissionId,
      resolved.needsManualReview ? SubmissionStatus.UNDER_REVIEW : SubmissionStatus.COMPLETED,
    );

    if (!resolved.needsManualReview) {
      await upsertCertificationStatusFromDecision({
        decisionId: decision.id,
        actorId: input.userId,
      }, tx);
    }

    await recordAuditEvent({
      entityType: auditEntityTypes.assessmentDecision,
      entityId: decision.id,
      action: auditActions.assessment.decisionCreated,
      actorId: input.userId,
      metadata: {
        submissionId: input.submissionId,
        totalScore: resolved.totalScore,
        needsManualReview: resolved.needsManualReview,
        // ⚠️ .text, ikke hele objektet. Feltet var en streng før #950, og revisjonsloggen leses av
        // mennesker og av eldre eksporter — å bytte det til et objekt ville vært en stille
        // formatendring i et spor som skal være stabilt. Koden legges ved som eget felt i stedet.
        forceManualReviewReason: input.forceManualReviewReason?.text ?? null,
        decisionReasonCode: resolved.decisionReasonCode,
        passFailTotal: decision.passFailTotal,
      },
    }, tx);

    return { decision, needsManualReview: resolved.needsManualReview };
  });
}
