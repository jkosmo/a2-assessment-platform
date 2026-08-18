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

  // #896 S3c (rewritten 2026-08-18): this list used to be the ADVANCED editor's vocabulary —
  // start-mode tabs, import panel, handoff dialog, its own module/rubric/prompt headings. That
  // page is deleted and 53 of the 56 keys went with it, so the test asserted that translations
  // exist for a surface no one can reach. Worse, it did so while failing, which reads as "the
  // translations are broken" rather than "the test is stale".
  //
  // What it protects now is the surface that replaced it: the three tabs, the editing form, the
  // settings panel, the generation replies and the privacy warning. Keep this list in step with
  // the workspace — a key added here is a promise that all three locales carry it.
  it("includes module workspace labels for all locales", () => {
    const requiredKeys = [
      "nav.adminContent",
      "shell.page.title",

      // #896 S1: the three views.
      "shell.tab.listLabel",
      "shell.tab.preview",
      "shell.tab.edit",
      "shell.tab.settings",

      // #896 S6: leaving a tab with unsaved work. Three different costs, three different bodies —
      // an untranslated one here means the author is warned in the wrong language about which of
      // them applies.
      "shell.tab.unsaved.title",
      "shell.tab.unsaved.body",
      "shell.tab.unsaved.draftBody",
      "shell.tab.unsaved.settingsBody",
      "shell.tab.unsaved.discard",

      // #926 (§6 krav 2): something landed in a tab the author is not looking at.
      "shell.tab.attention.suffix",
      "shell.tab.attention.announce",

      // #926 (§6 krav 1): the conversation proposes; it never overwrites.
      "shell.proposal.title",
      "shell.proposal.body",
      "shell.proposal.use",
      "shell.proposal.discard",
      "shell.proposal.used",
      "shell.proposal.discarded",

      // The Rediger form itself.
      "shell.directEdit.submit",
      "shell.directEdit.editingBadge",
      "shell.directEdit.titlePlaceholder",
      "shell.action.cancel",
      "shell.action.retry",

      // #896 S3b/S3c: Innstillinger.
      "shell.settings.title",
      "shell.settings.noModule",
      "shell.settings.notSet",
      "shell.settings.save",
      "shell.settings.saved",

      // Generation and revision replies land in the conversation log, which is retranslated on
      // every language switch — an untranslated one is visible immediately.
      "shell.generating.draftReady",
      "shell.generating.mcqReady",
      "shell.generating.reviewPreviewHint",
      "shell.revision.draftReady",
      "shell.revision.mcqReady",

      // Shown on Rediger, where the assignment text is written.
      "adminContent.privacy.warning.title",
      "adminContent.privacy.warning.body",
      "adminContent.help.moduleValidity",
      "adminContent.help.mcqQuestions",
    ];

    for (const locale of supportedLocales) {
      for (const key of requiredKeys) {
        expect(translations[locale][key], `${locale} is missing ${key}`).toBeTypeOf("string");
        expect(translations[locale][key].length, `${locale}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });
});
