import { describe, it, expect } from "vitest";
import {
  localizeSvgTexts,
  buildSvgTextLocalizationPrompts,
} from "../../src/modules/adminContent/llmContentGenerationService.js";

// #657: SVG label translation. In non-azure (CI/dev) mode the function is a deterministic stub so
// the localize round-trip is exercisable without a live LLM.

describe("localizeSvgTexts (stub mode)", () => {
  it("returns one tagged translation per label, in order", async () => {
    const out = await localizeSvgTexts({ texts: ["Start", "Slutt"], sourceLocale: "nb", targetLocale: "en-GB" });
    expect(out).toEqual(["[en-GB] Start", "[en-GB] Slutt"]);
  });

  it("returns an empty array for no labels", async () => {
    expect(await localizeSvgTexts({ texts: [], sourceLocale: "nb", targetLocale: "nn" })).toEqual([]);
  });
});

describe("buildSvgTextLocalizationPrompts", () => {
  it("includes the labels as a JSON array and demands order/count preservation", () => {
    const { systemPrompt, userPrompt } = buildSvgTextLocalizationPrompts({
      texts: ["A", "B"],
      sourceLocale: "nb",
      targetLocale: "nn",
    });
    expect(systemPrompt).toMatch(/translator/i);
    expect(userPrompt).toContain('["A","B"]');
    expect(userPrompt).toMatch(/same order/i);
  });
});
