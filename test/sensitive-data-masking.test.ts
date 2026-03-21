import { describe, expect, it } from "vitest";
import { preprocessSensitiveDataForLlm, type SensitiveDataPolicy } from "../src/modules/assessment/sensitiveDataMaskingService.js";

const basePolicy: SensitiveDataPolicy = {
  enabledByDefault: false,
  moduleOverrides: {},
  rules: [
    {
      id: "email",
      pattern: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}",
      flags: "gi",
      replacement: "[MASKED_EMAIL]",
    },
    {
      id: "phone",
      pattern: "\\b\\d{8}\\b",
      flags: "g",
      replacement: "[MASKED_PHONE]",
    },
  ],
};

describe("Sensitive data masking preprocessor", () => {
  it("detects sensitive data hits even when masking is disabled", () => {
    const result = preprocessSensitiveDataForLlm(
      {
        moduleId: "module-1",
        responseJson: {
          response: "Reach me at user@example.com",
          reflection: "Phone 12345678",
          promptExcerpt: "No sensitive values here",
        },
      },
      basePolicy,
    );

    expect(result.maskingEnabled).toBe(false);
    expect(result.maskingApplied).toBe(false);
    expect(result.totalMatches).toBe(2);
    expect(result.ruleHits).toEqual([
      { ruleId: "email", matches: 1 },
      { ruleId: "phone", matches: 1 },
    ]);
    expect((result.payload.responseJson.response as string)).toContain("user@example.com");
    expect((result.payload.responseJson.reflection as string)).toContain("12345678");
  });

  it("applies masking when enabled by module override", () => {
    const result = preprocessSensitiveDataForLlm(
      {
        moduleId: "module-sensitive",
        responseJson: {
          response: "Reach me at user@example.com",
          reflection: "Phone 12345678",
          promptExcerpt: "No sensitive values here",
        },
      },
      {
        ...basePolicy,
        moduleOverrides: {
          "module-sensitive": true,
        },
      },
    );

    expect(result.maskingEnabled).toBe(true);
    expect(result.maskingApplied).toBe(true);
    expect(result.totalMatches).toBe(2);
    expect((result.payload.responseJson.response as string)).toContain("[MASKED_EMAIL]");
    expect((result.payload.responseJson.reflection as string)).toContain("[MASKED_PHONE]");
    expect(result.fieldsMasked).toEqual(["response", "reflection"]);
  });
});
