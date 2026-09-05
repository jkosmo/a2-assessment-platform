import { getAssessmentRules } from "../../config/assessmentRules.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";
import {
  hasOnlyInsufficientEvidenceRedFlags,
  hasInsufficientEvidenceSignal,
  hasLowConfidenceManualReviewSignal,
  deriveConfidenceLevel,
  recommendsManualReview,
} from "./assessmentDecisionSignals.js";
import { isConfiguredSecondaryTriggerRedFlag, normalizeRedFlags } from "./assessmentRedFlagPolicy.js";

export type SecondaryAssessmentPolicy = ReturnType<typeof getAssessmentRules>["secondaryAssessment"];

type TriggerInput = {
  moduleId: string;
  primaryResult: LlmStructuredAssessment;
  /**
   * #1023: den samlede poengsummen for PRIMÆRvurderingen, regnet ut av `resolveAssessmentDecision`.
   *
   * ⚠️ Sendes inn, ikke regnet ut her. Formelen skalerer rubrikken mot 70 eller 100 avhengig av
   * modus, og vekter inn MCQ etter modulens policy — å gjenskape den her ville gitt to steder som
   * kan gli fra hverandre, og utløseren ville stille målt mot et annet tall enn vedtaket bruker.
   *
   * `null` når kalleren ikke kan regne den ut. Da fyrer ikke grenseregelen, og de andre gjelder.
   */
  totalScore?: number | null;
};

export type SecondaryTriggerDecision = {
  enabled: boolean;
  shouldRun: boolean;
  reasons: string[];
  /**
   * #1023: hva den STRUKTURERTE regelen ville valgt. Påvirker ingenting — den er her for å måles.
   *
   * ⚠️ Dagens utløser leter etter delstrenger i språkmodellens frie tekst («medium confidence»,
   * «low confidence»). Formulerer modellen seg om, slutter den å fyre, og en besvarelse som skulle
   * fått et andre blikk får det ikke. Ingenting feiler, ingenting logges.
   *
   * Å bytte utløser er likevel ikke en opprydding: det endrer hvor ofte vi betaler for en ekstra
   * LLM-kjøring og hvor lenge deltakeren venter. Derfor måles de to mot hverandre først.
   *
   * `undefined` når utløseren aldri kom så langt (policy av, eller auto-stryk-grenen).
   */
  shadow?: SecondaryTriggerShadow;
};

export type SecondaryTriggerShadow = {
  /** Dagens regel: strukturert lavkonfidens ELLER delstrengtreff. */
  liveConfidenceTrigger: boolean;
  /** Den foreslåtte: bare strukturerte felt. */
  shadowConfidenceTrigger: boolean;
  /** Hvilke mønstre som faktisk traff. Ingen fritekst — bare mønstrene fra konfigurasjonen. */
  matchedPatterns: string[];
  /** Hele avgjørelsen, som den ville blitt med den strukturerte regelen. */
  shadowShouldRun: boolean;
  agrees: boolean;
};

export type SecondaryDisagreementDecision = {
  hasDisagreement: boolean;
  reasons: string[];
};

/**
 * Hvilke sonegrenser poengsummen ligger nær nok til å fortjene en ny vurdering.
 *
 * Båndene står i regelfila og kan justeres uten kodeendring; `null` slår av den grensen.
 */
function boundaryTriggers(
  totalScore: number | null | undefined,
  policy: SecondaryAssessmentPolicy,
): string[] {
  // `NaN` og `Infinity` trenger ingen egen vakt: `Math.abs(NaN - 60) <= 5` er usann, og det samme
  // for uendelig. Mutasjonstesting viste at en `Number.isFinite`-sjekk her ikke kunne bli rød —
  // altså kode som ikke kan observeres. Testen låser oppførselen uansett hvordan den er skrevet.
  if (typeof totalScore !== "number") return [];
  // ⚠️ Båndene kommer fra POLICYEN som sendes inn, ikke fra den globale regelfila. Første utgave
  // leste globalt, og da kunne regelen ikke overstyres — verken av en modul eller av en test. Tre
  // tester ble røde med én gang, og det er nettopp den slags stille kobling de er der for.
  const bånd = policy.triggerRules.scoreBoundaryBands;
  const rules = getAssessmentRules();
  const totalMin = rules.thresholds.totalMin;
  const gulRødGrense = totalMin - (rules.thresholds.borderlineBelowMin ?? 0);

  const ut: string[] = [];
  if (typeof bånd?.greenYellow === "number" && Math.abs(totalScore - totalMin) <= bånd.greenYellow) {
    ut.push("score_near_pass_boundary");
  }
  if (typeof bånd?.yellowRed === "number" && Math.abs(totalScore - gulRødGrense) <= bånd.yellowRed) {
    ut.push("score_near_fail_boundary");
  }
  return ut;
}

