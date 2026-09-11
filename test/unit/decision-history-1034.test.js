import { describe, expect, it } from "vitest";
import { decisionHistoryActorKey, decisionHistoryOutcome } from "../../public/static/decision-history.js";
import { translations } from "../../public/i18n/manual-review-translations.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1034: «Vurderer-overstyring · Ikke bestått · 72» på en sak ingen sensor har rørt.
//
// Sett i ekte nettleser under QA av #948 (`948-review-queue.png`). Terskelen var 70, vedtaket var
// automatisk og rutet til manuell vurdering, og raden sa at en kollega alt hadde strøket kandidaten.
//
// ⚠️ To feil, to tester. Etiketten (hvem) og verdien (hva) hadde hver sin årsak og rettes hver for
// seg — en test som bare sjekket den ferdige strengen kunne bestått med én av dem fikset.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1034 — etiketten følger decisionType", () => {
  it("⚠️ et automatisk vedtak heter ikke «Vurderer-overstyring»", () => {
    expect(decisionHistoryActorKey("AUTOMATIC")).toBe("case.history.automatic");
    expect(decisionHistoryActorKey("MANUAL_OVERRIDE")).toBe("case.history.review");
    expect(decisionHistoryActorKey("APPEAL_RESOLUTION")).toBe("case.history.appealResolution");
  });

  it("ukjent type faller tilbake til den gamle teksten — ikke en tom etikett", () => {
    expect(decisionHistoryActorKey(undefined)).toBe("case.history.review");
  });

  it("nøkkelen finnes på alle tre språk, og sier ikke «overstyring»", () => {
    for (const locale of ["en-GB", "nb", "nn"]) {
      const text = translations[locale]["case.history.automatic"];
      expect(text, locale).toBeTruthy();
      expect(text.toLowerCase(), locale).not.toMatch(/overstyring|override/);
    }
  });
});

describe("#1034 — verdien for et automatisk vedtak i en åpen sak er «til vurdering»", () => {
  const åpen = { decisionType: "AUTOMATIC", passFailTotal: false, submissionStatus: "UNDER_REVIEW" };

  it("⚠️ kjernen: 72 poeng, terskel 70, rutet til sensor — raden sier IKKE «Ikke bestått»", () => {
    expect(decisionHistoryOutcome(åpen)).toBe("pending");
  });

  it("⚠️ kontrollcase: en OVERSTYRING i samme åpne sak viser sensorens faktiske vedtak", () => {
    // En anke åpner saken igjen (status ikke lenger avgjort). Sensorens strykvedtak skal fortsatt
    // stå som stryk — det er et menneskes vedtak, og «til vurdering» ville skjult det.
    expect(decisionHistoryOutcome({ ...åpen, decisionType: "MANUAL_OVERRIDE" })).toBe("failed");
    expect(decisionHistoryOutcome({ ...åpen, decisionType: "APPEAL_RESOLUTION", passFailTotal: true })).toBe("passed");
  });

  it("et automatisk vedtak i en AVGJORT sak viser flagget rått, som før", () => {
    expect(decisionHistoryOutcome({ ...åpen, submissionStatus: "COMPLETED" })).toBe("failed");
    expect(decisionHistoryOutcome({ ...åpen, submissionStatus: "COMPLETED", passFailTotal: true })).toBe("passed");
  });

  it("uten status i det hele tatt: ingen påstand om «under behandling»", () => {
    // `deriveOutcome` gir `pending` også for ukjent status når flagget er satt — det er riktig for
    // deltakeren. Her måler vi bare at vi ikke krasjer og ikke sier «bestått» på et flagg som er false.
    expect(decisionHistoryOutcome({ decisionType: "AUTOMATIC", passFailTotal: false })).not.toBe("passed");
  });

  it("pending-teksten finnes på alle tre språk", () => {
    for (const locale of ["en-GB", "nb", "nn"]) {
      expect(translations[locale]["case.history.pendingReview"], locale).toBeTruthy();
    }
  });
});

describe("#1034 — sensorflaten bruker hjelperen, ikke en fast etikett", () => {
  it("review.js slår opp etiketten og utfallet per vedtak", async () => {
    // Hjelperen kan være riktig og likevel ubrukt. Dette er den billigste vakta mot at raden
    // for `latestDecision` går tilbake til `t("case.history.review")` fast.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../public/review.js", import.meta.url), "utf8");
    expect(src).toContain('from "/static/decision-history.js"');
    expect(src).toContain("decisionHistoryActorKey(latestDecision.decisionType)");
    expect(src).toContain("submissionStatus: submission.status");
  });
});
