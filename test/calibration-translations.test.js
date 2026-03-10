import { describe, expect, it } from "vitest";
import { supportedLocales, translations } from "../public/i18n/calibration-translations.js";

describe("calibration translation resources", () => {
  it("keeps locale key parity with en-GB baseline", () => {
    const baseKeys = Object.keys(translations["en-GB"]).sort();

    for (const locale of supportedLocales) {
      const keys = Object.keys(translations[locale]).sort();
      expect(keys).toEqual(baseKeys);
    }
  });

  it("includes calibration workspace labels for all locales", () => {
    const requiredKeys = [
      "nav.calibration",
      "calibrationPage.title",
      "calibration.filters.title",
      "calibration.signals.title",
      "calibration.outcomes.title",
      "calibration.anchors.title",
    ];

    for (const locale of supportedLocales) {
      for (const key of requiredKeys) {
        expect(translations[locale][key]).toBeTypeOf("string");
        expect(translations[locale][key].length).toBeGreaterThan(0);
      }
    }
  });
});
