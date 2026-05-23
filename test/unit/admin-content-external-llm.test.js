import { describe, expect, it } from "vitest";
import {
  EXTERNAL_LLM_AUTHORING_PROMPT,
  parseExternalLlmJson,
} from "../../public/static/admin-content-external-llm.js";

describe("admin-content-external-llm", () => {
  describe("EXTERNAL_LLM_AUTHORING_PROMPT", () => {
    it("includes the [PASTE SOURCE MATERIAL HERE] placeholder so authors know where to append their source", () => {
      expect(EXTERNAL_LLM_AUTHORING_PROMPT).toContain("[PASTE SOURCE MATERIAL HERE]");
    });

    it("instructs the LLM to use the current field name assessorExpectedContent (not legacy guidanceText)", () => {
      expect(EXTERNAL_LLM_AUTHORING_PROMPT).toContain("assessorExpectedContent");
      expect(EXTERNAL_LLM_AUTHORING_PROMPT).not.toContain("guidanceText");
    });

    it("names the four required root sections", () => {
      expect(EXTERNAL_LLM_AUTHORING_PROMPT).toContain("module");
      expect(EXTERNAL_LLM_AUTHORING_PROMPT).toContain("rubric");
      expect(EXTERNAL_LLM_AUTHORING_PROMPT).toContain("mcqSet");
      expect(EXTERNAL_LLM_AUTHORING_PROMPT).toContain("moduleVersion");
    });
  });

  describe("parseExternalLlmJson", () => {
    const minimalValid = {
      module: { title: { "en-GB": "T", nb: "T", nn: "T" }, certificationLevel: "basic" },
      moduleVersion: { taskText: { "en-GB": "Task", nb: "Task", nn: "Task" } },
      mcqSet: { questions: [] },
      rubric: { criteria: {} },
    };

    it("parses a minimal valid object", () => {
      const result = parseExternalLlmJson(JSON.stringify(minimalValid));
      expect(result.moduleTitle).toEqual({ "en-GB": "T", nb: "T", nn: "T" });
      expect(result.taskText).toEqual({ "en-GB": "Task", nb: "Task", nn: "Task" });
      expect(result.certificationLevel).toBe("basic");
      expect(result.mcqQuestions).toEqual([]);
      expect(result.criteria).toEqual({});
    });

    it("strips ```json code fences", () => {
      const fenced = "```json\n" + JSON.stringify(minimalValid) + "\n```";
      const result = parseExternalLlmJson(fenced);
      expect(result.moduleTitle).toEqual({ "en-GB": "T", nb: "T", nn: "T" });
    });

    it("strips plain ``` code fences", () => {
      const fenced = "```\n" + JSON.stringify(minimalValid) + "\n```";
      const result = parseExternalLlmJson(fenced);
      expect(result.moduleTitle).toEqual({ "en-GB": "T", nb: "T", nn: "T" });
    });

    it("defaults certificationLevel to intermediate when absent", () => {
      const noLevel = { ...minimalValid, module: { title: { "en-GB": "T" } } };
      const result = parseExternalLlmJson(JSON.stringify(noLevel));
      expect(result.certificationLevel).toBe("intermediate");
    });

    it("maps legacy guidanceText to assessorExpectedContent", () => {
      const legacy = {
        ...minimalValid,
        moduleVersion: {
          taskText: { "en-GB": "Task" },
          guidanceText: { "en-GB": "Old guidance field" },
        },
      };
      const result = parseExternalLlmJson(JSON.stringify(legacy));
      expect(result.assessorExpectedContent).toEqual({ "en-GB": "Old guidance field" });
    });

    it("prefers assessorExpectedContent when both are present", () => {
      const both = {
        ...minimalValid,
        moduleVersion: {
          taskText: { "en-GB": "Task" },
          assessorExpectedContent: { "en-GB": "New" },
          guidanceText: { "en-GB": "Old" },
        },
      };
      const result = parseExternalLlmJson(JSON.stringify(both));
      expect(result.assessorExpectedContent).toEqual({ "en-GB": "New" });
    });

    it("throws on empty input", () => {
      expect(() => parseExternalLlmJson("")).toThrow(/Empty JSON/);
      expect(() => parseExternalLlmJson("   ")).toThrow(/Empty JSON/);
    });

    it("throws on invalid JSON", () => {
      expect(() => parseExternalLlmJson("{not json")).toThrow(/Invalid JSON/);
    });

    it("throws when root is not an object", () => {
      expect(() => parseExternalLlmJson("[1,2,3]")).toThrow(/root must be an object/);
      expect(() => parseExternalLlmJson('"a string"')).toThrow(/root must be an object/);
    });

    it("throws on missing module.title", () => {
      const bad = { ...minimalValid, module: {} };
      expect(() => parseExternalLlmJson(JSON.stringify(bad))).toThrow(/module\.title/);
    });

    it("throws on missing moduleVersion.taskText", () => {
      const bad = { ...minimalValid, moduleVersion: {} };
      expect(() => parseExternalLlmJson(JSON.stringify(bad))).toThrow(/moduleVersion\.taskText/);
    });

    it("returns empty array for missing mcqSet.questions", () => {
      const bad = { ...minimalValid, mcqSet: {} };
      const result = parseExternalLlmJson(JSON.stringify(bad));
      expect(result.mcqQuestions).toEqual([]);
    });

    it("returns null criteria when rubric.criteria is missing", () => {
      const bad = { ...minimalValid, rubric: {} };
      const result = parseExternalLlmJson(JSON.stringify(bad));
      expect(result.criteria).toBeNull();
    });
  });
});
