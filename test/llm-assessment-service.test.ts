import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePracticalWithAzureOpenAi, generateModelAnswerWithAzureOpenAi } from "../src/modules/assessment/llmAssessmentService.js";

const originalFetch = global.fetch;

const baseInput = {
  moduleId: "module-1",
  responseJson: {
    response: "Candidate practical response with concrete implementation details.",
    reflection: "Candidate reflection with validation and iteration notes.",
    promptExcerpt: "Focus on practical utility and responsible use.",
  },
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

  // #1135, målt på stage: modellen ga poeng på kriteriets egen skala (0–2) — et perfekt svar ble 50 %.
  // Omregningen til 0–4 skjer på svaret fra Azure, ikke i prompten.
  it("#1135: poeng på kriteriets egen skala regnes om til 0–4 i svaret fra Azure", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...validPayload, rubric_scores: { ...validPayload.rubric_scores, iteration_and_improvement: 2 }, rubric_total: 14 }) } }] }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const result = await evaluatePracticalWithAzureOpenAi(
      { ...baseInput, rubricCriteria: [{ id: "iteration_and_improvement", label: "Iterasjon", description: "0 = ingen; 1 = én; 2 = flere", scaleMax: 2 }] },
      baseConfig,
    );
    expect(result.rubric_scores.iteration_and_improvement).toBe(4);
    expect(result.rubric_total).toBe(16);
  });

  // #1135, målt mot stage-modellen: begrunnelsen beskrev trinn 1, poenget ble 0. Trinnteksten modellen
  // valgte setter poenget før omregningen: «én» er trinn 1 av 2, altså 2 av 4 — ikke 0.
  it("#1135: trinnet modellen valgte setter poenget, så regnes det om til 0–4", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...validPayload, rubric_scores: { ...validPayload.rubric_scores, iteration_and_improvement: 0 }, rubric_total: 12, criterion_steps: { iteration_and_improvement: "én" } }) } }] }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const result = await evaluatePracticalWithAzureOpenAi(
      {
        ...baseInput,
        rubricCriteria: [{ id: "iteration_and_improvement", label: "Iterasjon", description: "0 = ingen; 1 = én; 2 = flere", scaleMax: 2, steps: [{ step: 0, text: "ingen" }, { step: 1, text: "én" }, { step: 2, text: "flere" }] }],
      },
      baseConfig,
    );
    expect(result.rubric_scores.iteration_and_improvement).toBe(2);
    expect(result.rubric_total).toBe(14);
  });

  // 2.140.0, målt på stage: modellen la trinnvalget inne i begrunnelsene og ga «praktisk 0». Svaret fra Azure skal
  // leses, trinnet skal sette poenget, og delpoenget skal følge kriteriepoengene — hele veien gjennom adapteren.
  it("2.140.0: trinnvalg inne i begrunnelsene brukes, og delpoenget følger de rettede poengene", async () => {
    const svar = {
      ...validPayload,
      rubric_scores: { vedtak: 0 },
      rubric_total: 0,
      practical_score_scaled: 0,
      criterion_rationales: { vedtak: "Vedtakene står først.", criterion_steps: { vedtak: "flere" } },
    };
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(svar) } }] }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const result = await evaluatePracticalWithAzureOpenAi(
      {
        ...baseInput,
        rubricCriteriaIds: ["vedtak"],
        rubricCriteria: [{ id: "vedtak", label: "Vedtak", description: "0 = ingen; 1 = én; 2 = flere", scaleMax: 2, steps: [{ step: 0, text: "ingen" }, { step: 1, text: "én" }, { step: 2, text: "flere" }] }],
      },
      baseConfig,
    );
    expect(result.criterion_rationales).toEqual({ vedtak: "Vedtakene står først." });
    expect(result.rubric_scores).toEqual({ vedtak: 4 });
    expect(result.practical_score_scaled).toBe(70);
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
    expect(messages[1].content).toContain("Assessor expected content (hidden from candidate");
    expect(messages[1].content).toContain("Scoring constraint:");
    expect(messages[1].content).toContain("Do not import requirements, criteria, or expectations from your own domain knowledge");
    expect(messages[1].content).toContain("evidence_sufficiency");
    expect(messages[1].content).toContain("recommended_outcome");
    expect(messages[1].content).toContain("manual_review_reason_code");
    expect(messages[1].content).toContain("Allowed red_flags.code values with usage criteria");
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

// #1147: KI-svaret til likhetssjekken (#475) valgte alltid `max_tokens` med `auto`, og modellen i prod avviser den. Sjekken
// feilet ved hver innlevering fra minst 2026-10-14. Mocken under oppfører seg som modellen i prod.
describe("#1147: KI-svaret til likhetssjekken har samme reserve som vurderingen", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const reject = (param: string, message: string) =>
    new Response(JSON.stringify({ error: { message, type: "invalid_request_error", param, code: "unsupported_parameter" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  const answer = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });

  /** Som modellen i prod: avviser `max_tokens`, og (valgfritt) en temperatur som ikke er standard. */
  const prodLikeModel = (options: { rejectsTemperature?: boolean } = {}) =>
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if ("max_tokens" in body) {
        return reject("max_tokens", "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.");
      }
      if (options.rejectsTemperature && "temperature" in body) {
        return reject("temperature", "Unsupported value: 'temperature' does not support 0 with this model.");
      }
      return answer("Et modellsvar.");
    });

  const input = { moduleTaskText: "Skriv om møtearbeid.", responseLocale: "nb" as const };

  it("`auto` mot en modell som avviser `max_tokens`: svaret kommer, sendt med `max_completion_tokens`", async () => {
    const fetchMock = prodLikeModel();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(generateModelAnswerWithAzureOpenAi(input, { ...baseConfig, tokenLimitParameter: "auto" })).resolves.toBe("Et modellsvar.");
    const last = JSON.parse(String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(last.max_completion_tokens).toBe(1200);
    expect(last.max_tokens).toBeUndefined();
  });

  it("avvist temperatur: prøves på nytt uten temperatur", async () => {
    const fetchMock = prodLikeModel({ rejectsTemperature: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(generateModelAnswerWithAzureOpenAi(input, { ...baseConfig, tokenLimitParameter: "auto" })).resolves.toBe("Et modellsvar.");
    const last = JSON.parse(String((fetchMock.mock.calls.at(-1) as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(last.temperature).toBeUndefined();
  });

  it("`max_tokens` valgt med vilje: ingen reserve, og feilen sier at det var KI-svaret", async () => {
    const fetchMock = prodLikeModel();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(generateModelAnswerWithAzureOpenAi(input, { ...baseConfig, tokenLimitParameter: "max_tokens" })).rejects.toThrow(
      "Azure OpenAI model-answer request failed (400: Unsupported parameter: 'max_tokens'",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("vurderingen bruker samme reserve: avvist temperatur prøves uten", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if ("temperature" in body) return reject("temperature", "Unsupported value: 'temperature' does not support 0 with this model.");
      return answer(JSON.stringify(validPayload));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await evaluatePracticalWithAzureOpenAi(baseInput, baseConfig);
    expect(result.module_id).toBe("module-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
