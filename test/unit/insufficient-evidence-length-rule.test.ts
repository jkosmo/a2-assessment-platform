import { describe, expect, it } from "vitest";
import { isSubstantiallyShort, resolveAssessmentDecision } from "../../src/modules/assessment/decisionService.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1048: modellens anmodning om et MENNESKE er hovedregelen. Automatisk stryk er unntaket.
//
// ⚠️ MÅLT PROBLEM, ikke antatt. 78 ekte vurderinger på stage 2026-09-05: modellen ba om
// menneskelig vurdering i 21, og null nådde en sensor. Alle 21 ble automatisk strøket.
//
// Modellen sier to ting samtidig — «det var for lite her» og «et menneske bør se på dette» — og vi
// hørte bare det ene. Produkteiers regel snur bevisbyrden: automatisk stryk må begrunnes med et
// målbart faktum, nemlig at besvarelsen er vesentlig kortere enn oppgaven ba om.
//
// ⚠️ ENDRINGEN KAN BARE GÅ ÉN VEI. Betingelsen er den gamle OG den nye; en `&&` kan bare gjøre
// mengden mindre. Uansett hvilket minimum en forfatter setter, blir det aldri strengere enn før.
// ─────────────────────────────────────────────────────────────────────────────

const llm = (over: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment => ({
  module_id: "m1",
  rubric_scores: { c1: 0 },
  rubric_total: 0,
  practical_score_scaled: 0,
  pass_fail_practical: false,
  criterion_rationales: {},
  improvement_advice: [],
  red_flags: [],
  // Modellen ber om et menneske OG melder at grunnlaget var tynt. Det er nettopp kombinasjonen
  // som ble automatisk strøket 21 av 21 ganger.
  manual_review_recommended: true,
  confidence_note: "",
  evidence_sufficiency: "insufficient",
  recommended_outcome: "manual_review",
  manual_review_reason_code: "insufficient_evidence",
  ...over,
}) as LlmStructuredAssessment;

const vedtak = (
  answerWordCount: number | null,
  expectedMinWords: number | null,
  over: Partial<LlmStructuredAssessment> = {},
) =>
  resolveAssessmentDecision({
    mcqScaledScore: 0,
    mcqPercentScore: 0,
    llmResult: llm(over),
    forceManualReviewReason: undefined,
    assessmentPolicy: null,
    rubricMaxTotal: 20,
    rubricCriteriaIds: ["c1"],
    freetextOnly: true,
    aiInfluence: undefined,
    answerWordCount,
    expectedMinWords,
  });

describe("isSubstantiallyShort", () => {
  it("måler mot en ANDEL av forventet minimum, ikke et fast ordtall", () => {
    // 40 av 100 forventet er noe helt annet enn 280 av 300, selv om differansen i ord er lik.
    expect(isSubstantiallyShort(40, 100, 0.5)).toBe(true);
    expect(isSubstantiallyShort(280, 300, 0.5)).toBe(false);
  });

  it("er en streng ulikhet på terskelen", () => {
    expect(isSubstantiallyShort(50, 100, 0.5)).toBe(false);
    expect(isSubstantiallyShort(49, 100, 0.5)).toBe(true);
  });

  it("⚠️ sier NEI når vi ikke kan måle — da vinner mennesket", () => {
    // Uten svarlengde eller uten forventning finnes ikke faktumet som skal begrunne unntaket.
    // `false` her betyr «ikke grunnlag for automatisk stryk», som er hovedregelen.
    expect(isSubstantiallyShort(null, 100, 0.5)).toBe(false);
    expect(isSubstantiallyShort(40, null, 0.5)).toBe(false);
    expect(isSubstantiallyShort(undefined, undefined, 0.5)).toBe(false);
    expect(isSubstantiallyShort(40, 0, 0.5)).toBe(false);
  });
});

describe("#1048 — vedtaket, ende til ende", () => {
  it("⚠️ en vesentlig for kort besvarelse strykes automatisk, som før", () => {
    // Blokkeringens makker. Uten denne kunne regelen ha slått av auto-stryk helt, og testen under
    // ville sett lik ut. En tom eller nesten tom besvarelse skal fortsatt ikke bruke sensortid.
    const d = vedtak(30, 100);
    expect(d.autoFailForInsufficientEvidence, "30 av 100 forventede ord").toBe(true);
    expect(d.needsManualReview, "auto-stryk undertrykker anmodningen").toBe(false);
  });

  it("⚠️ en besvarelse som IKKE er vesentlig kort går til et menneske", () => {
    // Dette er de 21. Modellen sier «for lite grunnlag» OG «et menneske bør se på det», og
    // besvarelsen er 80 % av forventet lengde. Før denne endringen ble den automatisk strøket.
    const d = vedtak(80, 100);
    expect(d.autoFailForInsufficientEvidence).toBe(false);
    expect(d.needsManualReview, "modellens anmodning skal nå vinne").toBe(true);
  });

  it("⚠️ uten forventet minimum vinner mennesket", () => {
    // En modul uten eget omfang og uten et gjenkjennelig nivå gir ingen forventning. Da mangler
    // faktumet som skal begrunne unntaket, og hovedregelen står. Retningen er i kandidatens favør.
    const d = vedtak(30, null);
    expect(d.autoFailForInsufficientEvidence).toBe(false);
    expect(d.needsManualReview).toBe(true);
  });

  it("uten svarlengde vinner mennesket", () => {
    const d = vedtak(null, 100);
    expect(d.autoFailForInsufficientEvidence).toBe(false);
    expect(d.needsManualReview).toBe(true);
  });

  it("⚠️ ba modellen IKKE om et menneske, står auto-stryk som før", () => {
    // ⚠️ REGELEN GJELDER BARE KONFLIKTEN. Produkteiers sak handler om at «det er ikke nok her» og
    // «et menneske bør se på den» blir sagt samtidig, og at vi bare hørte det første. Sier modellen
    // bare det første, finnes ingen anmodning å overstyre, og ingenting skal endre seg.
    //
    // ⚠️ FØRSTE UTGAVE MANGLET DENNE BETINGELSEN. Integrasjonssuiten fant det: seks policy-tester
    // gikk fra COMPLETED til UNDER_REVIEW bare fordi modulen manglet et målbart nivå — saker ville
    // havnet hos en sensor uten at noen hadde bedt om det. Det er en helt annen endring enn den
    // saken beskriver, og den ville rammet bredt.
    const d = vedtak(80, 100, {
      manual_review_recommended: false,
      recommended_outcome: "fail",
      manual_review_reason_code: "none",
    });
    // 80 av 100 er IKKE vesentlig kort — nøyaktig tilfellet som over gikk til et menneske. Her skal
    // det likevel strykes, og forskjellen er utelukkende at modellen ikke ba om noen.
    expect(d.autoFailForInsufficientEvidence, "ingen anmodning å overstyre").toBe(true);
    expect(d.needsManualReview).toBe(false);
  });

  it("⚠️ poengsummen er urørt — dette handler om HVEM som avgjør, ikke om utfallet", () => {
    // En besvarelse som stryker på terskel, stryker fortsatt. Endringen flytter bare avgjørelsen
    // fra en maskin alene til et menneske som ser på saken.
    const kort = vedtak(30, 100);
    const lang = vedtak(80, 100);
    expect(kort.passesThresholds).toBe(false);
    expect(lang.passesThresholds, "ingen av dem består terskelen").toBe(false);
    expect(kort.totalScore).toBe(lang.totalScore);
  });
});
