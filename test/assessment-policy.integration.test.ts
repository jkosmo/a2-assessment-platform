import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/prisma.js";
import type { LlmStructuredAssessment } from "../src/modules/assessment/llmAssessmentService.js";
import {
  createSubmission,
  findModuleIdByTitle,
  runAssessmentSync,
  startMcq,
  submitMcqWithAnswerSelector,
} from "./support/participantFlow.js";

const mockEvaluatePracticalWithLlm = vi.hoisted(() => vi.fn());

vi.mock("../src/modules/assessment/llmAssessmentService.js", async () => {
  const actual = await vi.importActual<typeof import("../src/modules/assessment/llmAssessmentService.js")>(
    "../src/modules/assessment/llmAssessmentService.js",
  );

  return {
    ...actual,
    evaluatePracticalWithLlm: mockEvaluatePracticalWithLlm,
  };
});

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
};

function buildAssessment(overrides: Partial<LlmStructuredAssessment> = {}): LlmStructuredAssessment {
  return {
    module_id: "seed_module_genai_foundations",
    rubric_scores: {
      task_comprehension: 3,
      quality_and_depth: 3,
      evidence_and_examples: 2,
      reasoning_and_reflection: 3,
      clarity_and_structure: 3,
    },
    rubric_total: 14,
    practical_score_scaled: 49,
    pass_fail_practical: true,
    criterion_rationales: {
      task_comprehension: "The submission addresses the task clearly.",
      quality_and_depth: "The content is substantive and well-reasoned.",
      evidence_and_examples: "Concrete examples are provided.",
      reasoning_and_reflection: "Reasoning is clearly documented.",
      clarity_and_structure: "The response is clearly structured.",
    },
    improvement_advice: ["Keep documenting validation checks."],
    red_flags: [],
    manual_review_recommended: false,
    confidence_note: "High confidence in assessment.",
    evidence_sufficiency: "sufficient",
    recommended_outcome: "pass",
    manual_review_reason_code: "none",
    ...overrides,
  };
}

async function loadFreshApp(): Promise<Express> {
  vi.resetModules();
  const { app } = await import("../src/app.js");
  return app;
}

async function createAssessedSubmission(
  app: Express,
  llmResults: LlmStructuredAssessment[],
  input: {
    rawText: string;
    reflectionText: string;
    promptExcerpt: string;
    selectAnswer: (question: { id: string; stem: string }) => string;
  },
) {
  mockEvaluatePracticalWithLlm.mockReset();
  for (const result of llmResults) {
    mockEvaluatePracticalWithLlm.mockResolvedValueOnce(result);
  }

  const moduleId = await findModuleIdByTitle(app, participantHeaders, "Generative AI Foundations");
  const submissionId = await createSubmission(app, participantHeaders, {
    moduleId,
    responseJson: {
      response: input.rawText,
      reflection: input.reflectionText,
      promptExcerpt: input.promptExcerpt,
    },
  });

  const mcqStart = await startMcq(app, participantHeaders, moduleId, submissionId);
  await submitMcqWithAnswerSelector(
    app,
    participantHeaders,
    moduleId,
    submissionId,
    mcqStart.attemptId,
    mcqStart.questions,
    input.selectAnswer,
  );

  await runAssessmentSync(app, participantHeaders, submissionId);
  const resultResponse = await request(app).get(`/api/submissions/${submissionId}/result`).set(participantHeaders);
  expect(resultResponse.status).toBe(200);
  return resultResponse.body as {
    status: string;
    decision: { decisionReason: string; passFailTotal: boolean; totalScore: number };
    participantGuidance: {
      decisionMetadata: {
        evidenceSufficiency: string | null;
        recommendedOutcome: string | null;
        manualReviewReasonCode: string | null;
      };
    };
  };
}

