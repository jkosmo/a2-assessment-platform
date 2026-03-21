import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/assessment/sensitiveDataMaskingService.js", () => ({
  preprocessSensitiveDataForLlm: vi.fn((input) => ({
    payload: { responseJson: input.responseJson },
    maskingEnabled: false,
    maskingApplied: false,
    totalMatches: 0,
    ruleHits: [],
    fieldsMasked: [],
  })),
}));

vi.mock("../../src/i18n/content.js", () => ({
  localizeContentText: vi.fn((_locale, text) => text ?? null),
}));

describe("AssessmentInputFactory", () => {
  describe("parseRubricCriteriaIds", () => {
    it("extracts keys when criteriaJson is an object", async () => {
      const { parseRubricCriteriaIds } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      const ids = parseRubricCriteriaIds(
        JSON.stringify({ relevance_for_case: "0-4", quality_and_utility: "0-4" }),
      );
      expect(ids).toEqual(["relevance_for_case", "quality_and_utility"]);
    });

    it("extracts id fields when criteriaJson is an array", async () => {
      const { parseRubricCriteriaIds } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      const ids = parseRubricCriteriaIds(
        JSON.stringify([{ id: "criterion_a" }, { id: "criterion_b" }]),
      );
      expect(ids).toEqual(["criterion_a", "criterion_b"]);
    });

    it("returns empty array for invalid JSON", async () => {
      const { parseRubricCriteriaIds } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      expect(parseRubricCriteriaIds("not-json")).toEqual([]);
    });
  });

  describe("parseRubricMaxTotal", () => {
    it("extracts max_total from scalingRuleJson", async () => {
      const { parseRubricMaxTotal } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      expect(parseRubricMaxTotal(JSON.stringify({ max_total: 25 }))).toBe(25);
    });

    it("returns default 20 when max_total is missing", async () => {
      const { parseRubricMaxTotal } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      expect(parseRubricMaxTotal(JSON.stringify({ other_field: 5 }))).toBe(20);
    });

    it("returns default 20 for invalid JSON", async () => {
      const { parseRubricMaxTotal } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      expect(parseRubricMaxTotal("bad json")).toBe(20);
    });
  });

  describe("parseSubmissionFieldLabels", () => {
    it("extracts string labels from schema fields", async () => {
      const { parseSubmissionFieldLabels } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      const schema = JSON.stringify({
        fields: [
          { id: "field1", label: "My Field" },
          { id: "field2", label: "Another Field" },
        ],
      });
      expect(parseSubmissionFieldLabels(schema)).toEqual(["My Field", "Another Field"]);
    });

    it("extracts en-GB label from localized label objects", async () => {
      const { parseSubmissionFieldLabels } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      const schema = JSON.stringify({
        fields: [{ id: "field1", label: { "en-GB": "English Label", nb: "Norsk etikett" } }],
      });
      expect(parseSubmissionFieldLabels(schema)).toEqual(["English Label"]);
    });

    it("falls back to field id when label is missing", async () => {
      const { parseSubmissionFieldLabels } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      const schema = JSON.stringify({ fields: [{ id: "my_field_id" }] });
      expect(parseSubmissionFieldLabels(schema)).toEqual(["my_field_id"]);
    });

    it("returns empty array when schema is null", async () => {
      const { parseSubmissionFieldLabels } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      expect(parseSubmissionFieldLabels(null)).toEqual([]);
    });

    it("appends placeholder as guidance when present", async () => {
      const { parseSubmissionFieldLabels } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      const schema = JSON.stringify({
        fields: [
          { id: "field1", label: "Ditt svar", placeholder: "Skriv svaret ditt her..." },
          { id: "field2", label: "Refleksjon" },
        ],
      });
      expect(parseSubmissionFieldLabels(schema)).toEqual([
        "Ditt svar (guidance: Skriv svaret ditt her...)",
        "Refleksjon",
      ]);
    });

    it("resolves localized placeholder to the given locale", async () => {
      const { parseSubmissionFieldLabels } = await import("../../src/modules/assessment/AssessmentInputFactory.js");
      const schema = JSON.stringify({
        fields: [
          {
            id: "field1",
            label: { "en-GB": "Your answer", nb: "Ditt svar" },
            placeholder: { "en-GB": "Write your answer here", nb: "Skriv svaret ditt her" },
          },
        ],
      });
      expect(parseSubmissionFieldLabels(schema, "nb")).toEqual([
        "Ditt svar (guidance: Skriv svaret ditt her)",
      ]);
    });
  });

  describe("buildAssessmentInputContext", () => {
    it("builds a complete context from a submission fixture", async () => {
      const { buildAssessmentInputContext } = await import("../../src/modules/assessment/AssessmentInputFactory.js");

      const submission = {
        moduleId: "module-1",
        responseJson: JSON.stringify({ answer: "my response" }),
        moduleVersion: {
          assessmentPolicyJson: null,
          submissionSchemaJson: null,
          taskText: "Task text",
          guidanceText: "Guidance text",
          promptTemplateVersion: {
            systemPrompt: "system",
            userPromptTemplate: "template",
            examplesJson: "[]",
          },
          rubricVersion: {
            criteriaJson: JSON.stringify({ criterion_a: "0-4", criterion_b: "0-4" }),
            scalingRuleJson: JSON.stringify({ max_total: 20 }),
          },
        },
      };

      const context = buildAssessmentInputContext(submission, "nb");

      expect(context.rubricCriteriaIds).toEqual(["criterion_a", "criterion_b"]);
      expect(context.rubricMaxTotal).toBe(20);
      expect(context.assessmentPolicy).toBeNull();
      expect(context.submissionLocale).toBe("nb");
      expect(context.sensitiveDataPreprocess.maskingEnabled).toBe(false);
      expect(context.moduleTaskText).toBe("Task text");
      expect(context.promptTemplateSystem).toBe("system");
    });

    it("parses assessmentPolicyJson when present", async () => {
      const { buildAssessmentInputContext } = await import("../../src/modules/assessment/AssessmentInputFactory.js");

      const policy = { passRules: { totalMin: 65 } };
      const submission = {
        moduleId: "module-1",
        responseJson: JSON.stringify({ answer: "response" }),
        moduleVersion: {
          assessmentPolicyJson: JSON.stringify(policy),
          submissionSchemaJson: null,
          taskText: "Task",
          guidanceText: null,
          promptTemplateVersion: { systemPrompt: "", userPromptTemplate: "", examplesJson: "" },
          rubricVersion: {
            criteriaJson: JSON.stringify({ crit: "0-4" }),
            scalingRuleJson: JSON.stringify({ max_total: 20 }),
          },
        },
      };

      const context = buildAssessmentInputContext(submission, "en-GB");
      expect(context.assessmentPolicy).toEqual(policy);
    });
  });
});
