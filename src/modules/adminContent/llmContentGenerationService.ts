import { z } from "zod";
import { env } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CertificationLevel = "basic" | "intermediate" | "advanced";
export type GenerationLocale = "en-GB" | "nb" | "nn";

export type ModuleDraftInput = {
  sourceMaterial: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
};

export type ModuleDraftResult = {
  taskText: string;
  guidanceText: string;
  includesScenario: boolean;
};

export type McqGenerationInput = {
  sourceMaterial: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
  questionCount: number;
};

export type GeneratedMcqQuestion = {
  stem: string;
  options: string[];
  correctAnswer: string;
  rationale: string;
};

export type McqGenerationResult = {
  questions: GeneratedMcqQuestion[];
};

// ---------------------------------------------------------------------------
// Response codecs
// ---------------------------------------------------------------------------

const moduleDraftResponseCodec = z.object({
  taskText: z.string().min(1),
  guidanceText: z.string().min(1),
  includesScenario: z.boolean(),
});

const mcqGenerationResponseCodec = z.object({
  questions: z
    .array(
      z.object({
        stem: z.string().min(1),
        options: z.array(z.string().min(1)).min(2).max(6),
        correctAnswer: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCALE_DISPLAY: Record<GenerationLocale, string> = {
  "en-GB": "British English",
  nb: "Norwegian Bokmål",
  nn: "Norwegian Nynorsk",
};

const DISTRACTOR_GUIDELINES: Record<CertificationLevel, string> = {
  basic:
    "Distractors may be clearly incorrect but must be thematically related to the domain. The goal is basic recognition.",
  intermediate:
    "Distractors must be plausible misconceptions or near-misses that a partially informed candidate might choose. Avoid obviously absurd or unrelated options.",
  advanced:
    "Distractors must represent common expert-level confusions, subtle definitional errors, or claims that are correct in a different context but wrong here. A well-prepared candidate should have to think carefully.",
};

function buildUrl(): string {
  const endpoint = (env.AZURE_OPENAI_ENDPOINT ?? "").trim().replace(/\/+$/, "");
  const deployment = env.AZURE_OPENAI_DEPLOYMENT ?? "";
  const apiVersion = env.AZURE_OPENAI_API_VERSION;
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

async function callLlm(systemPrompt: string, userPrompt: string): Promise<unknown> {
  if (env.LLM_MODE !== "azure_openai") {
    throw new Error("LLM content generation requires LLM_MODE=azure_openai.");
  }

  const url = buildUrl();
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_completion_tokens: 4000,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.AZURE_OPENAI_API_KEY ?? "",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Azure OpenAI generation failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const unfenced = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    throw new Error(`LLM returned non-JSON content: ${unfenced.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Module draft generation (#245)
// ---------------------------------------------------------------------------

export async function generateModuleDraft(input: ModuleDraftInput): Promise<ModuleDraftResult> {
  const systemPrompt =
    "You are a module content author for a professional certification platform. Return strict JSON only — no markdown, no commentary.";

  const userPrompt = `Generate task text and guidance text for a certification module based on the source material below.

Certification level: ${input.certificationLevel}
Language: ${LOCALE_DISPLAY[input.locale]}

## Scenario decision

A scenario is a short, realistic situation (4–8 sentences) that grounds the task in a concrete context.

Include a scenario in taskText when:
- The module assesses situational analysis, ethical reasoning, professional judgement, or practical application of concepts
- A concrete situation would let candidates demonstrate understanding beyond pure recall
- The source material describes theory, frameworks, or principles that naturally apply to real situations

Do NOT include a scenario when:
- The task is primarily factual recall or text summarisation
- The source material is itself the object of the task (e.g. "summarise this text")
- A scenario would feel artificial or forced given the content

If including a scenario:
- Place it at the very top of taskText, clearly labelled "Scenario:" followed by a blank line
- Keep it realistic, concise (4–8 sentences), and directly grounded in the source material
- The task instruction below the scenario must explicitly tell the candidate to use it as the basis for their response

## Source material

${input.sourceMaterial}

## Return format

Return a single JSON object:
{
  "taskText": "full task text in ${LOCALE_DISPLAY[input.locale]}, including scenario at top if appropriate",
  "guidanceText": "guidance for what a strong response contains, in ${LOCALE_DISPLAY[input.locale]}",
  "includesScenario": true or false
}`;

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = moduleDraftResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Module draft LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// MCQ generation (#246)
// ---------------------------------------------------------------------------

export async function generateMcqQuestions(input: McqGenerationInput): Promise<McqGenerationResult> {
  const systemPrompt =
    "You are an MCQ question author for a professional certification platform. Return strict JSON only — no markdown, no commentary.";

  const userPrompt = `Generate ${input.questionCount} multiple-choice questions based on the source material below.

Certification level: ${input.certificationLevel}
Language: ${LOCALE_DISPLAY[input.locale]}

## Distractor quality

${DISTRACTOR_GUIDELINES[input.certificationLevel]}

Each question must have exactly 4 answer options. The correctAnswer must be one of the options verbatim.
Write all text in ${LOCALE_DISPLAY[input.locale]}.

## Source material

${input.sourceMaterial}

## Return format

Return a single JSON object:
{
  "questions": [
    {
      "stem": "question text",
      "options": ["option A", "option B", "option C", "option D"],
      "correctAnswer": "option A",
      "rationale": "brief explanation of why the correct answer is right and why the distractors are wrong"
    }
  ]
}`;

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = mcqGenerationResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`MCQ generation LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}
