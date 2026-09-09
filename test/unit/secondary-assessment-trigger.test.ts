import { describe, expect, it } from "vitest";
import { evaluateSecondaryAssessmentTrigger } from "../../src/modules/assessment/secondaryAssessmentService.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";

// ── #1023: skyggemåling av konfidensutløseren ───────────────────────────────────────────────────
//
// ⚠️ Dagens utløser leter etter DELSTRENGER i språkmodellens frie tekst. Formulerer modellen seg om
// — «I am not very certain», eller bare norsk — slutter den å fyre, og en besvarelse som skulle
// fått et andre blikk får det ikke. Ingenting feiler, ingenting logges.
//
// Å bytte er ikke en opprydding: det endrer hvor ofte vi betaler for en ekstra LLM-kjøring. Derfor
// måles de to mot hverandre først. Testene her holder på at skyggen REGNES UT riktig, og at den
// ikke påvirker noe.
describe("#1023 — skyggeregelen måles, men avgjør ingenting", () => {
  const base = (overrides: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment => ({
    module_id: "m",
    rubric_scores: { c1: 3 },
    rubric_total: 3,
    practical_score_scaled: 40,
    pass_fail_practical: true,
    criterion_rationales: {},
    improvement_advice: [],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "High confidence: structured and sufficiently detailed submission.",
    evidence_sufficiency: "sufficient",
    recommended_outcome: "pass",
    manual_review_reason_code: "none",
    ...overrides,
  });

  // ⚠️ DEN VIKTIGSTE. Nøyaktig scenarioet saken beskriver: modellen formulerer seg utenfor
  // mønstrene, men melder usikkerhet i det STRUKTURERTE feltet. Dagens regel fyrer ikke; den
  // foreslåtte gjør det. Det er uenigheten vi vil telle.
  it("fanger at modellen melder usikkerhet uten å bruke de forventede ordene", () => {
    const decision = evaluateSecondaryAssessmentTrigger({
      moduleId: "m",
      primaryResult: base({
        confidence_note: "I am not fully certain about this judgement.",
        evidence_sufficiency: "uncertain",
      }),
    });

    expect(decision.shouldRun).toBe(false);
    expect(decision.shadow?.liveConfidenceTrigger).toBe(false);
    expect(decision.shadow?.shadowConfidenceTrigger).toBe(true);
    expect(decision.shadow?.shadowShouldRun).toBe(true);
    expect(decision.shadow?.agrees).toBe(false);
  });

  // Motsatt vei: mønsteret treffer, men de strukturerte feltene sier ingenting. Da ville et bytte
  // FJERNET en andre vurdering vi har i dag — like viktig å telle.
  it("fanger at mønsteret treffer uten dekning i de strukturerte feltene", () => {
    const decision = evaluateSecondaryAssessmentTrigger({
      moduleId: "m",
      primaryResult: base({ confidence_note: "Medium confidence in this assessment." }),
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.shadow?.matchedPatterns).toContain("medium confidence");
    expect(decision.shadow?.shadowConfidenceTrigger).toBe(false);
    expect(decision.shadow?.shadowShouldRun).toBe(false);
    expect(decision.shadow?.agrees).toBe(false);
  });

  it("er enige når begge fyrer", () => {
    const decision = evaluateSecondaryAssessmentTrigger({
      moduleId: "m",
      primaryResult: base({
        confidence_note: "Low confidence in this judgement.",
        manual_review_reason_code: "low_confidence",
      }),
    });

    expect(decision.shouldRun).toBe(true);
    expect(decision.shadow?.agrees).toBe(true);
  });

  // ⚠️ Blokkeringens makker, og den viktigste garantien i hele saken: skyggen skal ikke kunne
  // endre noe. Uten denne kunne en feil i utregningen stille begynt å styre om vi betaler for en
  // ekstra LLM-kjøring.
  it("skyggen endrer ALDRI den levende avgjørelsen", () => {
    const cases: LlmStructuredAssessment[] = [
      base(),
      base({ confidence_note: "Medium confidence.", evidence_sufficiency: "sufficient" }),
      base({ confidence_note: "Nothing matching.", evidence_sufficiency: "uncertain" }),
      base({ manual_review_recommended: true }),
    ];

    for (const primaryResult of cases) {
      const withShadow = evaluateSecondaryAssessmentTrigger({ moduleId: "m", primaryResult });
      // Den levende avgjørelsen skal utelukkende følge av `reasons` — skyggen står utenfor.
      expect(withShadow.shouldRun).toBe(withShadow.reasons.length > 0);
    }
  });

  // Ingen fritekst i det vi tar vare på — notatet kan i teorien gjengi noe kandidaten skrev.
  it("skyggen bærer mønstre, ikke selve notatet", () => {
    const decision = evaluateSecondaryAssessmentTrigger({
      moduleId: "m",
      primaryResult: base({ confidence_note: "Medium confidence. Kandidaten skrev noe personlig her." }),
    });

    expect(JSON.stringify(decision.shadow)).not.toContain("personlig");
    expect(decision.shadow?.matchedPatterns).toEqual(["medium confidence"]);
  });
});
