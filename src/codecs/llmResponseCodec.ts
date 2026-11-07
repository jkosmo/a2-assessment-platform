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
  rubric_scores: z.record(z.number().int().min(0).max(4)),
  rubric_total: z.number().int().min(0),
  practical_score_scaled: z.number().min(0).max(70),
  pass_fail_practical: z.boolean(),
  criterion_rationales: z.record(z.string()),
  // #1135: trinnteksten modellen valgte per kriterium; plattformen setter poenget fra den. Løst typet:
  // et felt som bare hjelper, skal ikke kunne felle hele vurderingen.
  criterion_steps: z.record(z.unknown()).optional(),
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const CONTRACT_KEYS = new Set(Object.keys(llmResponseSchema.shape).filter((key) => key !== "criterion_rationales"));

/**
 * Målt på stage 2026-11-07, med ett kriterium med trinn: modellen lukket ikke `criterion_rationales`, og feltene
 * etter havnet INNE I det — først bare `criterion_steps` (fem av fem), så hele resten av svaret (tre av seks).
 * Svaret ble avvist på formatet og prøvd om igjen til jobben ga opp.
 *
 * Et felt fra svarkontrakten som ligger inne i begrunnelsene, flyttes ut:
 *  - er verdien ikke tekst, er den aldri en begrunnelse — den flyttes, og står feltet også på toppnivå, vinner det;
 *  - er verdien tekst, kan det være begrunnelsen for et kriterium med samme navn — den flyttes bare når feltet
 *    mangler på toppnivå, for da ville svaret uansett blitt avvist.
 */
function liftContractFieldsFromRationales(raw: unknown): unknown {
  if (!isObject(raw) || !isObject(raw.criterion_rationales)) return raw;
  const rationales: Record<string, unknown> = {};
  const lifted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw.criterion_rationales)) {
    const misplaced = CONTRACT_KEYS.has(key) && (typeof value !== "string" || raw[key] === undefined);
    if (!misplaced) rationales[key] = value;
    else if (raw[key] === undefined) lifted[key] = value;
  }
  if (Object.keys(rationales).length === Object.keys(raw.criterion_rationales).length) return raw;
  return { ...raw, ...lifted, criterion_rationales: rationales };
}

export const llmResponseCodec = {
  /** Parses and validates a raw JSON string. Throws if the content is invalid. */
  parse(raw: unknown): LlmStructuredAssessment {
    return llmResponseSchema.parse(liftContractFieldsFromRationales(raw));
  },

  serialize(value: LlmStructuredAssessment): string {
    return JSON.stringify(value);
  },
};
