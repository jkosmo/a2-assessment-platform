import { describe, expect, it } from "vitest";
import { supportedLocales, translations } from "../public/i18n/participant-completed-translations.js";

describe("participant completed translation resources", () => {
  it("keeps locale key parity with en-GB baseline", () => {
    const baseKeys = Object.keys(translations["en-GB"]).sort();

    for (const locale of supportedLocales) {
      const keys = Object.keys(translations[locale]).sort();
      expect(keys).toEqual(baseKeys);
    }
  });

  it("includes completed-modules labels for all locales", () => {
    const requiredKeys = [
      "nav.completedModules",
      "completedPage.title",
      "completed.title",
      "completed.table.module",
      "completed.table.score",
      "completed.load",
      "courseCert.title",
      "courseCert.empty",
      "courseCert.load",
      "courseCert.certificateId",
    ];

    for (const locale of supportedLocales) {
      for (const key of requiredKeys) {
        expect(translations[locale][key]).toBeTypeOf("string");
        expect(translations[locale][key].length).toBeGreaterThan(0);
      }
    }
  });
});
