import { describe, expect, it } from "vitest";
import {
  deriveConfidenceLevel,
  hasInsufficientEvidenceSignal,
  hasStructuredInsufficientEvidenceSignal,
  matchedInsufficientEvidencePatterns,
} from "../../src/modules/assessment/assessmentDecisionSignals.js";
import type { LlmStructuredAssessment } from "../../src/modules/assessment/llmAssessmentService.js";

// ── #1019: forbeholdet som en verdi ─────────────────────────────────────────────────────────────
//
// ⚠️ Klienten gjettet tidligere på delstrenger i språkmodellens engelske frittekst. Bommet den, sto
// engelsk i et norsk skjermbilde — og notatet er GENERERT, så det kan formuleres om når som helst
// uten at noe i repoet endres. Testene her holder på at nivået kommer fra de STRUKTURERTE feltene,
// som prompten allerede ber om.
describe("#1019 — konfidensnivået utledes av strukturerte felt, ikke av prosa", () => {
  it("språkmodellens eksplisitte lavkonfidens-kode gir lavt nivå", () => {
    expect(deriveConfidenceLevel({ manual_review_reason_code: "low_confidence" })).toBe("low");
  });


  // ⚠️ DEN VIKTIGSTE, OG DEN BLE FUNNET AV EKTE DATA — ikke av resonnement.
  //
  // Et første utkast lot «utilstrekkelig grunnlag» bety «lav konfidens». Ti ekte vurderinger på
  // stage viste at det er feil, og ofte det motsatte: der grunnlaget var utilstrekkelig, skrev
  // modellen selv «Det er høy sikkerhet i vurderingen på grunn av svarets svært begrensede
  // innhold». Leverer noen noe tomt, er modellen nettopp SIKKER på at det stryker.
  //
  // De to feltene svarer på ulike spørsmål: «var det nok i besvarelsen?» og «hvor sikker er
  // dommen?». Å si «lav sikkerhet, du kan klage» til en som leverte tomt, er usant.
  it("utilstrekkelig grunnlag er IKKE lav konfidens — det er et utsagn om besvarelsen", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "insufficient" })).toBeNull();
    expect(deriveConfidenceLevel({ manual_review_reason_code: "insufficient_evidence" })).toBeNull();
  });

  // Blokkeringens makker: ekte usikkerhet skal fortsatt gi et nivå, ellers ville testen over vært
  // grønn for en funksjon som alltid svarer null.
  it("men ekte usikkerhet gir det fortsatt", () => {
    expect(deriveConfidenceLevel({ manual_review_reason_code: "low_confidence" })).toBe("low");
    expect(deriveConfidenceLevel({ evidence_sufficiency: "uncertain" })).toBe("medium");
  });

  it("usikkert grunnlag er middels", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "uncertain" })).toBe("medium");
  });

  // ⚠️ «Høy konfidens» er IKKE et forbehold. En rad som forteller deltakeren at alt er som det skal,
  // bruker plass uten å si noe — samme regel som #940 innførte for de tomme radene.
  it("tilstrekkelig grunnlag gir INGEN rad", () => {
    expect(deriveConfidenceLevel({ evidence_sufficiency: "sufficient" })).toBeNull();
  });

  // Feltene er valgfrie i skjemaet. Et svar uten dem skal gi taushet, ikke en gjetning.
  it("uten strukturerte felt sies ingenting", () => {
    expect(deriveConfidenceLevel({})).toBeNull();
  });

  // Blokkeringens makker: den eksplisitte koden skal vinne over et tilstrekkelig grunnlag, ellers
  // ville en modell som sier «lav konfidens, men nok dokumentasjon» blitt stum.
  it("den eksplisitte koden vinner over grunnlagsvurderingen", () => {
    expect(deriveConfidenceLevel({
      manual_review_reason_code: "low_confidence",
      evidence_sufficiency: "sufficient",
    })).toBe("low");
  });
});

