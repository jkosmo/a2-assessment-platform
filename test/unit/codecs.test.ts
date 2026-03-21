import { describe, expect, it } from "vitest";
import { assessmentPolicyCodec } from "../../src/codecs/assessmentPolicyCodec.js";
import { submissionSchemaCodec } from "../../src/codecs/submissionSchemaCodec.js";
import { localizedTextCodec } from "../../src/codecs/localizedTextCodec.js";
import { llmResponseCodec } from "../../src/codecs/llmResponseCodec.js";
import { redFlagsCodec } from "../../src/codecs/redFlagsCodec.js";

describe("assessmentPolicyCodec", () => {
  it("parses a valid policy JSON string", () => {
    const raw = JSON.stringify({ passRules: { totalMin: 70 } });
    const result = assessmentPolicyCodec.parse(raw);
    expect(result).toEqual({ passRules: { totalMin: 70 } });
  });

  it("returns null for null/undefined/empty input", () => {
    expect(assessmentPolicyCodec.parse(null)).toBeNull();
    expect(assessmentPolicyCodec.parse(undefined)).toBeNull();
    expect(assessmentPolicyCodec.parse("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(assessmentPolicyCodec.parse("{bad json")).toBeNull();
  });

  it("serializes a policy object to a JSON string", () => {
    const policy = { passRules: { totalMin: 65, practicalMinPercent: 50 } };
    const result = assessmentPolicyCodec.serialize(policy);
    expect(JSON.parse(result)).toEqual(policy);
  });

  it("roundtrips a full policy object", () => {
    const policy = {
      scoring: { practicalWeight: 70, mcqWeight: 30 },
      passRules: {
        totalMin: 70,
        practicalMinPercent: 60,
        mcqMinPercent: 50,
        borderlineWindow: { min: 65, max: 75 },
      },
    };
    expect(assessmentPolicyCodec.parse(assessmentPolicyCodec.serialize(policy))).toEqual(policy);
  });
});

describe("submissionSchemaCodec", () => {
  it("parses a valid schema JSON string", () => {
    const raw = JSON.stringify({ fields: [{ id: "f1", label: "Task", type: "textarea", required: true }] });
    const result = submissionSchemaCodec.parse(raw);
    expect(result?.fields).toHaveLength(1);
    expect(result?.fields[0].id).toBe("f1");
  });

  it("returns null for null/undefined input", () => {
    expect(submissionSchemaCodec.parse(null)).toBeNull();
    expect(submissionSchemaCodec.parse(undefined)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(submissionSchemaCodec.parse("not json")).toBeNull();
  });

  it("parses fields with localized labels", () => {
    const schema = {
      fields: [{ id: "f1", label: { "en-GB": "Task", nb: "Oppgave", nn: "Oppgåve" }, type: "textarea" }],
    };
    const result = submissionSchemaCodec.parse(JSON.stringify(schema));
    expect(result?.fields[0].label).toEqual({ "en-GB": "Task", nb: "Oppgave", nn: "Oppgåve" });
  });

  it("serializes and roundtrips a schema", () => {
    const schema = { fields: [{ id: "f1", label: "Task", type: "textarea" as const, required: true }] };
    expect(submissionSchemaCodec.parse(submissionSchemaCodec.serialize(schema))).toEqual(schema);
  });
});

describe("localizedTextCodec", () => {
  it("returns a plain string as-is", () => {
    expect(localizedTextCodec.parse("Hello")).toBe("Hello");
  });

  it("parses a JSON localized object", () => {
    const raw = JSON.stringify({ "en-GB": "Hello", nb: "Hei", nn: "Hei" });
    expect(localizedTextCodec.parse(raw)).toEqual({ "en-GB": "Hello", nb: "Hei", nn: "Hei" });
  });

  it("returns null for null/undefined input", () => {
    expect(localizedTextCodec.parse(null)).toBeNull();
    expect(localizedTextCodec.parse(undefined)).toBeNull();
  });

  it("returns the raw string when JSON parse fails", () => {
    expect(localizedTextCodec.parse("{bad}")).toBe("{bad}");
  });

  it("serializes a plain string by trimming", () => {
    expect(localizedTextCodec.serialize("  hello  ")).toBe("hello");
  });

  it("serializes a locale object to a JSON string", () => {
    const value = { "en-GB": "Hello", nb: "Hei", nn: "Hei" };
    const result = localizedTextCodec.serialize(value);
    expect(JSON.parse(result)).toEqual(value);
  });

  it("roundtrips a locale object", () => {
    const value = { "en-GB": "Hello", nb: "Hei", nn: "Hei" };
    expect(localizedTextCodec.parse(localizedTextCodec.serialize(value))).toEqual(value);
  });
});

describe("llmResponseCodec", () => {
  function buildValidLlmResult(overrides = {}) {
    return {
      module_id: "module-1",
      rubric_scores: { relevance: 3 },
      rubric_total: 3,
      practical_score_scaled: 10.5,
      pass_fail_practical: false,
      criterion_rationales: { relevance: "Weak alignment." },
      improvement_advice: ["Add more detail."],
      red_flags: [],
      manual_review_recommended: false,
      confidence_note: "Low confidence.",
      ...overrides,
    };
  }

  it("parses a valid LLM result object", () => {
    const result = llmResponseCodec.parse(buildValidLlmResult());
    expect(result.module_id).toBe("module-1");
    expect(result.rubric_total).toBe(3);
  });

  it("throws on invalid input", () => {
    expect(() => llmResponseCodec.parse({ module_id: "x" })).toThrow();
  });

  it("serializes an LLM result to a JSON string", () => {
    const value = buildValidLlmResult();
    const parsed = llmResponseCodec.parse(value);
    const serialized = llmResponseCodec.serialize(parsed);
    expect(JSON.parse(serialized)).toMatchObject({ module_id: "module-1" });
  });

  it("roundtrips a full LLM result", () => {
    const value = buildValidLlmResult({
      evidence_sufficiency: "insufficient",
      recommended_outcome: "manual_review",
      manual_review_reason_code: "low_confidence",
    });
    const parsed = llmResponseCodec.parse(value);
    const roundtripped = llmResponseCodec.parse(JSON.parse(llmResponseCodec.serialize(parsed)));
    expect(roundtripped).toEqual(parsed);
  });
});

describe("redFlagsCodec", () => {
  it("parses a valid red flags JSON string", () => {
    const raw = JSON.stringify([{ code: "incomplete_submission", severity: "high", description: "Missing content." }]);
    const result = redFlagsCodec.parse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("incomplete_submission");
  });

  it("returns an empty array for null/undefined input", () => {
    expect(redFlagsCodec.parse(null)).toEqual([]);
    expect(redFlagsCodec.parse(undefined)).toEqual([]);
  });

  it("returns an empty array for malformed JSON", () => {
    expect(redFlagsCodec.parse("not json")).toEqual([]);
  });

  it("returns an empty array for non-array JSON", () => {
    expect(redFlagsCodec.parse(JSON.stringify({ not: "array" }))).toEqual([]);
  });

  it("serializes red flags to a JSON string", () => {
    const flags = [{ code: "low_content", severity: "medium", description: "Thin submission." }];
    const result = redFlagsCodec.serialize(flags);
    expect(JSON.parse(result)).toEqual(flags);
  });

  it("roundtrips a red flags array", () => {
    const flags = [
      { code: "incomplete_submission", severity: "high", description: "Missing." },
      { code: "low_content", severity: "medium", description: "Thin." },
    ];
    expect(redFlagsCodec.parse(redFlagsCodec.serialize(flags))).toEqual(flags);
  });
});
