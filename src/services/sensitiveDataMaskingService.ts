import { getAssessmentRules } from "../config/assessmentRules.js";

type LlmPayloadInput = {
  moduleId: string;
  rawText: string;
  reflectionText: string;
  promptExcerpt: string;
};

type RuleHit = {
  ruleId: string;
  matches: number;
};

export type SensitiveDataPolicy = ReturnType<typeof getAssessmentRules>["sensitiveData"];

export type SensitiveDataPreprocessResult = {
  payload: Omit<LlmPayloadInput, "moduleId">;
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

  let workingRawText = input.rawText;
  let workingReflectionText = input.reflectionText;
  let workingPromptExcerpt = input.promptExcerpt;

  let totalMatches = 0;
  const ruleHits: RuleHit[] = [];
  const fieldsMasked = new Set<string>();

  for (const rule of rules.rules) {
    const regex = buildGlobalRegex(rule.pattern, rule.flags);

    const rawMatchCount = countMatches(workingRawText, regex);
    if (rawMatchCount > 0) {
      totalMatches += rawMatchCount;
      fieldsMasked.add("rawText");
      if (maskingEnabled) {
        workingRawText = workingRawText.replace(regex, rule.replacement);
      }
    }

    const reflectionMatchCount = countMatches(workingReflectionText, regex);
    if (reflectionMatchCount > 0) {
      totalMatches += reflectionMatchCount;
      fieldsMasked.add("reflectionText");
      if (maskingEnabled) {
        workingReflectionText = workingReflectionText.replace(regex, rule.replacement);
      }
    }

    const promptMatchCount = countMatches(workingPromptExcerpt, regex);
    if (promptMatchCount > 0) {
      totalMatches += promptMatchCount;
      fieldsMasked.add("promptExcerpt");
      if (maskingEnabled) {
        workingPromptExcerpt = workingPromptExcerpt.replace(regex, rule.replacement);
      }
    }

    const ruleMatchTotal = rawMatchCount + reflectionMatchCount + promptMatchCount;
    if (ruleMatchTotal > 0) {
      ruleHits.push({ ruleId: rule.id, matches: ruleMatchTotal });
    }
  }

  return {
    payload: {
      rawText: workingRawText,
      reflectionText: workingReflectionText,
      promptExcerpt: workingPromptExcerpt,
    },
    maskingEnabled,
    maskingApplied: maskingEnabled && totalMatches > 0,
    totalMatches,
    ruleHits,
    fieldsMasked: Array.from(fieldsMasked),
  };
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
