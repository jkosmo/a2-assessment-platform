import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePracticalWithAzureOpenAi } from "../src/services/llmAssessmentService.js";

const originalFetch = global.fetch;

const baseInput = {
  moduleId: "module-1",
  rawText: "Candidate practical response with concrete implementation details.",
  reflectionText: "Candidate reflection with validation and iteration notes.",
  promptExcerpt: "Focus on practical utility and responsible use.",
  assessmentPass: "primary" as const,
};

const baseConfig = {
  endpoint: "https://example.openai.azure.com",
  apiKey: "test-key",
  deployment: "gpt-4o-mini",
  apiVersion: "2024-10-21",
  timeoutMs: 5000,
  temperature: 0,
  maxTokens: 1200,
};

const validPayload = {
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
    relevance_for_case: "Relevant to the task.",
    quality_and_utility: "Practical value is clear.",
    iteration_and_improvement: "Shows at least one iteration.",
    human_quality_assurance: "Includes human validation checks.",
    responsible_use: "Mentions responsible-use constraints.",
  },
  improvement_advice: ["Add stronger metrics."],
  red_flags: [],
  manual_review_recommended: false,
  confidence_note: "High confidence.",
};

describe("llmAssessmentService azure_openai adapter", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("maps Azure OpenAI chat completion output to validated assessment payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(validPayload),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await evaluatePracticalWithAzureOpenAi(baseInput, baseConfig);

    expect(result.module_id).toBe("module-1");
    expect(result.rubric_total).toBe(14);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe(
      "https://example.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21",
    );
    expect(requestInit.method).toBe("POST");
  });

  it("parses fenced JSON payloads from assistant content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``,
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await evaluatePracticalWithAzureOpenAi(baseInput, baseConfig);

    expect(result.pass_fail_practical).toBe(true);
    expect(result.confidence_note).toBe("High confidence.");
  });

  it("returns a clear provider error when Azure OpenAI request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Deployment not found.",
          },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(evaluatePracticalWithAzureOpenAi(baseInput, baseConfig)).rejects.toThrow(
      "Azure OpenAI request failed (404: Deployment not found.)",
    );
  });

  it("fails when assistant content is not parseable JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "This is not JSON",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(evaluatePracticalWithAzureOpenAi(baseInput, baseConfig)).rejects.toThrow(
      "Azure OpenAI did not return parseable JSON content.",
    );
  });
});
