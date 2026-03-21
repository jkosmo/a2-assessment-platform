import { describe, expect, it } from "vitest";
import { supportedLocales, translations } from "../public/i18n/participant-translations.js";

describe("participant translation resources", () => {
  it("keeps locale key parity with en-GB baseline", () => {
    const baseKeys = Object.keys(translations["en-GB"]).sort();

    for (const locale of supportedLocales) {
      const keys = Object.keys(translations[locale]).sort();
      expect(keys).toEqual(baseKeys);
    }
  });

  it("includes localized keys for UI labels, result display, and improvement advice", () => {
    // Core UI and behavioral keys — these should always be present
    const requiredKeys = [
      "assessment.auto.elapsedLabel",
      "submission.taskText",
      "submission.guidanceText",
      "preview.title",
      "preview.description",
      "preview.assessmentUnavailable",
      "modules.draftBadge",
      "modules.completedBadge",
      "modules.retakeBadge",
      "modules.latestScoreLabel",
      "modules.completedAtLabel",
      "draft.savedSwitchToast",
      "draft.browserNote",
      "submission.validation.rawTextMin",
      "appeal.nextSteps",
      "result.decisionValue.MANUAL_REVIEW_PENDING",
      "result.confidenceValue.low",
    ];

    for (const locale of supportedLocales) {
      for (const key of requiredKeys) {
        expect(translations[locale][key]).toBeTypeOf("string");
        expect(translations[locale][key].length).toBeGreaterThan(0);
      }

      // Improvement advice keys are dynamic content — rely on key-parity for completeness,
      // but verify the group is non-empty so it cannot be silently cleared.
      const adviceKeys = Object.keys(translations[locale]).filter((k) =>
        k.startsWith("result.improvementAdviceValue."),
      );
      expect(adviceKeys.length, `${locale} must have improvement advice content keys`).toBeGreaterThan(0);
    }
  });
});
