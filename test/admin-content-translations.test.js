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
      "shell.tab.unsaved.body",
      "shell.tab.unsaved.settingsBody",

      // #926 (§6 krav 2): something landed in a tab the author is not looking at.
      "shell.tab.attention.suffix",
      "shell.tab.attention.announce",

      // The Rediger form itself.
      "shell.directEdit.submit",
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

  // #1140 etappe 2 (skive 2c): kursbyggerens utkast. Bokmål og nynorsk bygges som engelsk + overstyringer, så paritetstesten over
  // er grønn også når en norsk overstyring mangler: da vises engelsk. Denne krever at hver tekst finnes OG er oversatt.
  it("translates the course draft texts and its API error codes into Bokmål and Nynorsk", () => {
    const keys = [
      "courses.draft.savedToast",
      "courses.draft.savedDetail",
      "courses.draft.line",
      "courses.draft.lineNoName",
      "courses.draft.publishAction",
      "courses.draft.discardAction",
      "courses.draft.discardConfirm",
      "courses.draft.discarded",
      "courses.draft.published",
      "courses.draft.publishedDetail",
      "courses.draft.publishAs",
      "courses.draft.notLiveNotice",
      "courses.draft.item.archived",
      "courses.draft.item.unpublished",
      "courses.draft.item.missing",
      "courses.draft.reason.archived",
      "courses.draft.reason.unpublished",
      "courses.draft.reason.missing",
      "courses.draft.unusableList",
      "errors.api.course_draft_changed",
      "errors.api.course_has_draft",
      "errors.api.course_draft_requires_published",
      "errors.api.course_draft_unreadable",
      "errors.api.course_draft_item_unusable",
      "errors.api.course_changed",
    ];
    for (const key of keys) {
      const en = translations["en-GB"][key];
      expect(en, `en-GB is missing ${key}`).toBeTypeOf("string");
      for (const locale of ["nb", "nn"]) {
        expect(translations[locale][key], `${locale} is missing ${key}`).toBeTypeOf("string");
        expect(translations[locale][key], `${locale}.${key} is still English`).not.toBe(en);
      }
    }
    // Plassholderne er de samme i alle tre språk: en som mangler, ville stått som «{version}» i teksten.
    for (const key of keys) {
      const holders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const locale of ["nb", "nn"]) {
        expect(holders(translations[locale][key]), `${locale}.${key}`).toEqual(holders(translations["en-GB"][key]));
      }
    }
  });
});
