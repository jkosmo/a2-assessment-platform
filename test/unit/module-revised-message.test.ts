// 2.101.0: revisjonsvarselet med produkteiers ordlyd (2026-10-25), og kurset beståtten gjaldt.
import { describe, expect, it } from "vitest";
import { getModuleRevisedNotificationMessage } from "../../src/i18n/notificationMessages.js";

describe("revisjonsvarselet", () => {
  it("nb: produkteiers tekst, med kurset navngitt", () => {
    const message = getModuleRevisedNotificationMessage("nb", { moduleTitle: "Hvor er mennesket i alt dette?", courseTitles: ["KI i praksis"] });
    expect(message.subject).toBe("Modulen er revidert: Hvor er mennesket i alt dette?");
    expect(message.nextStepGuidance).toBe(
      "Hei!\n\nModulen «Hvor er mennesket i alt dette?», som du hadde bestått, er revidert. "
        + "Din tidligere bestått teller ikke lenger, og du må oppdatere for å fortsatt ha et bestått kurs for «KI i praksis»."
        + "\n\nLogg inn på plattformen for å ta modulen på nytt.",
    );
  });

  it("flere kurs listes med «og» mellom de to siste", () => {
    const message = getModuleRevisedNotificationMessage("nb", { moduleTitle: "M", courseTitles: ["A", "B", "C"] });
    expect(message.nextStepGuidance).toContain("et bestått kurs for «A», «B» og «C».");
    const en = getModuleRevisedNotificationMessage("en-GB", { moduleTitle: "M", courseTitles: ["A", "B"] });
    expect(en.nextStepGuidance).toContain("a passed course for «A» and «B».");
  });

  it("uten publisert kurs: setningen uten kurs — ingen tomme «»", () => {
    for (const locale of ["nb", "nn", "en-GB"] as const) {
      const message = getModuleRevisedNotificationMessage(locale, { moduleTitle: "M", courseTitles: [] });
      expect(message.nextStepGuidance).not.toContain("«»");
      expect(message.nextStepGuidance).not.toContain("{courses}");
    }
    expect(getModuleRevisedNotificationMessage("nb", { moduleTitle: "M" }).nextStepGuidance).toContain("Din tidligere bestått teller ikke lenger.\n\n");
  });
});