describe("Local integration assessment policy suite", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockEvaluatePracticalWithLlm.mockReset();
  });

  it("TC-POL-RED-001 keeps clearly incomplete submissions red instead of manual review", async () => {
    const app = await loadFreshApp();
    const result = await createAssessedSubmission(
      app,
      [
        buildAssessment({
          rubric_scores: {
            task_comprehension: 0,
            quality_and_depth: 0,
            evidence_and_examples: 0,
            reasoning_and_reflection: 0,
            clarity_and_structure: 0,
          },
          rubric_total: 0,
          practical_score_scaled: 0,
          pass_fail_practical: false,
          criterion_rationales: {
            task_comprehension: "Submission does not address the task requirements.",
            quality_and_depth: "Content is not substantive enough for evaluation.",
            evidence_and_examples: "No concrete examples are provided.",
            reasoning_and_reflection: "No reasoning or reflection is present.",
            clarity_and_structure: "Response lacks structure and clarity.",
          },
          improvement_advice: [
            "Address all parts of the task with specific examples.",
            "Include reasoning and reflection in your response.",
          ],
          red_flags: [
            {
              code: "incomplete_submission",
              severity: "high",
              description: "Submission lacks sufficient content for evaluation.",
            },
            {
              code: "extremely_low_content",
              severity: "high",
              description: "Minimal content provided; insufficient basis for evaluation.",
            },
          ],
          manual_review_recommended: true,
          confidence_note: "Very low confidence in automated scoring due to lack of content; human review required.",
          evidence_sufficiency: "insufficient",
          recommended_outcome: "manual_review",
          manual_review_reason_code: "insufficient_evidence",
        }),
      ],
      {
        rawText: "Hepp Hepp Hepp som det. Hvorfor er alt rødt nå",
        reflectionText: "Hepp hopp topp",
        promptExcerpt: "Promp",
        selectAnswer: () => "Ingen poengsetting nødvendig",
      },
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.decision.passFailTotal).toBe(false);
    expect(result.decision.decisionReason).toBe("Automatic fail due to insufficient submission evidence.");
    expect(result.participantGuidance.decisionMetadata).toEqual(
      expect.objectContaining({
        evidenceSufficiency: "insufficient",
        recommendedOutcome: "manual_review",
        manualReviewReasonCode: "insufficient_evidence",
      }),
    );
    expect(mockEvaluatePracticalWithLlm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["incoherent_submission", "high"],
    ["garbled_submission", "high"],
    ["insufficient_content", "high"],
    ["r001", "high"],
    ["non_coherent_language", "medium"],
  ])(
    "TC-POL-RED-002 normalizes unstable insufficiency red flags (%s) into automatic fail",
    async (rawRedFlagCode, severity) => {
      const app = await loadFreshApp();
      const result = await createAssessedSubmission(
        app,
        [
          buildAssessment({
            rubric_scores: {
              task_comprehension: 0,
              quality_and_depth: 0,
              evidence_and_examples: 0,
              reasoning_and_reflection: 0,
              clarity_and_structure: 0,
            },
            rubric_total: 0,
            practical_score_scaled: 0,
            pass_fail_practical: false,
            criterion_rationales: {
              task_comprehension: "Submission does not address the required task content.",
              quality_and_depth: "The response is not substantive enough to evaluate.",
              evidence_and_examples: "No concrete examples are present.",
              reasoning_and_reflection: "No reasoning or reflection is present.",
              clarity_and_structure: "Response lacks structure and clarity.",
            },
            improvement_advice: [
              "Address all parts of the task with specific examples.",
              "Include reasoning and reflection in your response.",
            ],
            red_flags: [
              {
                code: rawRedFlagCode,
                severity,
                description: "Observed staging-style insufficiency/completeness red flag.",
              },
            ],
            manual_review_recommended: true,
            confidence_note: "Very low confidence in evaluating candidate due to insufficient content and lack of required components.",
            evidence_sufficiency: "insufficient",
            recommended_outcome: "manual_review",
            manual_review_reason_code: "red_flag",
          }),
        ],
        {
          rawText: "Hepp Hepp Hepp som det. Hvorfor er alt rÃ¸dt nÃ¥",
          reflectionText: "Hepp hopp topp",
          promptExcerpt: "Promp",
          selectAnswer: () => "Ingen poengsetting nÃ¸dvendig",
        },
      );

      expect(result.status).toBe("COMPLETED");
      expect(result.decision.passFailTotal).toBe(false);
      expect(result.decision.decisionReason).toBe("Automatic fail due to insufficient submission evidence.");
      expect(result.participantGuidance.decisionMetadata).toEqual(
        expect.objectContaining({
          evidenceSufficiency: "insufficient",
          recommendedOutcome: "manual_review",
          manualReviewReasonCode: "red_flag",
        }),
      );
      expect(mockEvaluatePracticalWithLlm).toHaveBeenCalledTimes(1);
    },
  );

  it("TC-POL-YELLOW-001 keeps high-risk safety cases under review", async () => {
    const app = await loadFreshApp();
    const result = await createAssessedSubmission(
      app,
      [
        buildAssessment({
          rubric_scores: {
            task_comprehension: 1,
            quality_and_depth: 1,
            evidence_and_examples: 1,
            reasoning_and_reflection: 0,
            clarity_and_structure: 0,
          },
          rubric_total: 3,
          practical_score_scaled: 10.5,
          pass_fail_practical: false,
          red_flags: [
            {
              code: "POTENTIAL_SENSITIVE_DATA",
              severity: "high",
              description: "Sensitive client data may have been exposed to an external model.",
            },
          ],
          manual_review_recommended: true,
          confidence_note: "Low confidence due to potential responsible-use violation; human review required.",
          evidence_sufficiency: "uncertain",
          recommended_outcome: "manual_review",
          manual_review_reason_code: "red_flag",
        }),
        buildAssessment({
          rubric_scores: {
            task_comprehension: 1,
            quality_and_depth: 1,
            evidence_and_examples: 0,
            reasoning_and_reflection: 0,
            clarity_and_structure: 0,
          },
          rubric_total: 2,
          practical_score_scaled: 7,
          pass_fail_practical: false,
          red_flags: [
            {
              code: "POTENTIAL_SENSITIVE_DATA",
              severity: "high",
              description: "Sensitive client data may have been exposed to an external model.",
            },
          ],
          manual_review_recommended: true,
          confidence_note: "Low confidence remains due to sensitive-data exposure concerns.",
          evidence_sufficiency: "uncertain",
          recommended_outcome: "manual_review",
          manual_review_reason_code: "red_flag",
        }),
      ],
      {
        rawText: "I pasted client personal data into a public AI service and planned to share the raw output.",
        reflectionText: "I did not perform a quality assurance review before sharing the result.",
        promptExcerpt: "Summarize this client dataset and keep all identifiers visible.",
        selectAnswer: () => "Ingen poengsetting nødvendig",
      },
    );

    expect(result.status).toBe("UNDER_REVIEW");
    expect(result.decision.passFailTotal).toBe(false);
    expect(result.decision.decisionReason).toContain("manual review");
    expect(result.participantGuidance.decisionMetadata).toEqual(
      expect.objectContaining({
        evidenceSufficiency: "uncertain",
        recommendedOutcome: "manual_review",
        manualReviewReasonCode: "red_flag",
      }),
    );
    expect(mockEvaluatePracticalWithLlm).toHaveBeenCalledTimes(2);
  });

  it("TC-POL-GREEN-001 keeps strong submissions green", async () => {
    const app = await loadFreshApp();
    const result = await createAssessedSubmission(
      app,
      [buildAssessment()],
      {
        rawText:
          "I used generative AI to improve a workshop agenda, refined the prompt twice, and validated the final output against the original notes before sending it.",
        reflectionText:
          "The second iteration was better because I constrained the output to actual decisions and removed invented assumptions during manual QA.",
        promptExcerpt: "Rewrite this workshop brief with clear outcomes, action items, and no invented facts.",
        selectAnswer: (question) =>
          question.stem === "What is the recommended model ownership boundary?"
            ? "Backend owns final decision"
            : "Prompt versions and thresholds",
      },
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.decision.passFailTotal).toBe(true);
    expect(result.decision.decisionReason).toBe("Automatic pass by threshold rules.");
    expect(result.participantGuidance.decisionMetadata).toEqual(
      expect.objectContaining({
        evidenceSufficiency: "sufficient",
        recommendedOutcome: "pass",
        manualReviewReasonCode: "none",
      }),
    );
    expect(mockEvaluatePracticalWithLlm).toHaveBeenCalledTimes(1);
  });
});
