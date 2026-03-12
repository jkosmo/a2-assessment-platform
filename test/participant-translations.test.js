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

  it("includes localized keys for manual-review decision and LLM guidance text", () => {
    const requiredKeys = [
      "assessment.auto.elapsedLabel",
      "submission.taskText",
      "submission.guidanceText",
      "preview.title",
      "preview.description",
      "preview.assessmentUnavailable",
      "modules.draftBadge",
      "draft.savedSwitchToast",
      "draft.browserNote",
      "submission.validation.rawTextMin",
      "appeal.nextSteps",
      "result.decisionValue.MANUAL_REVIEW_PENDING",
      "result.confidenceValue.low",
      "result.improvementAdviceValue.riskScenarios",
      "result.improvementAdviceValue.dataHandling",
      "result.improvementAdviceValue.humanInLoop",
      "result.improvementAdviceValue.qaMetrics",
      "result.improvementAdviceValue.improvementLoop",
      "result.improvementAdviceValue.promptLeakage",
      "result.improvementAdviceValue.governanceScope",
      "result.improvementAdviceValue.riskCategories",
      "result.improvementAdviceValue.qaChecklist",
      "result.improvementAdviceValue.dataControls",
      "result.improvementAdviceValue.qualityThresholds",
      "result.improvementAdviceValue.iterationVersioning",
      "result.improvementAdviceValue.escalationDecisionRights",
      "result.improvementAdviceValue.artifactsEvidence",
      "result.improvementAdviceValue.responsibleAiMisuse",
      "result.improvementAdviceValue.examplesFailureModes",
    ];

    for (const locale of supportedLocales) {
      for (const key of requiredKeys) {
        expect(translations[locale][key]).toBeTypeOf("string");
        expect(translations[locale][key].length).toBeGreaterThan(0);
      }
    }
  });
});