export function evaluateSecondaryAssessmentTrigger(
  input: TriggerInput,
  policy: SecondaryAssessmentPolicy = getAssessmentRules().secondaryAssessment,
): SecondaryTriggerDecision {
  const enabled = policy.moduleOverrides[input.moduleId] ?? policy.enabledByDefault;
  if (!enabled) {
    return {
      enabled: false,
      shouldRun: false,
      reasons: ["secondary assessment disabled by policy"],
    };
  }

  if (
    (input.primaryResult.red_flags.length === 0 ||
      hasOnlyInsufficientEvidenceRedFlags(input.primaryResult)) &&
    hasInsufficientEvidenceSignal(input.primaryResult)
  ) {
    return {
      enabled: true,
      shouldRun: false,
      reasons: ["primary_result_insufficient_evidence_auto_fail"],
    };
  }

  const reasons: string[] = [];
  if (policy.triggerRules.manualReviewRecommended && recommendsManualReview(input.primaryResult)) {
    reasons.push("primary_result_manual_review_recommended");
  }

  const confidenceNote = input.primaryResult.confidence_note.toLowerCase();
  const matchedPatterns = policy.triggerRules.confidenceNotePatterns.filter((pattern) =>
    confidenceNote.includes(pattern.toLowerCase()),
  );
  const structuredLowConfidence = hasLowConfidenceManualReviewSignal(input.primaryResult);
  const hasConfidenceTrigger = structuredLowConfidence || matchedPatterns.length > 0;
  if (hasConfidenceTrigger) {
    reasons.push("primary_result_low_or_medium_confidence");
  }

  // #1023: den foreslåtte regelen, regnet ut ved siden av. Den avgjør ingenting.
  const shadowConfidenceTrigger = deriveConfidenceLevel(input.primaryResult) !== null;

  const hasFlagSeverityTrigger = normalizeRedFlags(input.primaryResult.red_flags).some((flag) =>
    isConfiguredSecondaryTriggerRedFlag(flag),
  );
  if (hasFlagSeverityTrigger) {
    reasons.push("primary_result_red_flag_trigger");
  }

  // #1023: nærhet til en sonegrense.
  //
  // ⚠️ Dette er utløseren som ERSTATTER konfidensgjettingen i praksis. Målt over 63 ekte vurderinger
  // satte modellen aldri `low_confidence`, og delstrengene er engelske mens notatet skrives på
  // deltakerens språk. Poengsummen er derimot vår egen, og den er den samme uansett språk.
  //
  // Grensene kommer fra de samme tallene vedtaket bruker: `totalMin` og, under den,
  // `totalMin - borderlineBelowMin`. Den nederste er den viktigste — der går utfallet fra «et
  // menneske ser på det» til «automatisk stryk».
  for (const grense of boundaryTriggers(input.totalScore, policy)) {
    reasons.push(grense);
  }

  // Skyggeavgjørelsen: samme regnestykke, men med den strukturerte konfidensregelen.
  const shadowReasonCount =
    reasons.filter((r) => r !== "primary_result_low_or_medium_confidence").length
    + (shadowConfidenceTrigger ? 1 : 0);

  return {
    enabled: true,
    shouldRun: reasons.length > 0,
    reasons,
    shadow: {
      liveConfidenceTrigger: hasConfidenceTrigger,
      shadowConfidenceTrigger,
      matchedPatterns,
      shadowShouldRun: shadowReasonCount > 0,
      agrees: (reasons.length > 0) === (shadowReasonCount > 0),
    },
  };
}

export function evaluateSecondaryAssessmentDisagreement(
  primaryResult: LlmStructuredAssessment,
  secondaryResult: LlmStructuredAssessment,
  policy: SecondaryAssessmentPolicy = getAssessmentRules().secondaryAssessment,
): SecondaryDisagreementDecision {
  const reasons: string[] = [];

  const practicalDelta = Math.abs(primaryResult.practical_score_scaled - secondaryResult.practical_score_scaled);
  if (practicalDelta >= policy.disagreementRules.practicalScoreDeltaMin) {
    reasons.push("practical_score_delta_exceeded");
  }

  const rubricDelta = Math.abs(primaryResult.rubric_total - secondaryResult.rubric_total);
  if (rubricDelta >= policy.disagreementRules.rubricTotalDeltaMin) {
    reasons.push("rubric_total_delta_exceeded");
  }

  if (
    policy.disagreementRules.manualReviewRecommendationMismatch &&
    primaryResult.manual_review_recommended !== secondaryResult.manual_review_recommended
  ) {
    reasons.push("manual_review_recommendation_mismatch");
  }

  return {
    hasDisagreement: reasons.length > 0,
    reasons,
  };
}
