import { describe, expect, it } from "vitest";
import { isOutcomeSettled, isSettledPass } from "../../src/modules/assessment/submissionOutcome.js";

// #952/#948: serverens svar på «bestod dette forsøket».
//
// ⚠️ `decisionService` kan sette `needsManualReview = true` samtidig som `passFailTotal = true`.
// Tilstanden er ikke gal i seg selv — maskinen mener bestått, et menneske må bekrefte — men
// LESERNE tolket paret ulikt, og da kunne samme forsøk telles som PASS i kalibreringsrapporten
// mens kursvisningen sa IN_PROGRESS.

describe("#948 isOutcomeSettled", () => {
  it("COMPLETED er avgjort", () => {
    expect(isOutcomeSettled("COMPLETED")).toBe(true);
  });

  it("UNDER_REVIEW og SCORED er ikke avgjort", () => {
    // SCORED: poengene er satt, men rutingsbeslutningen er ikke anvendt. Samme regel som klienten.
    expect(isOutcomeSettled("UNDER_REVIEW")).toBe(false);
    expect(isOutcomeSettled("SCORED")).toBe(false);
  });

  it("manglende status er ikke avgjort", () => {
    expect(isOutcomeSettled(null)).toBe(false);
    expect(isOutcomeSettled(undefined)).toBe(false);
    expect(isOutcomeSettled("")).toBe(false);
  });
});

describe("#948 isSettledPass krever BEGGE ledd", () => {
  it("⚠️ et bestått vedtak under vurdering er ikke en bestått", () => {
    // Kjernen i saken. Uten statusleddet ville deltakeren sett modulkortet som bestått mens
    // sertifiseringen korrekt var hoppet over.
    expect(isSettledPass({ passFailTotal: true, submissionStatus: "UNDER_REVIEW" })).toBe(false);
  });

  it("en avgjort bestått er en bestått", () => {
    expect(isSettledPass({ passFailTotal: true, submissionStatus: "COMPLETED" })).toBe(true);
  });

  it("en stryk er aldri en bestått, uansett status", () => {
    expect(isSettledPass({ passFailTotal: false, submissionStatus: "COMPLETED" })).toBe(false);
    expect(isSettledPass({ passFailTotal: false, submissionStatus: "UNDER_REVIEW" })).toBe(false);
  });

  it("ingen beslutning er ikke en bestått", () => {
    // ⚠️ `null` MÅ ikke kollapse til noe annet enn «ikke bestått ennå».
    expect(isSettledPass({ passFailTotal: null, submissionStatus: "COMPLETED" })).toBe(false);
    expect(isSettledPass({})).toBe(false);
  });
});
