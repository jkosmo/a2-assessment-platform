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
  moduleTaskText?: string;
  moduleGuidanceText?: string;
  assessmentPass?: "primary" | "secondary";
  promptTemplateSystem?: string;
  promptTemplateUserTemplate?: string;
  promptTemplateExamplesJson?: string;
};

type AzureOpenAiRuntimeConfig = {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  tokenLimitParameter: "max_tokens" | "max_completion_tokens" | "auto";
};

export async function evaluatePracticalWithLlm(input: AssessmentContext): Promise<LlmStructuredAssessment> {
  if (env.LLM_MODE === "stub") {
    return llmResponseSchema.parse(buildStubResponse(input));
  }

  if (env.LLM_MODE === "azure_openai") {
    return evaluatePracticalWithAzureOpenAi(input, {
      endpoint: env.AZURE_OPENAI_ENDPOINT ?? "",
      apiKey: env.AZURE_OPENAI_API_KEY ?? "",
      deployment: env.AZURE_OPENAI_DEPLOYMENT ?? "",
      apiVersion: env.AZURE_OPENAI_API_VERSION,
      timeoutMs: env.AZURE_OPENAI_TIMEOUT_MS,
      temperature: env.AZURE_OPENAI_TEMPERATURE,
      maxTokens: env.AZURE_OPENAI_MAX_TOKENS,
      tokenLimitParameter: env.AZURE_OPENAI_TOKEN_LIMIT_PARAMETER,
    });
  }

  throw new Error(`Unsupported LLM mode: ${env.LLM_MODE}`);
}

export async function evaluatePracticalWithAzureOpenAi(
  input: AssessmentContext,
  config: AzureOpenAiRuntimeConfig,
): Promise<LlmStructuredAssessment> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
  const tokenParameterSequence = resolveTokenParameterSequence(config.tokenLimitParameter);
  let lastProviderError: Error | null = null;

  try {
    for (let index = 0; index < tokenParameterSequence.length; index += 1) {
      const tokenParameter = tokenParameterSequence[index];
      const response = await fetch(buildAzureOpenAiCompletionsUrl(config), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": config.apiKey,
        },
        body: JSON.stringify(buildAzureOpenAiRequestBody(input, config, tokenParameter)),
        signal: timeoutController.signal,
      });

      const rawBody = await response.text();
      const responseBody = parseJsonBody(rawBody);

      if (!response.ok) {
        if (
          config.tokenLimitParameter === "auto" &&
          index < tokenParameterSequence.length - 1 &&
          isUnsupportedTokenParameterError(responseBody, tokenParameter)
        ) {
          continue;
        }

        const providerMessage = extractProviderErrorMessage(responseBody);
        lastProviderError = new Error(
          `Azure OpenAI request failed (${response.status}${providerMessage ? `: ${providerMessage}` : ""}).`,
        );
        throw lastProviderError;
      }

      const assistantContent = extractAssistantContent(responseBody);
      const parsedStructuredPayload = parseStructuredPayload(assistantContent);

      return llmResponseSchema.parse(parsedStructuredPayload);
    }

    throw (
      lastProviderError ??
      new Error("Azure OpenAI request failed for all configured token parameter strategies.")
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Azure OpenAI request timed out after ${config.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function buildAzureOpenAiCompletionsUrl(config: AzureOpenAiRuntimeConfig): string {
  const trimmedEndpoint = config.endpoint.trim().replace(/\/+$/, "");
  if (!trimmedEndpoint) {
    throw new Error("Azure OpenAI endpoint is not configured.");
  }
  if (!config.deployment.trim()) {
    throw new Error("Azure OpenAI deployment is not configured.");
  }

  const encodedDeployment = encodeURIComponent(config.deployment.trim());
  const encodedApiVersion = encodeURIComponent(config.apiVersion.trim());
  return `${trimmedEndpoint}/openai/deployments/${encodedDeployment}/chat/completions?api-version=${encodedApiVersion}`;
}

function buildAzureOpenAiRequestBody(
  input: AssessmentContext,
  config: AzureOpenAiRuntimeConfig,
  tokenParameter: "max_tokens" | "max_completion_tokens",
): Record<string, unknown> {
  return {
    messages: buildAzureOpenAiMessages(input),
    temperature: config.temperature,
    [tokenParameter]: config.maxTokens,
    response_format: {
      type: "json_object",
    },
  };
}

function resolveTokenParameterSequence(
  preference: AzureOpenAiRuntimeConfig["tokenLimitParameter"],
): Array<"max_tokens" | "max_completion_tokens"> {
  if (preference === "max_tokens") {
    return ["max_tokens"];
  }
  if (preference === "max_completion_tokens") {
    return ["max_completion_tokens"];
  }
  return ["max_completion_tokens", "max_tokens"];
}

function buildAzureOpenAiMessages(input: AssessmentContext): Array<{ role: "system" | "user"; content: string }> {
  const systemPrompt = (input.promptTemplateSystem ?? "").trim() || DEFAULT_SYSTEM_PROMPT;
  const userPromptTemplate = (input.promptTemplateUserTemplate ?? "").trim();
  const passContext =
    input.assessmentPass === "secondary"
      ? "This is a secondary, independent assessment pass."
      : "This is the primary assessment pass.";
  const examplesJson = (input.promptTemplateExamplesJson ?? "").trim();

  const userSections = [
    "Assess the candidate submission and return one strict JSON object only.",
    passContext,
    REQUIRED_RESPONSE_CONTRACT,
    input.moduleTaskText ? `Participant assignment context:\n${input.moduleTaskText}` : null,
    input.moduleGuidanceText ? `Expected submission content context:\n${input.moduleGuidanceText}` : null,
    userPromptTemplate ? `Prompt template context:\n${userPromptTemplate}` : null,
    examplesJson ? `Prompt examples context (JSON):\n${examplesJson}` : null,
    `Module ID: ${input.moduleId}`,
    `Candidate practical answer:\n${input.rawText}`,
    `Candidate reflection:\n${input.reflectionText}`,
    `Candidate prompt excerpt:\n${input.promptExcerpt}`,
  ].filter((value): value is string => Boolean(value));

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userSections.join("\n\n") },
  ];
}

