import { describe, expect, it } from "vitest";
import {
  buildMcqGenerationPrompts,
  buildMcqLocalizationPrompts,
  buildMcqRevisionPrompts,
  buildModuleDraftPrompts,
  buildModuleDraftLocalizationPrompts,
  buildModuleDraftRevisionPrompts,
  extractMcqRevisionTargets,
  hasMeaningfulMcqRevision,
} from "../../src/modules/adminContent/llmContentGenerationService.js";

describe("llm content generation prompts", () => {
  it("treats source material as hidden author background for module drafts", () => {
    const { userPrompt } = buildModuleDraftPrompts({
      sourceMaterial: "Internal policy notes about safe handling of customer data.",
      certificationLevel: "intermediate",
      locale: "en-GB",
    });

    expect(userPrompt).toContain("The source material is for you only. The candidate will NOT see it.");
    expect(userPrompt).toContain(
      "Write taskText and guidanceText so they are fully self-contained and usable on their own.",
    );
    expect(userPrompt).toContain('Do not mention "source material"');
    expect(userPrompt).toContain("must be embedded directly in the generated task itself.");
    expect(userPrompt).toContain("use the scenario as the basis for their response");
    expect(userPrompt).toContain("## Source material (hidden author background)");
    expect(userPrompt).not.toContain("based on the source material below.");
  });

  it("extracts explicit MCQ targets from compact option references", () => {
    expect(extractMcqRevisionTargets("Endre alternativ 1C slik at det blir mer plausibelt.")).toEqual([
      { questionIndex: 0, optionIndex: 2 },
    ]);
    expect(extractMcqRevisionTargets("Change option B in question 3.")).toEqual([
      { questionIndex: 2, optionIndex: 1 },
    ]);
  });

  it("treats targeted MCQ revisions as invalid when the named option is unchanged", () => {
    const sourceQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A legal sanction", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    const revisedQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A legal sanction", "A revised salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    expect(
      hasMeaningfulMcqRevision(sourceQuestions, revisedQuestions, "Endre alternativ 1C slik at det blir mer plausibelt."),
    ).toBe(false);
  });

  it("accepts targeted MCQ revisions when the named option is changed", () => {
    const sourceQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A legal sanction", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    const revisedQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A coordinated workplace petition", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    expect(
      hasMeaningfulMcqRevision(sourceQuestions, revisedQuestions, "Endre alternativ 1C slik at det blir mer plausibelt."),
    ).toBe(true);
  });

  it("builds module draft localization prompts for target language translation", () => {
    const { userPrompt } = buildModuleDraftLocalizationPrompts({
      taskText: "Scenario:\n\nWorkers are discussing collective action.",
      guidanceText: "A strong answer should explain key principles.",
      sourceLocale: "nb",
      targetLocale: "en-GB",
    });

    expect(userPrompt).toContain("Translate the following certification module draft from Norwegian Bokm");
    expect(userPrompt).toContain("to British English");
    expect(userPrompt).toContain('If taskText starts with "Scenario:", preserve that label in the target language.');
    expect(userPrompt).toContain('"taskText": "translated task text in British English"');
  });

  it("builds MCQ localization prompts that preserve option structure", () => {
    const { userPrompt } = buildMcqLocalizationPrompts({
      questions: [
        {
          stem: "Hva er solidaritet?",
          options: ["Kollektiv handling", "Privat fordel", "Sanksjon", "Bonus"],
          correctAnswer: "Kollektiv handling",
          rationale: "Solidaritet handler om felles handling.",
        },
      ],
      sourceLocale: "nb",
      targetLocale: "nn",
    });

    expect(userPrompt).toContain("Translate the following multiple-choice questions from Norwegian Bokm");
    expect(userPrompt).toContain("to Norwegian Nynorsk");
    expect(userPrompt).toContain("Preserve the number of answer options for each question.");
    expect(userPrompt).toContain("correctAnswer must match one of the translated options verbatim.");
  });

  it("requires MCQs to be self-contained and not refer to hidden source material", () => {
    const { userPrompt } = buildMcqGenerationPrompts({
      sourceMaterial: "Reference notes about escalation thresholds and confidentiality duties.",
      certificationLevel: "advanced",
      locale: "en-GB",
      questionCount: 4,
      optionCount: 4,
    });

    expect(userPrompt).toContain("The source material is for you only. The candidate will NOT see it.");
    expect(userPrompt).toContain(
      "Each question must be self-contained and understandable without any external text.",
    );
    expect(userPrompt).toContain(
      'Do not mention "source material", "text above", "document", "attachment", or any unseen reference material.',
    );
    expect(userPrompt).toContain("If background facts are needed, incorporate them directly into the question stem.");
    expect(userPrompt).toContain("## Source material (hidden author background)");
    expect(userPrompt).not.toContain("based on the source material below.");
  });

  it("builds draft revision prompts around an explicit change instruction", () => {
    const { userPrompt } = buildModuleDraftRevisionPrompts({
      taskText: "Scenario:\n\nA workplace conflict has escalated.\n\nExplain how mediation could help.",
      guidanceText: "A strong answer should explain core mediation principles.",
      instruction: "Make the scenario more concrete and add clearer expectations about evidence.",
      locale: "en-GB",
    });

    expect(userPrompt).toContain("## Current draft");
    expect(userPrompt).toContain("## Revision instruction");
    expect(userPrompt).toContain("Make the scenario more concrete");
    expect(userPrompt).toContain('If the task includes a scenario, keep it at the top of taskText labelled "Scenario:".');
    expect(userPrompt).toContain('"includesScenario": true or false');
  });

  it("builds MCQ revision prompts that preserve count and option parity by default", () => {
    const { userPrompt } = buildMcqRevisionPrompts({
      questions: [
        {
          stem: "What best describes solidarity action?",
          options: ["A collective response", "A private complaint", "A legal sanction", "A salary bonus"],
          correctAnswer: "A collective response",
          rationale: "Solidarity action is collective rather than individual.",
        },
      ],
      instruction: "Make the distractors more plausible.",
      locale: "en-GB",
    });

    expect(userPrompt).toContain("Preserve the number of questions unless the instruction clearly asks for a different count.");
    expect(userPrompt).toContain("Preserve the number of answer options per question unless the instruction clearly asks for a different count.");
    expect(userPrompt).toContain('If the instruction points to a specific question or option reference such as "question 3", "Q3", "3b", "option B in question 3", or "third alternative in question 3", apply the change to that exact target.');
    expect(userPrompt).toContain("Target question count: 1");
    expect(userPrompt).toContain("Target option count per question: 4");
    expect(userPrompt).toContain("## Current questions (indexed review view)");
    expect(userPrompt).toContain("Question 1");
    expect(userPrompt).toContain("A. A collective response");
    expect(userPrompt).toContain("Make the distractors more plausible.");
  });

  // #245 — scenario generation decision
  describe("module draft scenario instructions (#245)", () => {
    it("instructs LLM to include scenario for situational/ethical content", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Theory of leadership ethics.",
        certificationLevel: "intermediate",
        locale: "en-GB",
      });

      expect(userPrompt).toContain("Include a scenario in taskText when:");
      expect(userPrompt).toContain("situational analysis, ethical reasoning, professional judgement");
      expect(userPrompt).toContain("Do NOT include a scenario when:");
      expect(userPrompt).toContain("factual recall or text summarisation");
    });

    it("instructs LLM to place scenario at top of taskText with Scenario: label", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Leadership frameworks.",
        certificationLevel: "advanced",
        locale: "nb",
      });

      expect(userPrompt).toContain('Place it at the very top of taskText, clearly labelled "Scenario:"');
      expect(userPrompt).toContain("Keep it realistic, concise (4-8 sentences)");
    });

    it("requires includesScenario boolean in module draft return format", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Source.",
        certificationLevel: "basic",
        locale: "en-GB",
      });

      expect(userPrompt).toContain('"includesScenario": true or false');
    });

    it("embeds certificationLevel and locale in module draft prompt", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Financial regulations.",
        certificationLevel: "advanced",
        locale: "nb",
      });

      expect(userPrompt).toContain("Certification level: advanced");
      expect(userPrompt).toContain("Norwegian Bokmål");
    });
  });

  // #246 — MCQ distractor calibration per certificationLevel
  describe("MCQ distractor calibration per certificationLevel (#246)", () => {
    it("basic level: allows clearly incorrect distractors but requires thematic relevance", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Intro to biology.",
        certificationLevel: "basic",
        locale: "en-GB",
        questionCount: 3,
        optionCount: 4,
      });

      expect(userPrompt).toContain("Certification level: basic");
      expect(userPrompt).toContain("clearly incorrect but must be thematically related");
      expect(userPrompt).toContain("basic recognition");
    });

    it("intermediate level: requires plausible misconceptions as distractors", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Sociology theory.",
        certificationLevel: "intermediate",
        locale: "nb",
        questionCount: 4,
        optionCount: 4,
      });

      expect(userPrompt).toContain("Certification level: intermediate");
      expect(userPrompt).toContain("plausible misconceptions or near-misses");
      expect(userPrompt).toContain("partially informed candidate");
    });

    it("advanced level: requires expert-level confusion distractors", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Advanced contract law.",
        certificationLevel: "advanced",
        locale: "en-GB",
        questionCount: 5,
        optionCount: 4,
      });

      expect(userPrompt).toContain("Certification level: advanced");
      expect(userPrompt).toContain("common expert-level confusions");
      expect(userPrompt).toContain("well-prepared candidate should have to think carefully");
    });

    it("distractor guidelines differ across levels", () => {
      const basic = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "basic", locale: "en-GB", questionCount: 1, optionCount: 4 }).userPrompt;
      const intermediate = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "intermediate", locale: "en-GB", questionCount: 1, optionCount: 4 }).userPrompt;
      const advanced = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "advanced", locale: "en-GB", questionCount: 1, optionCount: 4 }).userPrompt;

      // Each level has distinct guideline text
      expect(basic).not.toEqual(intermediate);
      expect(intermediate).not.toEqual(advanced);
    });

    it("enforces option parity rules for all levels", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        questionCount: 4,
        optionCount: 5,
      });

      expect(userPrompt).toContain("## Option parity");
      expect(userPrompt).toContain("comparable in length and level of detail");
      expect(userPrompt).toContain("Each question must have exactly 5 answer options");
    });

    it("embeds the requested option count in the MCQ authoring prompt", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        questionCount: 4,
        optionCount: 3,
      });

      expect(userPrompt).toContain("Generate 4 multiple-choice questions");
      expect(userPrompt).toContain("Each question must have exactly 3 answer options");
    });
  });
});
