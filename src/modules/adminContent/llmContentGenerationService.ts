import { z } from "zod";
import { env } from "../../config/env.js";
import type { LocalizedText } from "../../codecs/localizedTextCodec.js";

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

export type ModuleDraftRevisionInput = {
  taskText: string;
  guidanceText: string;
  instruction: string;
  locale: GenerationLocale;
};

export type McqGenerationInput = {
  sourceMaterial: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
  questionCount: number;
  optionCount: number;
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

export type RevisableMcqQuestion = {
  stem: LocalizedText;
  options: LocalizedText[];
  correctAnswer: LocalizedText;
  rationale?: LocalizedText;
};

export type McqRevisionInput = {
  questions: RevisableMcqQuestion[];
  instruction: string;
  locale: GenerationLocale;
  questionCount?: number;
  optionCount?: number;
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

export function buildModuleDraftPrompts(input: ModuleDraftInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a module content author for a professional certification platform. Return strict JSON only - no markdown, no commentary.";

  const userPrompt = `Generate task text and guidance text for a certification module using the source material below as hidden author background only.

Certification level: ${input.certificationLevel}
Language: ${LOCALE_DISPLAY[input.locale]}

## Authoring constraints

- The source material is for you only. The candidate will NOT see it.
- Write taskText and guidanceText so they are fully self-contained and usable on their own.
- Do not mention "source material", "the text above", "the material", "the document", "the attachment", or equivalent wording.
- Do not tell the candidate to read, review, use, cite, or refer to any unseen material.
- Any facts, context, terminology, or scenario details needed by the candidate must be embedded directly in the generated task itself.

## Scenario decision

A scenario is a short, realistic situation (4-8 sentences) that grounds the task in a concrete context.

Include a scenario in taskText when:
- The module assesses situational analysis, ethical reasoning, professional judgement, or practical application of concepts
- A concrete situation would let candidates demonstrate understanding beyond pure recall
- The source material describes theory, frameworks, or principles that naturally apply to real situations

Do NOT include a scenario when:
- The task is primarily factual recall or text summarisation
- The source material is itself the object of the task
- A scenario would feel artificial or forced given the content

If including a scenario:
- Place it at the very top of taskText, clearly labelled "Scenario:" followed by a blank line
- Keep it realistic, concise (4-8 sentences), and grounded in the facts from the source material without referring to that material
- The task instruction below the scenario must direct the candidate to use the scenario as the basis for their response

## Source material (hidden author background)

${input.sourceMaterial}

## Return format

Return a single JSON object:
{
  "taskText": "full task text in ${LOCALE_DISPLAY[input.locale]}, including scenario at top if appropriate",
  "guidanceText": "guidance for what a strong response contains, in ${LOCALE_DISPLAY[input.locale]}",
  "includesScenario": true or false
}`;

  return { systemPrompt, userPrompt };
}

export function buildMcqGenerationPrompts(input: McqGenerationInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are an MCQ question author for a professional certification platform. Return strict JSON only - no markdown, no commentary.";

  const userPrompt = `Generate ${input.questionCount} multiple-choice questions using the source material below as hidden author background only.

Certification level: ${input.certificationLevel}
Language: ${LOCALE_DISPLAY[input.locale]}

## Authoring constraints

- The source material is for you only. The candidate will NOT see it.
- Each question must be self-contained and understandable without any external text.
- Do not mention "source material", "text above", "document", "attachment", or any unseen reference material.
- Do not write stems, options, or rationales that assume the candidate can inspect the hidden source material.
- If background facts are needed, incorporate them directly into the question stem.

## Distractor quality

${DISTRACTOR_GUIDELINES[input.certificationLevel]}

## Option parity

All 4 options in a question must be comparable in length and level of detail. This is critical: a candidate should not be able to identify the correct answer by noticing that one option is longer, more specific, or more qualified than the others.

Rules:
- Write all options at the same level of specificity — if the correct answer contains a qualifier or clause, the distractors must too.
- If the correct answer is a short phrase, keep all options short. If it is a full sentence, make all options full sentences of similar length.
- Never pad distractors with vague filler words just to match length; instead, write distractors that are substantively comparable but wrong.
- Review each set of 4 options before finalising: if any single option stands out in length or detail, rewrite it.

Each question must have exactly ${input.optionCount} answer options. The correctAnswer must be one of the options verbatim.
Write all text in ${LOCALE_DISPLAY[input.locale]}.

## Source material (hidden author background)

${input.sourceMaterial}

## Return format

Return a single JSON object:
{
  "questions": [
    {
      "stem": "question text",
      "options": ["option 1", "option 2", "option 3"],
      "correctAnswer": "option 1",
      "rationale": "brief explanation of why the correct answer is right and why the distractors are wrong"
    }
  ]
}`;

  return { systemPrompt, userPrompt };
}

export function buildModuleDraftRevisionPrompts(input: ModuleDraftRevisionInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a module content editor for a professional certification platform. Revise the provided draft based on the user's change request. Return strict JSON only - no markdown, no commentary.";

  const userPrompt = `Revise the following certification module draft based on the instruction below.

Language: ${LOCALE_DISPLAY[input.locale]}

## Revision rules

- Apply the requested change directly to the draft.
- Keep the output self-contained for candidates.
- Do not mention hidden source material or the editing process.
- Preserve the overall structure unless the instruction clearly asks for structural changes.
- If the task includes a scenario, keep it at the top of taskText labelled "Scenario:".

## Current draft

taskText:
${input.taskText}

guidanceText:
${input.guidanceText}

## Revision instruction

${input.instruction}

## Return format

Return a single JSON object:
{
  "taskText": "revised task text in ${LOCALE_DISPLAY[input.locale]}",
  "guidanceText": "revised guidance text in ${LOCALE_DISPLAY[input.locale]}",
  "includesScenario": true or false
}`;

  return { systemPrompt, userPrompt };
}

export function buildMcqRevisionPrompts(input: McqRevisionInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const questionCount = input.questionCount ?? input.questions.length;
  const optionCount = input.optionCount ?? Math.max(...input.questions.map((question) => question.options.length));
  const serializedQuestions = JSON.stringify(input.questions, null, 2);
  const systemPrompt =
    "You are an MCQ content editor for a professional certification platform. Revise the provided question set based on the user's change request. Return strict JSON only - no markdown, no commentary.";

  const userPrompt = `Revise the following multiple-choice questions based on the instruction below.

Language: ${LOCALE_DISPLAY[input.locale]}

## Revision rules

- Preserve the number of questions unless the instruction clearly asks for a different count.
- Preserve the number of answer options per question unless the instruction clearly asks for a different count.
- Keep each question self-contained and understandable without external context.
- The correctAnswer must match one of the options verbatim.
- Keep distractors comparable in length and level of detail to the correct answer.

Target question count: ${questionCount}
Target option count per question: ${optionCount}

## Current questions

${serializedQuestions}

## Revision instruction

${input.instruction}

## Return format

Return a single JSON object:
{
  "questions": [
    {
      "stem": "question text",
      "options": ["option 1", "option 2", "option 3"],
      "correctAnswer": "option 1",
      "rationale": "brief explanation"
    }
  ]
}`;

  return { systemPrompt, userPrompt };
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
  const { systemPrompt, userPrompt } = buildModuleDraftPrompts(input);

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
  const { systemPrompt, userPrompt } = buildMcqGenerationPrompts(input);

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = mcqGenerationResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`MCQ generation LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

export async function reviseModuleDraft(input: ModuleDraftRevisionInput): Promise<ModuleDraftResult> {
  const { systemPrompt, userPrompt } = buildModuleDraftRevisionPrompts(input);

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = moduleDraftResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Module draft revision LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

export async function reviseMcqQuestions(input: McqRevisionInput): Promise<McqGenerationResult> {
  const { systemPrompt, userPrompt } = buildMcqRevisionPrompts(input);

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = mcqGenerationResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`MCQ revision LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}
