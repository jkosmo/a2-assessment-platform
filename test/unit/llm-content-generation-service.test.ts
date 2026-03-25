import { describe, expect, it } from "vitest";
import {
  buildMcqGenerationPrompts,
  buildModuleDraftPrompts,
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

  it("requires MCQs to be self-contained and not refer to hidden source material", () => {
    const { userPrompt } = buildMcqGenerationPrompts({
      sourceMaterial: "Reference notes about escalation thresholds and confidentiality duties.",
      certificationLevel: "advanced",
      locale: "en-GB",
      questionCount: 4,
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
      });

      expect(userPrompt).toContain("Certification level: advanced");
      expect(userPrompt).toContain("common expert-level confusions");
      expect(userPrompt).toContain("well-prepared candidate should have to think carefully");
    });

    it("distractor guidelines differ across levels", () => {
      const basic = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "basic", locale: "en-GB", questionCount: 1 }).userPrompt;
      const intermediate = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "intermediate", locale: "en-GB", questionCount: 1 }).userPrompt;
      const advanced = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "advanced", locale: "en-GB", questionCount: 1 }).userPrompt;

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
      });

      expect(userPrompt).toContain("## Option parity");
      expect(userPrompt).toContain("comparable in length and level of detail");
      expect(userPrompt).toContain("Each question must have exactly 4 answer options");
    });
  });
});
