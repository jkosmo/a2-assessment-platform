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
});
