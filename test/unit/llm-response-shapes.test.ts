import { describe, expect, it } from "vitest";
import { deriveConfidenceLevel } from "../../src/modules/assessment/assessmentDecisionSignals.js";
import shapes from "../../src/scripts/llmResponseShapes.generated.json" with { type: "json" };

// #1025: reglene våre prøves mot EKTE LLM-svar, ikke mot hva jeg tror modellen svarer.
//
// ⚠️ HVORFOR DENNE FILA FINNES.
//
// 2026-08-27 lot #1019 `evidence_sufficiency: "insufficient"` bety «lav konfidens». Alle testene var
// grønne — de målte mot min egen antakelse. Ekte data viste at modellen i nettopp de tilfellene
// skriver «Det er høy sikkerhet i vurderingen på grunn av svarets svært begrensede innhold», altså
// det motsatte.
//
// Fiksturet er hentet med `node scripts/dev/capture-llm-shapes.mjs` og inneholder BARE form:
// strukturerte felt, tellinger og nøkkelord fra en fast liste. Ingen fritekst, ingen id-er.

describe("#1025 — reglene mot ekte LLM-svar", () => {
  it("fiksturet er stemplet, så et utdatert øyeblikksbilde kan oppdages", () => {
    // ⚠️ Bytter vi modell, er dette utdatert — og et utdatert fikstur er en NY kilde til falsk
    // trygghet. Stemplet er derfor ikke pynt.
    expect(shapes.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(shapes.capturedFrom).toContain("stage");
    expect(shapes.sampleSize).toBeGreaterThan(0);
  });

  // ⚠️ DEN VIKTIGSTE. #1019 hviler på at modellen FAKTISK fyller ut feltet. Feltene er valgfrie i
  // skjemaet; gjorde den det sjelden, ville fiksen byttet en rad som noen ganger var feil mot en
  // rad som aldri vises.
  it("språkmodellen fyller alltid ut evidence_sufficiency", () => {
    const missing = shapes.shapes.filter((s) => !s.evidenceSufficiency);
    expect(`${missing.length} av ${shapes.sampleSize} mangler evidence_sufficiency`).toBe(
      `0 av ${shapes.sampleSize} mangler evidence_sufficiency`,
    );
  });

  // ⚠️ MOTSIGELSEN SOM AVSLØRTE FEILEN, festet som en test. Så lenge dette forholdet finnes i ekte
  // data, er «utilstrekkelig grunnlag» IKKE et utsagn om hvor sikker dommen er.
  it("utilstrekkelig grunnlag opptrer sammen med HØY sikkerhet i modellens eget notat", () => {
    const insufficient = shapes.shapes.filter((s) => s.evidenceSufficiency === "insufficient");
    const alsoHighConfidence = insufficient.filter((s) =>
      s.confidenceKeywords.some((k) => k.includes("høy") || k.includes("high")),
    );

    expect(insufficient.length).toBeGreaterThan(0);
    expect(alsoHighConfidence.length).toBeGreaterThan(0);
  });

  // Regelen kjøres mot hver ekte rad. Ingen av dem skal gi «lav konfidens» på grunn av
  // utilstrekkelig grunnlag alene.
  it("regelen gir ikke lav konfidens for utilstrekkelig grunnlag i noen ekte rad", () => {
    const wrong = shapes.shapes
      .filter((s) => s.evidenceSufficiency === "insufficient" && s.manualReviewReasonCode !== "low_confidence")
      .filter((s) =>
        deriveConfidenceLevel({
          evidence_sufficiency: s.evidenceSufficiency as "insufficient",
          manual_review_reason_code: s.manualReviewReasonCode as "none",
        }) !== null,
      );

    expect(wrong.length).toBe(0);
  });

  // ⚠️ Blokkeringens makker: uten denne ville testen over vært grønn for en regel som ALLTID
  // svarer null. Den må fortsatt fyre på ekte usikkerhet.
  it("men regelen fyrer fortsatt på ekte usikkerhet", () => {
    expect(deriveConfidenceLevel({ manual_review_reason_code: "low_confidence" })).toBe("low");
    expect(deriveConfidenceLevel({ evidence_sufficiency: "uncertain" })).toBe("medium");
  });

  // Ingen personopplysninger i fiksturet — det ligger i et OFFENTLIG repo.
  it("fiksturet bærer ingen fritekst eller identifikatorer", () => {
    const raw = JSON.stringify(shapes);
    expect(raw).not.toMatch(/@/);
    // ⚠️ `cm` er base36-tidsstempelet i dagens cuid-er. Det ruller til `cn` rundt februar 2027, og
    // en vakt som leter etter «cm» ville da sluttet STILLE å matche — nøyaktig den formen for falsk
    // trygghet vi jager. Matcher derfor på `c` pluss lengde.
    expect(raw).not.toMatch(/\bc[a-z0-9]{20,}/);
    // Konfidensnotatet er lagret som lengde og nøkkelord, aldri som setning.
    for (const s of shapes.shapes) {
      expect(typeof s.confidenceNoteShape.length).toBe("number");
      expect(s).not.toHaveProperty("confidenceNote");
    }
  });
});