// ── #1026: delstreng-reserven for «utilstrekkelig grunnlag» ────────────────────────────────────
//
// ⚠️ HVA SOM STÅR PÅ SPILL. Signalet søker i FORBEDRINGSRÅDENE. Et treff inngår i
// `autoFailForInsufficientEvidence`, som undertrykker manuell vurdering:
//
//     needsManualReview = … || (llmRecommendsManualReview && !autoFailForInsufficientEvidence) || …
//
// Anbefaler modellen at et menneske ser på saken, men et råd inneholder «additional material», blir
// det automatisk stryk i stedet. Ingen sensor ser den.
describe("#1026 — en frase i et forbedringsråd kan fjerne sensoren fra sløyfa", () => {
  const base = (overrides: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment => ({
    module_id: "m",
    rubric_scores: { c1: 2 },
    rubric_total: 2,
    practical_score_scaled: 20,
    pass_fail_practical: false,
    criterion_rationales: {},
    improvement_advice: [],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "Solid enough to judge.",
    evidence_sufficiency: "sufficient",
    recommended_outcome: "fail",
    manual_review_reason_code: "none",
    ...overrides,
  });

  // ⚠️ DEN VIKTIGSTE. Et helt vanlig råd til en besvarelse som kunne vært bedre — ikke en tom
  // besvarelse — utløser signalet, selv om de strukturerte feltene sier at grunnlaget var
  // TILSTREKKELIG.
  it("et vanlig forbedringsråd utløser signalet, tvers imot de strukturerte feltene", () => {
    const result = base({
      evidence_sufficiency: "sufficient",
      improvement_advice: ["Add a more detailed reflection on your own process."],
    });

    expect(hasStructuredInsufficientEvidenceSignal(result)).toBe(false);
    expect(matchedInsufficientEvidencePatterns(result)).toContain("detailed reflection");
    // Og det samlede signalet — det som faktisk styrer — sier likevel «utilstrekkelig».
    expect(hasInsufficientEvidenceSignal(result)).toBe(true);
  });

  it("«additional material» i et råd gjør det samme", () => {
    const result = base({
      improvement_advice: ["Consider including additional material to support your argument."],
    });

    expect(hasStructuredInsufficientEvidenceSignal(result)).toBe(false);
    expect(hasInsufficientEvidenceSignal(result)).toBe(true);
  });

  // Blokkeringens makker: et ekte tomt svar skal fortsatt gi signalet, og det skal komme fra de
  // STRUKTURERTE feltene — ikke fra en frase.
  it("en ekte tom besvarelse fanges av de strukturerte feltene alene", () => {
    const result = base({ evidence_sufficiency: "insufficient", improvement_advice: [] });

    expect(hasStructuredInsufficientEvidenceSignal(result)).toBe(true);
    expect(matchedInsufficientEvidencePatterns(result)).toEqual([]);
  });

  // ⚠️ OPPFØRSELEN ER UENDRET. Delingen er der for å måle reserven, ikke for å skru den av. Uten
  // denne kunne en «opprydding» stille ha endret hvilke besvarelser som stryker automatisk.
  it("det samlede signalet er fortsatt strukturert ELLER mønster", () => {
    const cases: Array<[LlmStructuredAssessment, boolean]> = [
      [base(), false],
      [base({ evidence_sufficiency: "insufficient" }), true],
      [base({ manual_review_reason_code: "insufficient_evidence" }), true],
      [base({ improvement_advice: ["needs additional material"] }), true],
      [base({ confidence_note: "requires resubmission" }), true],
      [base({ criterion_rationales: { c1: "no qa checks documented" } }), true],
    ];

    for (const [result, expected] of cases) {
      expect(hasInsufficientEvidenceSignal(result)).toBe(expected);
    }
  });

  // Måledataene skal kunne si HVILKE mønstre som bærer treffene, ikke bare at det var et treff.
  it("reserven navngir mønstrene, slik at målingen kan skille dem", () => {
    const result = base({
      improvement_advice: ["Add a detailed reflection", "and some additional material"],
    });

    const matched = matchedInsufficientEvidencePatterns(result);
    expect(matched).toContain("detailed reflection");
    expect(matched).toContain("additional material");
  });
});
