import { describe, expect, it } from "vitest";
import {
  OUTCOME_FAILED,
  OUTCOME_PASSED,
  OUTCOME_PENDING,
  OUTCOME_UNKNOWN,
  deriveOutcome,
  hasPassingDecision,
  isAppealableFail,
  isSettledPass,
  outcomeClass,
} from "../../public/static/outcome.js";

// #978: «er dette forsøket bestått» ble besvart åtte steder etter tre regelsett. Denne suiten
// fester at de fire spørsmålene svarer ULIKT der de skal — det er hele poenget med at de er fire
// funksjoner og ikke én.

describe("#978 deriveOutcome — statusen sjekkes først", () => {
  it("en avgjort bestått er passed", () => {
    expect(deriveOutcome({ passFailTotal: true, submissionStatus: "COMPLETED" })).toBe(OUTCOME_PASSED);
  });

  it("en avgjort ikke-bestått er failed", () => {
    expect(deriveOutcome({ passFailTotal: false, submissionStatus: "COMPLETED" })).toBe(OUTCOME_FAILED);
  });

  it("⚠️ UNDER_REVIEW slår passFailTotal — begge veier", () => {
    // Dette er regelen de tre kopiene manglet, og den er grunnen til at samme deltaker fikk to
    // svar i samme økt.
    expect(deriveOutcome({ passFailTotal: false, submissionStatus: "UNDER_REVIEW" })).toBe(OUTCOME_PENDING);
    expect(deriveOutcome({ passFailTotal: true, submissionStatus: "UNDER_REVIEW" })).toBe(OUTCOME_PENDING);
  });

  it("statusen leses uavhengig av store og små bokstaver", () => {
    expect(deriveOutcome({ passFailTotal: false, submissionStatus: "under_review" })).toBe(OUTCOME_PENDING);
  });

  it("⚠️ bare COMPLETED og REJECTED bærer et endelig utfall", () => {
    // QA-porten fant at dette var en SVARTELISTE: den listet UNDER_REVIEW og SCORED som uavklarte
    // og regnet alt annet som avgjort — inkludert PROCESSING. Konsekvensen var levende: en
    // innlevering under behandling med passFailTotal: true ble vist som BESTÅTT, med konfetti.
    //
    // En hvitliste kan ikke feile slik: en ny status i enumet er uavklart til noen legger den til.
    for (const status of ["PROCESSING", "SUBMITTED", "UNDER_REVIEW", "SCORED", "TULLESTATUS"]) {
      expect(deriveOutcome({ passFailTotal: true, submissionStatus: status }), status).toBe(OUTCOME_PENDING);
    }
    expect(deriveOutcome({ passFailTotal: true, submissionStatus: "COMPLETED" })).toBe(OUTCOME_PASSED);
    expect(deriveOutcome({ passFailTotal: false, submissionStatus: "REJECTED" })).toBe(OUTCOME_FAILED);
  });

  it("ingen beslutning er unknown, ikke failed", () => {
    // ⚠️ `null`/`undefined` MÅ ikke kollapse til «ikke bestått». Et forsøk uten vedtak er ikke
    // et strøket forsøk, og en `!passFailTotal`-test ville sagt det motsatte.
    expect(deriveOutcome({ passFailTotal: null, submissionStatus: "COMPLETED" })).toBe(OUTCOME_UNKNOWN);
    expect(deriveOutcome({ passFailTotal: undefined, submissionStatus: "COMPLETED" })).toBe(OUTCOME_UNKNOWN);
    expect(deriveOutcome({})).toBe(OUTCOME_UNKNOWN);
    expect(deriveOutcome(undefined)).toBe(OUTCOME_UNKNOWN);
  });
});

describe("#978 outcomeClass", () => {
  it("gir klassene flatene allerede bruker", () => {
    expect(outcomeClass(OUTCOME_PASSED)).toBe("outcome--pass");
    expect(outcomeClass(OUTCOME_FAILED)).toBe("outcome--fail");
    expect(outcomeClass(OUTCOME_PENDING)).toBe("outcome--review");
  });

  it("gir tom streng for unknown, så kallstedet kan sette den ubetinget", () => {
    expect(outcomeClass(OUTCOME_UNKNOWN)).toBe("");
  });
});

describe("#978 de fire spørsmålene svarer ulikt der de skal", () => {
  const passUnderReview = { passFailTotal: true, submissionStatus: "UNDER_REVIEW" };
  const failUnderReview = { passFailTotal: false, submissionStatus: "UNDER_REVIEW" };

  it("⚠️ hasPassingDecision ser bort fra statusen — de andre gjør det ikke", () => {
    // Dette er den ene bevisste avviket. Se begrunnelsen i outcome.js: en falsk positiv gjør at
    // vi lar være å autostarte et forsøk (ufarlig), en falsk negativ starter et unødig retake.
    expect(hasPassingDecision(passUnderReview.passFailTotal)).toBe(true);
    expect(isSettledPass(passUnderReview)).toBe(false);
  });

  it("⚠️ en ikke-bestått under vurdering KAN ankes", () => {
    // Snudd 2026-08-24. Første utkast krevde COMPLETED, med begrunnelsen «man kan ikke anke noe
    // som fortsatt vurderes». Produkteier: «Anke er kraftigere lut enn manuell behandling … la
    // oss ikke lage en regel uten skjellig grunn.»
    //
    // Anken er ikke et neste steg etter manuell vurdering — den er et sterkere virkemiddel.
    // Serveren har alltid tillatt det; det var klienten som holdt på å bli strengere enn serveren.
    expect(isAppealableFail(failUnderReview)).toBe(true);
    expect(isAppealableFail({ passFailTotal: false, submissionStatus: "COMPLETED" })).toBe(true);
  });

  it("en bestått kan ikke ankes", () => {
    expect(isAppealableFail({ passFailTotal: true, submissionStatus: "COMPLETED" })).toBe(false);
  });

  it("KONTROLLCASE: anke krever et STRYKVEDTAK, ikke bare en status", () => {
    // ⚠️ Regelen er løsnet på status, ikke fjernet. Uten et strykvedtak finnes det ingenting å
    // anke — og uten denne kunne `isAppealableFail` returnert true for alt og fortsatt vært grønn.
    expect(isAppealableFail({ passFailTotal: null, submissionStatus: "COMPLETED" })).toBe(false);
    expect(isAppealableFail({ passFailTotal: undefined, submissionStatus: "UNDER_REVIEW" })).toBe(false);
    expect(isAppealableFail({})).toBe(false);
  });

  it("feiringen krever et avgjort bestått", () => {
    expect(isSettledPass({ passFailTotal: true, submissionStatus: "COMPLETED" })).toBe(true);
    expect(isSettledPass(failUnderReview)).toBe(false);
  });
});
