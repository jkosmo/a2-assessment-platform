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
      "adminContent.help.moduleValidity",
      "adminContent.status.title",
      "adminContent.status.liveChain",
      "adminContent.import.title",
      "adminContent.import.applyDraft",
      "adminContent.import.copyPrompt",
      "adminContent.select.loadContent",
      "adminContent.select.exportModule",
      "adminContent.select.deleteModule",
      "adminContent.help.loadContent",
      "adminContent.help.importOverview",
      "adminContent.help.deleteModule",
      "adminContent.rubric.title",
      "adminContent.help.rubricOverview",
      "adminContent.prompt.title",
      "adminContent.help.promptUserTemplate",
      "adminContent.mcq.title",
      "adminContent.help.mcqQuestions",
      "adminContent.moduleVersion.title",
      "adminContent.moduleVersion.saveBundle",
      "adminContent.moduleVersion.previewDraft",
      "adminContent.help.moduleTaskText",
      "adminContent.help.copyPrompt",
      "adminContent.help.previewDraft",
      "adminContent.publish.title",
      "adminContent.message.moduleContentLoaded",
      "adminContent.message.moduleExported",
      "adminContent.message.importApplied",
      "adminContent.message.importCancelled",
      "adminContent.message.authoringPromptCopied",
      "adminContent.message.previewOpened",
      "adminContent.errors.valueRequiredPrefix",
      "adminContent.errors.importShape",
      "adminContent.errors.previewPopupBlocked",
      "adminContent.confirm.deleteModule",
      "adminContent.confirm.importOverwrite",
    ];

    for (const locale of supportedLocales) {
      for (const key of requiredKeys) {
        expect(translations[locale][key]).toBeTypeOf("string");
        expect(translations[locale][key].length).toBeGreaterThan(0);
      }
    }
  });
});
