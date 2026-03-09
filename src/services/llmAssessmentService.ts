import { z } from "zod";
import { env } from "../config/env.js";

const llmResponseSchema = z.object({
  module_id: z.string(),
  rubric_scores: z.object({
    relevance_for_case: z.number().int().min(0).max(4),
    quality_and_utility: z.number().int().min(0).max(4),
    iteration_and_improvement: z.number().int().min(0).max(4),
    human_quality_assurance: z.number().int().min(0).max(4),
    responsible_use: z.number().int().min(0).max(4),
  }),
  rubric_total: z.number().int().min(0).max(20),
  practical_score_scaled: z.number().min(0).max(70),
  pass_fail_practical: z.boolean(),
  criterion_rationales: z.object({
    relevance_for_case: z.string(),
    quality_and_utility: z.string(),
    iteration_and_improvement: z.string(),
    human_quality_assurance: z.string(),
    responsible_use: z.string(),
  }),
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
});

export type LlmStructuredAssessment = z.infer<typeof llmResponseSchema>;

type AssessmentContext = {
  moduleId: string;
  rawText: string;
  reflectionText: string;
  promptExcerpt: string;
  assessmentPass?: "primary" | "secondary";
};

export async function evaluatePracticalWithLlm(input: AssessmentContext): Promise<LlmStructuredAssessment> {
  if (env.LLM_MODE === "stub") {
    return llmResponseSchema.parse(buildStubResponse(input));
  }

  // The real provider integration can be plugged in without changing downstream
  // flow because strict schema validation is enforced here.
  throw new Error("LLM_MODE=azure_openai is not implemented yet.");
}

function buildStubResponse(input: AssessmentContext): LlmStructuredAssessment {
  const content = `${input.rawText}\n${input.reflectionText}\n${input.promptExcerpt}`.trim();
  const length = content.length;

  const baseScore = length > 800 ? 4 : length > 350 ? 3 : length > 150 ? 2 : 1;
  const responsibleUseScore = /sensitive|pii|client data/i.test(content) ? 1 : baseScore;
  const passAdjustment = input.assessmentPass === "secondary" ? -1 : 0;
  const redFlags =
    responsibleUseScore <= 1
      ? [
          {
            code: "POTENTIAL_SENSITIVE_DATA",
            severity: "medium",
            description: "Submission may contain sensitive references and requires extra care.",
          },
        ]
      : [];

  const rubricScores = {
    relevance_for_case: Math.max(0, Math.min(4, baseScore + passAdjustment)),
    quality_and_utility: Math.max(0, Math.min(4, baseScore + passAdjustment)),
    iteration_and_improvement: Math.max(0, Math.min(4, baseScore - 1 + passAdjustment)),
    human_quality_assurance: Math.max(0, Math.min(4, baseScore + passAdjustment)),
    responsible_use: responsibleUseScore,
  };

  const rubricTotal =
    rubricScores.relevance_for_case +
    rubricScores.quality_and_utility +
    rubricScores.iteration_and_improvement +
    rubricScores.human_quality_assurance +
    rubricScores.responsible_use;
  const practicalScoreScaled = Number(((rubricTotal / 20) * 70).toFixed(2));

  return {
    module_id: input.moduleId,
    rubric_scores: rubricScores,
    rubric_total: rubricTotal,
    practical_score_scaled: practicalScoreScaled,
    pass_fail_practical: (rubricTotal / 20) * 100 >= 50,
    criterion_rationales: {
      relevance_for_case: "Stub: submission appears relevant to the module task.",
      quality_and_utility: "Stub: output shows practical utility.",
      iteration_and_improvement: "Stub: at least one improvement iteration is visible.",
      human_quality_assurance: "Stub: includes human QA/reflection markers.",
      responsible_use: "Stub: responsible-use checks inferred from provided content.",
    },
    improvement_advice: [
      "Provide clearer before/after examples.",
      "Describe concrete validation checks you performed.",
      "Reference responsible-use constraints explicitly.",
    ],
    red_flags: redFlags,
    manual_review_recommended: redFlags.length > 0,
    confidence_note:
      redFlags.length > 0
        ? input.assessmentPass === "secondary"
          ? "Low confidence due to potential responsible-use ambiguity."
          : "Medium confidence due to potential responsible-use ambiguity."
        : "High confidence: structured and sufficiently detailed submission.",
  };
}
