import { describe, expect, it } from "vitest";
import { buildPreviewHtml, localizeValueForLocale } from "../../public/static/admin-content-preview.js";

const translations = {
  "adminContent.moduleVersion.taskText": "Task text",
  "adminContent.moduleVersion.assessorExpectedContent": "Guidance",
  "shell.mcq.countLabel": "{count} MCQ questions",
  "shell.preview.mcqSection": "Multiple choice questions",
  "shell.preview.questionNumber": "Question {number}",
  "shell.preview.correctAnswer": "Correct answer",
  "shell.preview.rationale": "Rationale",
};

function t(key) {
  return translations[key] ?? key;
}

function tf(key, vars) {
  let template = t(key);
  for (const [name, value] of Object.entries(vars)) {
    template = template.replace(`{${name}}`, String(value));
  }
  return template;
}

describe("admin content preview helpers", () => {
  describe("localizeValueForLocale", () => {
    it("returns plain strings unchanged", () => {
      expect(localizeValueForLocale("Hello", "nb")).toBe("Hello");
    });

    it("resolves locale objects using requested locale first", () => {
      expect(
        localizeValueForLocale(
          { "en-GB": "English", nb: "Norsk bokmal", nn: "Norsk nynorsk" },
          "nn",
        ),
      ).toBe("Norsk nynorsk");
    });

    // ⚠️ REGELEN ER ENDRET (19.09), og testen sier nå hva den faktisk er. Kjeden var hardkodet
    // `[locale, "nb", "en-GB"]` her; nå spør forhåndsvisningen `pickLocalizedText`, som bruker
    // `[locale, ORGANISASJONENS STANDARDSPRÅK, "en-GB"]` — samme rekkefølge som tjeneren.
    //
    // I denne testen er standardspråket «en-GB» (klienten henter det fra `/participant/config`,
    // og det finnes ingen konfigurasjon her). Derfor faller «fr» til engelsk, ikke til bokmål.
    // Hos A-2 er standardspråket nb, og da oppfører den seg som før — forskjellen er at den
    // FØLGER innstillingen i stedet for å anta den.
    it("faller til standardspråket og så engelsk når språket mangler", () => {
      expect(
        localizeValueForLocale(
          { "en-GB": "English", nb: "Norsk bokmal" },
          "fr",
        ),
      ).toBe("English");

      expect(
        localizeValueForLocale(
          { "en-GB": "English only" },
          "nn",
        ),
      ).toBe("English only");

      // Finnes verken det valgte språket, standardspråket eller engelsk, vises det som ER der —
      // en blank forhåndsvisning hjelper ingen.
      expect(localizeValueForLocale({ nn: "Berre nynorsk" }, "fr")).toBe("Berre nynorsk");
    });

    it("parses localized JSON strings", () => {
      expect(
        localizeValueForLocale(
          JSON.stringify({ "en-GB": "English", nb: "Norsk" }),
          "nb",
        ),
      ).toBe("Norsk");
    });
  });

  describe("buildPreviewHtml", () => {
    it("renders localized task, guidance, and MCQ content", () => {
      const html = buildPreviewHtml(
        {
          title: { "en-GB": "Trade unions", nb: "Fagforeninger" },
          description: { "en-GB": "Module description", nb: "Modulbeskrivelse" },
          taskText: { "en-GB": "Explain the concept.", nb: "Forklar begrepet." },
          assessorExpectedContent: { "en-GB": "Keep it concise.", nb: "Hold det kort." },
          mcqQuestions: [
            {
              stem: { "en-GB": "What is the goal?", nb: "Hva er malet?" },
              options: [
                { "en-GB": "Option A", nb: "Alternativ A" },
                { "en-GB": "Option B", nb: "Alternativ B" },
              ],
              correctAnswer: { "en-GB": "Option B", nb: "Alternativ B" },
              rationale: { "en-GB": "Because B fits best.", nb: "Fordi B passer best." },
            },
          ],
          versionChain: "Module v2 - MCQ v1",
          badgeClass: "draft",
          badgeText: "Unsaved draft",
        },
        { locale: "nb", t, tf },
      );

      expect(html).toContain("Fagforeninger");
      expect(html).toContain("Modulbeskrivelse");
      expect(html).toContain("Forklar begrepet.");
      expect(html).toContain("Hold det kort.");
      expect(html).toContain("Hva er malet?");
      expect(html).toContain("Alternativ A");
      expect(html).toContain("Alternativ B");
      expect(html).toContain("Fordi B passer best.");
      expect(html).toContain("1 MCQ questions");
      expect(html).toContain("Unsaved draft");
      expect(html).toContain("module-status-badge draft");
    });

    it("returns an empty-state paragraph when emptyText is provided", () => {
      const html = buildPreviewHtml(
        { emptyText: "No module selected." },
        { locale: "en-GB", t, tf },
      );

      expect(html).toContain('class="preview-empty"');
      expect(html).toContain("No module selected.");
      expect(html).not.toContain("module-status-badge");
    });
  });
});
