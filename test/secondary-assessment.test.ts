import { describe, expect, it } from "vitest";
import {
  evaluateSecondaryAssessmentDisagreement,
  evaluateSecondaryAssessmentTrigger,
  type SecondaryAssessmentPolicy,
} from "../src/services/secondaryAssessmentService.js";
import type { LlmStructuredAssessment } from "../src/services/llmAssessmentService.js";

const basePolicy: SecondaryAssessmentPolicy = {
  enabledByDefault: true,
  moduleOverrides: {},
  triggerRules: {
    manualReviewRecommended: true,
    confidenceNotePatterns: ["medium confidence", "low confidence"],
    redFlagCodes: ["potential_sensitive_data", "policy_violation", "responsible_use_violation"],
    redFlagSeverities: ["medium", "high"],
  },
  disagreementRules: {
    practicalScoreDeltaMin: 8,
    rubricTotalDeltaMin: 3,
    passFailMismatch: true,
    manualReviewRecommendationMismatch: true,
  },
};

function buildAssessment(overrides: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment {
  return {
    module_id: "module-1",
    rubric_scores: {
      relevance_for_case: 3,
      quality_and_utility: 3,
      iteration_and_improvement: 2,
      human_quality_assurance: 3,
      responsible_use: 3,
    },
    rubric_total: 14,
    practical_score_scaled: 49,
    pass_fail_practical: true,
    criterion_rationales: {
      relevance_for_case: "ok",
      quality_and_utility: "ok",
      iteration_and_improvement: "ok",
      human_quality_assurance: "ok",
      responsible_use: "ok",
    },
    improvement_advice: [],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "High confidence",
    evidence_sufficiency: "sufficient",
    recommended_outcome: "pass",
    manual_review_reason_code: "none",
    ...overrides,
  };
}

describe("Secondary assessment policy", () => {
  it("triggers secondary pass from confidence and manual-review signal", () => {
    const trigger = evaluateSecondaryAssessmentTrigger(
      {
        moduleId: "module-1",
        primaryResult: buildAssessment({
          recommended_outcome: "manual_review",
          manual_review_recommended: true,
          manual_review_reason_code: "low_confidence",
          confidence_note: "Medium confidence due to ambiguity",
        }),
      },
      basePolicy,
    );

    expect(trigger.enabled).toBe(true);
    expect(trigger.shouldRun).toBe(true);
    expect(trigger.reasons).toContain("primary_result_manual_review_recommended");
    expect(trigger.reasons).toContain("primary_result_low_or_medium_confidence");
  });

  it("skips secondary pass for explicit insufficient-evidence auto-fail metadata", () => {
    const trigger = evaluateSecondaryAssessmentTrigger(
      {
        moduleId: "module-1",
        primaryResult: buildAssessment({
          rubric_total: 0,
          practical_score_scaled: 0,
          pass_fail_practical: false,
          evidence_sufficiency: "insufficient",
          recommended_outcome: "fail",
          manual_review_reason_code: "insufficient_evidence",
          manual_review_recommended: false,
          confidence_note: "Low confidence due to insufficient submission evidence.",
        }),
      },
      basePolicy,
    );

    expect(trigger.enabled).toBe(true);
    expect(trigger.shouldRun).toBe(false);
    expect(trigger.reasons).toEqual(["primary_result_insufficient_evidence_auto_fail"]);
  });

  it("skips secondary pass when the only red flags are insufficient-evidence completeness flags", () => {
    const trigger = evaluateSecondaryAssessmentTrigger(
      {
        moduleId: "module-1",
        primaryResult: buildAssessment({
          rubric_total: 0,
          practical_score_scaled: 0,
          pass_fail_practical: false,
          evidence_sufficiency: "insufficient",
          recommended_outcome: "manual_review",
          manual_review_reason_code: "red_flag",
          manual_review_recommended: true,
          confidence_note:
            "Very low confidence in evaluating candidate due to insufficient content and lack of required components.",
          red_flags: [
            {
              code: "incomplete_submission",
              severity: "high",
              description:
                "Submission lacks MCQ answers, reflection depth, and QA notes.",
            },
            {
              code: "extremely_low_content",
              severity: "high",
              description: "Minimal content provided; insufficient basis for evaluation.",
            },
          ],
        }),
      },
      basePolicy,
    );

    expect(trigger.enabled).toBe(true);
    expect(trigger.shouldRun).toBe(false);
    expect(trigger.reasons).toEqual(["primary_result_insufficient_evidence_auto_fail"]);
  });

  it("respects module override disable", () => {
    const trigger = evaluateSecondaryAssessmentTrigger(
      {
        moduleId: "module-off",
        primaryResult: buildAssessment({
          manual_review_recommended: true,
          confidence_note: "Medium confidence due to ambiguity",
        }),
      },
      {
        ...basePolicy,
        moduleOverrides: {
          "module-off": false,
        },
      },
    );

    expect(trigger.enabled).toBe(false);
    expect(trigger.shouldRun).toBe(false);
  });

  it("flags disagreements when thresholds and mismatch rules are hit", () => {
    const disagreement = evaluateSecondaryAssessmentDisagreement(
      buildAssessment({
        rubric_total: 16,
        practical_score_scaled: 56,
        pass_fail_practical: true,
        manual_review_recommended: false,
      }),
      buildAssessment({
        rubric_total: 10,
        practical_score_scaled: 35,
        pass_fail_practical: false,
        manual_review_recommended: true,
      }),
      basePolicy,
    );

    expect(disagreement.hasDisagreement).toBe(true);
    expect(disagreement.reasons).toContain("practical_score_delta_exceeded");
    expect(disagreement.reasons).toContain("rubric_total_delta_exceeded");
    expect(disagreement.reasons).toContain("pass_fail_mismatch");
    expect(disagreement.reasons).toContain("manual_review_recommendation_mismatch");
  });
});
