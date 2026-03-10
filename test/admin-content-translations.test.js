import { describe, expect, it } from "vitest";
import { supportedLocales, translations } from "../public/i18n/admin-content-translations.js";

describe("admin content translation resources", () => {
  it("keeps locale key parity with en-GB baseline", () => {
    const baseKeys = Object.keys(translations["en-GB"]).sort();

    for (const locale of supportedLocales) {
      const keys = Object.keys(translations[locale]).sort();
      expect(keys).toEqual(baseKeys);
    }
  });

  it("includes admin content workspace labels for all locales", () => {
    const requiredKeys = [
      "nav.adminContent",
      "adminContentPage.title",
      "adminContent.module.title",
      "adminContent.help.moduleOverview",
      "adminContent.rubric.title",
      "adminContent.help.rubricOverview",
      "adminContent.prompt.title",
      "adminContent.help.promptUserTemplate",
      "adminContent.mcq.title",
      "adminContent.help.mcqQuestions",
      "adminContent.moduleVersion.title",
      "adminContent.help.moduleTaskText",
      "adminContent.publish.title",
    ];

    for (const locale of supportedLocales) {
      for (const key of requiredKeys) {
        expect(translations[locale][key]).toBeTypeOf("string");
        expect(translations[locale][key].length).toBeGreaterThan(0);
      }
    }
  });
});
