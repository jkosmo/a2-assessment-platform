import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePracticalWithAzureOpenAi } from "../src/services/llmAssessmentService.js";

const originalFetch = global.fetch;

const baseInput = {
  moduleId: "module-1",
  rawText: "Candidate practical response with concrete implementation details.",
  reflectionText: "Candidate reflection with validation and iteration notes.",
  promptExcerpt: "Focus on practical utility and responsible use.",
  responseLocale: "en-GB" as const,
  moduleTaskText: "Participant assignment context.",
  moduleGuidanceText: "Expected answer context.",
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
  tokenLimitParameter: "max_tokens" as const,
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
  evidence_sufficiency: "sufficient",
  recommended_outcome: "pass",
  manual_review_reason_code: "none",
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
    const payload = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    expect(payload.max_tokens).toBe(1200);
    expect(payload.max_completion_tokens).toBeUndefined();
    const messages = payload.messages as Array<{ content: string }>;
    expect(messages[1].content).toContain("Participant assignment context:");
    expect(messages[1].content).toContain("Expected submission content context:");
    expect(messages[1].content).toContain("evidence_sufficiency");
    expect(messages[1].content).toContain("recommended_outcome");
    expect(messages[1].content).toContain("manual_review_reason_code");
    expect(messages[1].content).toContain("allowed red_flags.code values");
    expect(messages[1].content).toContain("insufficient_submission");
    expect(messages[1].content).toContain("potential_sensitive_data");
    expect(messages[1].content).toContain("Write all natural-language response fields in English (UK)");
  });

  it("includes a locale-specific language instruction for Norwegian Bokmal responses", async () => {
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

    await evaluatePracticalWithAzureOpenAi(
      {
        ...baseInput,
        responseLocale: "nb",
      },
      baseConfig,
    );

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    const messages = payload.messages as Array<{ content: string }>;
    expect(messages[1].content).toContain("Write all natural-language response fields in Norwegian Bokmal");
  });

  it("supports max_completion_tokens when configured", async () => {
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

    await evaluatePracticalWithAzureOpenAi(baseInput, {
      ...baseConfig,
      tokenLimitParameter: "max_completion_tokens",
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    expect(payload.max_completion_tokens).toBe(1200);
    expect(payload.max_tokens).toBeUndefined();
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

  it("normalizes observed insufficiency red-flag aliases to the canonical policy code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...validPayload,
                  red_flags: [
                    {
                      code: "incoherent_submission",
                      severity: "HIGH",
                      description: "Observed staging-style low-content flag.",
                    },
                  ],
                  manual_review_recommended: true,
                  evidence_sufficiency: "insufficient",
                  recommended_outcome: "manual_review",
                  manual_review_reason_code: "red_flag",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await evaluatePracticalWithAzureOpenAi(baseInput, baseConfig);

    expect(result.red_flags).toEqual([
      {
        code: "insufficient_submission",
        severity: "high",
        description: "Observed staging-style low-content flag.",
      },
    ]);
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

  it("retries with alternate token parameter when auto mode gets unsupported_parameter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "Unsupported parameter: 'max_completion_tokens' is not supported with this model. Use 'max_tokens' instead.",
              type: "invalid_request_error",
              param: "max_completion_tokens",
              code: "unsupported_parameter",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
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

    const result = await evaluatePracticalWithAzureOpenAi(baseInput, {
      ...baseConfig,
      tokenLimitParameter: "auto",
    });

    expect(result.module_id).toBe("module-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const firstPayload = JSON.parse(String(firstInit.body)) as Record<string, unknown>;
    expect(firstPayload.max_completion_tokens).toBe(1200);

    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondPayload = JSON.parse(String(secondInit.body)) as Record<string, unknown>;
    expect(secondPayload.max_tokens).toBe(1200);
  });
});
