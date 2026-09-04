import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { supportedLocales, translations } from "../public/i18n/participant-translations.js";

// Guard against "raw i18n key shown in the UI" bugs: every t("literal") referenced in
// participant.js must exist in the translation tables. t() returns the key itself when missing,
// so a typo / forgotten key silently renders as e.g. "courses.section.read" (real bug, #483).
describe("participant t() key coverage", () => {
  it("every t(\"literal\") key in participant.js is defined in all locales", () => {
    const src = readFileSync(fileURLToPath(new URL("../public/participant.js", import.meta.url)), "utf8");
    const keys = new Set();
    const re = /\bt\(\s*["'`]([A-Za-z][A-Za-z0-9._]*)["'`]\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(0);

    const missing = {};
    for (const locale of supportedLocales) {
      const absent = [...keys].filter((k) => !(k in translations[locale]));
      if (absent.length > 0) missing[locale] = absent;
    }
    expect(missing).toEqual({});
  });
});

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
      "submission.assessorExpectedContent",
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

      // #1024: her sto en vakt om at `result.improvementAdviceValue.*` ikke måtte tømmes stille.
      //
      // Gruppa er nå fjernet med vilje, sammen med gjettekartet den voktet. Vakta falt derfor
      // sammen med mekanismen — den skal ikke omgås ved å senke terskelen til null, for da ville
      // den stått igjen som en test som ikke kan bli rød.
      //
      // Grunnen: `buildResponseLanguageInstruction` ber modellen skrive `improvement_advice` på
      // deltakerens språk, så et engelsk oppslag kan ikke treffe. Teksten vises slik den er lagret.
      const døde = Object.keys(translations[locale]).filter(
        (k) => k.startsWith("result.improvementAdviceValue.") || k.startsWith("result.rationaleValue."),
      );
      expect(døde, `${locale}: gjettekartets nøkler skal være borte, ikke delvis fjernet`).toEqual([]);
    }
  });
});
