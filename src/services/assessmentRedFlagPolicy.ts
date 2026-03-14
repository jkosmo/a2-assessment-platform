import { getAssessmentRules } from "../config/assessmentRules.js";
import type { LlmStructuredAssessment } from "./llmAssessmentService.js";

export type AssessmentRedFlag = LlmStructuredAssessment["red_flags"][number];

function slugifyCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildCanonicalLookup() {
  const rules = getAssessmentRules();
  const lookup = new Map<string, string>();

  for (const [canonicalCode, aliases] of Object.entries(rules.llmDecisionReliability.canonicalRedFlags)) {
    lookup.set(slugifyCode(canonicalCode), slugifyCode(canonicalCode));
    for (const alias of aliases) {
      lookup.set(slugifyCode(alias), slugifyCode(canonicalCode));
    }
  }

  return lookup;
}

function normalizeSeverity(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "low";
}

export function normalizeRedFlagCode(rawCode: string): string {
  const rules = getAssessmentRules();
  const lookup = buildCanonicalLookup();
  const normalizedCode = slugifyCode(rawCode);
  const canonical = lookup.get(normalizedCode);

  if (canonical) {
    return canonical;
  }

  return rules.llmDecisionReliability.unknownRedFlagHandling === "downgrade_to_unclassified"
    ? slugifyCode(rules.llmDecisionReliability.unknownRedFlagCanonicalCode)
    : normalizedCode;
}

export function normalizeRedFlag(flag: AssessmentRedFlag): AssessmentRedFlag {
  const normalizedCode = normalizeRedFlagCode(flag.code);
  return {
    code: normalizedCode,
    severity: normalizeSeverity(flag.severity),
    description: flag.description,
  };
}

export function normalizeRedFlags(flags: AssessmentRedFlag[]): AssessmentRedFlag[] {
  return flags.map((flag) => normalizeRedFlag(flag));
}

export function isConfiguredInsufficientEvidenceRedFlag(flag: AssessmentRedFlag): boolean {
  return normalizeRedFlagCode(flag.code) === "insufficient_submission";
}

export function isConfiguredManualReviewRedFlag(flag: AssessmentRedFlag): boolean {
  const rules = getAssessmentRules();
  const configuredCodes = new Set(rules.manualReview.redFlagCodes.map((code) => slugifyCode(code)));
  const configuredSeverities = new Set(rules.manualReview.redFlagSeverities.map((severity) => severity.toLowerCase()));
  const normalized = normalizeRedFlag(flag);
  return configuredCodes.has(normalized.code) && configuredSeverities.has(normalized.severity);
}

export function isConfiguredSecondaryTriggerRedFlag(flag: AssessmentRedFlag): boolean {
  const rules = getAssessmentRules();
  const configuredCodes = new Set(
    rules.secondaryAssessment.triggerRules.redFlagCodes.map((code) => slugifyCode(code)),
  );
  const configuredSeverities = new Set(
    rules.secondaryAssessment.triggerRules.redFlagSeverities.map((severity) => severity.toLowerCase()),
  );
  const normalized = normalizeRedFlag(flag);
  return configuredCodes.has(normalized.code) && configuredSeverities.has(normalized.severity);
}

export function buildAllowedRedFlagCodesForPrompt(): string[] {
  return Object.keys(getAssessmentRules().llmDecisionReliability.canonicalRedFlags)
    .map((code) => slugifyCode(code))
    .sort();
}
