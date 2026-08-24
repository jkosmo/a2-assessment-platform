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

  it("en ikke-bestått under vurdering kan ikke ankes ennå", () => {
    // Resultatbanneret tilbød anke her; /participant/completed gjorde det ikke. Den strengeste
    // var den riktige — ankebehandleren skal ikke få en anke på et vedtak som ikke er endelig.
    expect(isAppealableFail(failUnderReview)).toBe(false);
    expect(isAppealableFail({ passFailTotal: false, submissionStatus: "COMPLETED" })).toBe(true);
  });

  it("en bestått kan ikke ankes", () => {
    expect(isAppealableFail({ passFailTotal: true, submissionStatus: "COMPLETED" })).toBe(false);
  });

  it("⚠️ anke krever COMPLETED, ikke bare «ikke under vurdering»", () => {
    // Kontrollcase mot å rette divergensen i feil retning. `participant-completed.js` krevde
    // COMPLETED; hadde den delte funksjonen bare speilet `deriveOutcome`, ville en innlevering i
    // en mellomtilstand blitt ankbar — altså en LØSNING av regelen, ikke en innstramming.
    expect(isAppealableFail({ passFailTotal: false, submissionStatus: "SUBMITTED" })).toBe(false);
    expect(isAppealableFail({ passFailTotal: false, submissionStatus: undefined })).toBe(false);
  });

  it("feiringen krever et avgjort bestått", () => {
    expect(isSettledPass({ passFailTotal: true, submissionStatus: "COMPLETED" })).toBe(true);
    expect(isSettledPass(failUnderReview)).toBe(false);
  });
});