function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Azure OpenAI returned a non-JSON response.");
  }
}

function extractProviderErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidate = payload as { error?: { message?: unknown } };
  return typeof candidate.error?.message === "string" ? candidate.error.message : "";
}

function isUnsupportedTokenParameterError(
  payload: unknown,
  tokenParameter: "max_tokens" | "max_completion_tokens",
): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as { error?: { code?: unknown; param?: unknown; message?: unknown } };
  const code = typeof candidate.error?.code === "string" ? candidate.error.code : "";
  const param = typeof candidate.error?.param === "string" ? candidate.error.param : "";
  const message = typeof candidate.error?.message === "string" ? candidate.error.message : "";

  if (code !== "unsupported_parameter") {
    return false;
  }

  return param === tokenParameter || message.toLowerCase().includes(tokenParameter);
}

function extractAssistantContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Azure OpenAI completion payload is missing.");
  }

  const candidate = payload as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  const firstContent = candidate.choices?.[0]?.message?.content;
  if (typeof firstContent === "string" && firstContent.trim().length > 0) {
    return firstContent;
  }

  if (Array.isArray(firstContent)) {
    const joined = firstContent
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object" && "text" in entry && typeof entry.text === "string") {
          return entry.text;
        }
        return "";
      })
      .join("\n")
      .trim();

    if (joined.length > 0) {
      return joined;
    }
  }

  throw new Error("Azure OpenAI response does not include assistant content.");
}

function parseStructuredPayload(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Azure OpenAI returned empty assistant content.");
  }

  const unfenced = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidateJson = unfenced.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidateJson);
      } catch {
        // Fall through to final error.
      }
    }

    throw new Error("Azure OpenAI did not return parseable JSON content.");
  }
}

const DEFAULT_SYSTEM_PROMPT = "You are an assessment assistant. Return strict JSON only.";

const REQUIRED_RESPONSE_CONTRACT = `
JSON response contract:
- module_id: string
- rubric_scores: object with integer values 0..4 for:
  - relevance_for_case
  - quality_and_utility
  - iteration_and_improvement
  - human_quality_assurance
  - responsible_use
- rubric_total: integer 0..20 and equal to sum of rubric_scores
- practical_score_scaled: number 0..70
- pass_fail_practical: boolean
- criterion_rationales: object with one concise string rationale per rubric criterion key
- improvement_advice: array of up to 10 concise strings
- red_flags: array of objects with fields: code (string), severity (string), description (string)
- manual_review_recommended: boolean
- confidence_note: string
Do not include markdown, comments, or any wrapper text outside JSON.
`.trim();
