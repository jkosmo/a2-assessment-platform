import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCQ_ONLY_MIN_PERCENT,
  deriveMcqPassFail,
  resolveMcqMinPercent,
} from "../../src/modules/assessment/mcqPassRule.js";

// #949: visningsfeltet `passFailMcq` ble regnet ut med en hardkodet 50 %-grense mens vedtaket
// brukte modulens policy. Denne suiten fester at de tre modustypene har ULIKE riktige svar — det
// er derfor regelen ikke kunne erstattes med én terskel overalt.

describe("#949 resolveMcqMinPercent — tre modustyper, tre regler", () => {
  it("MCQ_ONLY uten policy bruker 70 %", () => {
    expect(resolveMcqMinPercent("MCQ_ONLY", null)).toBe(DEFAULT_MCQ_ONLY_MIN_PERCENT);
    expect(DEFAULT_MCQ_ONLY_MIN_PERCENT).toBe(70);
  });

  it("MCQ_ONLY med eksplisitt grense bruker den", () => {
    expect(resolveMcqMinPercent("MCQ_ONLY", { passRules: { mcqMinPercent: 85 } })).toBe(85);
  });

  it("⚠️ blandet modul har INGEN port som standard", () => {
    // Dette er det som gjør at regelen ikke kan være «70 % overalt». Flervalget BIDRAR til
    // totalskåren her; det er ingen egen port. En 70 %-port ville strøket kandidater som
    // består i dag.
    expect(resolveMcqMinPercent("FREETEXT_PLUS_MCQ", null)).toBeNull();
    expect(resolveMcqMinPercent("FREETEXT_PLUS_MCQ", { passRules: {} })).toBeNull();
  });

  it("blandet modul MED eksplisitt grense får den porten", () => {
    expect(resolveMcqMinPercent("FREETEXT_PLUS_MCQ", { passRules: { mcqMinPercent: 60 } })).toBe(60);
  });

  it("FREETEXT_ONLY har ingen flervalgsdel — heller ikke med en grense i policyen", () => {
    expect(resolveMcqMinPercent("FREETEXT_ONLY", { passRules: { mcqMinPercent: 90 } })).toBeNull();
  });
});

describe("#949 deriveMcqPassFail — tre tilstander", () => {
  it("over og under grensen for en MCQ_ONLY-modul", () => {
    const gate = resolveMcqMinPercent("MCQ_ONLY", null);
    expect(deriveMcqPassFail(70, gate)).toBe(true);
    expect(deriveMcqPassFail(69.9, gate)).toBe(false);
  });

  it("⚠️ scenariet fra saken: 60 % er IKKE bestått, der den gamle regelen sa ja", () => {
    // `percentScore >= 50` ga `true` her, side om side med vedtaket «under 70 %».
    expect(deriveMcqPassFail(60, resolveMcqMinPercent("MCQ_ONLY", null))).toBe(false);
  });

  it("uten port er svaret «ikke aktuelt», ikke «ikke bestått»", () => {
    // ⚠️ Skillet er hele poenget. `false` ville sagt at kandidaten strøk på et krav som
    // ikke finnes.
    expect(deriveMcqPassFail(42, resolveMcqMinPercent("FREETEXT_PLUS_MCQ", null))).toBeNull();
    expect(deriveMcqPassFail(100, resolveMcqMinPercent("FREETEXT_PLUS_MCQ", null))).toBeNull();
  });

  it("manglende poengsum er «ikke aktuelt», ikke stryk", () => {
    expect(deriveMcqPassFail(null, 70)).toBeNull();
    expect(deriveMcqPassFail(undefined, 70)).toBeNull();
    expect(deriveMcqPassFail(Number.NaN, 70)).toBeNull();
  });

  it("KONTROLLCASE: en blandet modul med eksplisitt grense oppfører seg som en port", () => {
    // Uten denne kunne `deriveMcqPassFail` returnert null for ALT blandet og fortsatt vært grønn.
    const gate = resolveMcqMinPercent("FREETEXT_PLUS_MCQ", { passRules: { mcqMinPercent: 60 } });
    expect(deriveMcqPassFail(65, gate)).toBe(true);
    expect(deriveMcqPassFail(55, gate)).toBe(false);
  });
});
