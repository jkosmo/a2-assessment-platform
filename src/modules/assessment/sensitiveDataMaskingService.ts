import { getAssessmentRules } from "../../config/assessmentRules.js";

type LlmPayloadInput = {
  moduleId: string;
  responseJson: Record<string, unknown>;
};

type RuleHit = {
  ruleId: string;
  matches: number;
};

export type SensitiveDataPolicy = ReturnType<typeof getAssessmentRules>["sensitiveData"];

export type SensitiveDataPreprocessResult = {
  payload: { responseJson: Record<string, unknown> };
  maskingEnabled: boolean;
  maskingApplied: boolean;
  totalMatches: number;
  ruleHits: RuleHit[];
  fieldsMasked: string[];
};

export function preprocessSensitiveDataForLlm(
  input: LlmPayloadInput,
  policy: SensitiveDataPolicy = getAssessmentRules().sensitiveData,
): SensitiveDataPreprocessResult {
  const rules = policy;
  const maskingEnabled = rules.moduleOverrides[input.moduleId] ?? rules.enabledByDefault;

  let totalMatches = 0;
  const ruleHits: RuleHit[] = [];
  const fieldsMasked = new Set<string>();

  let workingResponseJson = { ...input.responseJson };

  for (const rule of rules.rules) {
    const regex = buildGlobalRegex(rule.pattern, rule.flags);

    const { masked, matchCount, maskedKeys } = maskStringValuesInObject(
      workingResponseJson,
      regex,
      rule.replacement,
      maskingEnabled,
    );

    if (matchCount > 0) {
      totalMatches += matchCount;
      for (const key of maskedKeys) {
        fieldsMasked.add(key);
      }
      if (maskingEnabled) {
        workingResponseJson = masked as Record<string, unknown>;
      }

      ruleHits.push({ ruleId: rule.id, matches: matchCount });
    }
  }

  return {
    payload: {
      responseJson: workingResponseJson,
    },
    maskingEnabled,
    maskingApplied: maskingEnabled && totalMatches > 0,
    totalMatches,
    ruleHits,
    fieldsMasked: Array.from(fieldsMasked),
  };
}

function maskStringValuesInObject(
  obj: Record<string, unknown>,
  regex: RegExp,
  replacement: string,
  applyMasking: boolean,
): { masked: Record<string, unknown>; matchCount: number; maskedKeys: string[] } {
  const masked: Record<string, unknown> = {};
  let matchCount = 0;
  const maskedKeys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const count = countMatches(value, regex);
      if (count > 0) {
        matchCount += count;
        maskedKeys.push(key);
        masked[key] = applyMasking ? value.replace(regex, replacement) : value;
      } else {
        masked[key] = value;
      }
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = maskStringValuesInObject(
        value as Record<string, unknown>,
        regex,
        replacement,
        applyMasking,
      );
      matchCount += nested.matchCount;
      for (const k of nested.maskedKeys) {
        maskedKeys.push(k);
      }
      masked[key] = nested.masked;
    } else {
      masked[key] = value;
    }
  }

  return { masked, matchCount, maskedKeys };
}

function buildGlobalRegex(pattern: string, flags: string | undefined) {
  const sanitizedFlags = normalizeRegexFlags(flags);
  return new RegExp(pattern, sanitizedFlags);
}

function normalizeRegexFlags(flags: string | undefined) {
  const uniqueFlags = new Set((flags ?? "").split(""));
  uniqueFlags.add("g");
  return Array.from(uniqueFlags).join("");
}

function countMatches(text: string, regex: RegExp) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}
