import { z } from "zod";

const evidenceSufficiencySchema = z.enum(["sufficient", "insufficient", "uncertain"]);
const recommendedOutcomeSchema = z.enum(["pass", "fail", "manual_review"]);
const manualReviewReasonCodeSchema = z.enum([
  "none",
  "red_flag",
  "borderline",
  "low_confidence",
  "disagreement",
  "insufficient_evidence",
  "policy",
]);

export const llmResponseSchema = z.object({
  module_id: z.string(),
  rubric_scores: z.record(z.number().int().min(0)),
  rubric_total: z.number().int().min(0),
  practical_score_scaled: z.number().min(0).max(70),
  pass_fail_practical: z.boolean(),
  criterion_rationales: z.record(z.string()),
  improvement_advice: z.array(z.string()).max(10),
  red_flags: z.array(
    z.object({
      code: z.string(),
      severity: z.string(),
      description: z.string(),
    }),
  ),
  manual_review_recommended: z.boolean(),
  confidence_note: z.string(),
  evidence_sufficiency: evidenceSufficiencySchema.optional(),
  recommended_outcome: recommendedOutcomeSchema.optional(),
  manual_review_reason_code: manualReviewReasonCodeSchema.optional(),
});

export type LlmStructuredAssessment = z.infer<typeof llmResponseSchema>;

export const llmResponseCodec = {
  /** Parses and validates a raw JSON string. Throws if the content is invalid. */
  parse(raw: unknown): LlmStructuredAssessment {
    return llmResponseSchema.parse(raw);
  },

  serialize(value: LlmStructuredAssessment): string {
    return JSON.stringify(value);
  },
};
