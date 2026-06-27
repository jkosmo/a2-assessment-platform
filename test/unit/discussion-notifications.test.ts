import { describe, expect, it } from "vitest";
import {
  getDiscussionQuestionNotificationMessage,
  getDiscussionReplyNotificationMessage,
} from "../../src/i18n/notificationMessages.js";

// #495/T-QA-5: locale-keyed templates for diskusjons-varsler i alle tre locales.
describe("discussion notification templates", () => {
  const locales = ["en-GB", "nb", "nn"] as const;

  it("bygger spørsmåls-varsel med kurs + tittel i alle locales", () => {
    for (const locale of locales) {
      const msg = getDiscussionQuestionNotificationMessage(locale, {
        courseTitle: "Arbeidsmiljø",
        threadTitle: "Hvordan tolke oppgave 3?",
      });
      expect(msg.subject).toContain("Arbeidsmiljø");
      expect(msg.nextStepGuidance).toContain("Hvordan tolke oppgave 3?");
      // Ingen lenker i e-post (#688).
      expect(msg.nextStepGuidance.toLowerCase()).not.toContain("http");
    }
  });

  it("bygger svar-varsel med trådtittel i alle locales", () => {
    for (const locale of locales) {
      const msg = getDiscussionReplyNotificationMessage(locale, { threadTitle: "Spørsmål om frist" });
      expect(msg.subject).toContain("Spørsmål om frist");
      expect(msg.nextStepGuidance).toContain("Spørsmål om frist");
      expect(msg.nextStepGuidance.toLowerCase()).not.toContain("http");
    }
  });

  it("gir forskjellig tekst per språk (bokmål vs engelsk)", () => {
    const nb = getDiscussionQuestionNotificationMessage("nb", { courseTitle: "K", threadTitle: "T" });
    const en = getDiscussionQuestionNotificationMessage("en-GB", { courseTitle: "K", threadTitle: "T" });
    expect(nb.subject).not.toBe(en.subject);
  });
});
