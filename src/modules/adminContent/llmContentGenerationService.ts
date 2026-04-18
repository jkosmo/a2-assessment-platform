import { z } from "zod";
import { env } from "../../config/env.js";
import type { LocalizedText } from "../../codecs/localizedTextCodec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CertificationLevel = "basic" | "intermediate" | "advanced";
export type GenerationLocale = "en-GB" | "nb" | "nn";
export type GenerationMode = "ordinary" | "thorough";

export type ModuleDraftInput = {
  sourceMaterial: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
  generationMode: GenerationMode;
};

export type ModuleDraftResult = {
  taskText: string;
  guidanceText: string;
  title?: string;
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
  generationMode: GenerationMode;
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

export type ModuleDraftLocalizationInput = {
  taskText: string;
  guidanceText: string;
  title?: string;
  sourceLocale: GenerationLocale;
  targetLocale: GenerationLocale;
};

export type McqLocalizationQuestion = {
  stem: string;
  options: string[];
  correctAnswer: string;
  rationale: string;
};

export type McqLocalizationInput = {
  questions: McqLocalizationQuestion[];
  sourceLocale: GenerationLocale;
  targetLocale: GenerationLocale;
};

// ---------------------------------------------------------------------------
// Response codecs
// ---------------------------------------------------------------------------

const moduleDraftResponseCodec = z.object({
  taskText: z.string().min(1),
  guidanceText: z.string().min(1),
  title: z.string().min(1).optional(),
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

const MODULE_DRAFT_LEVEL_GUIDELINES: Record<CertificationLevel, string> = {
  basic:
    "Keep the task approachable. Use plain language, a single clear situation when a scenario is needed, and avoid layered tensions or multiple competing sub-problems. guidanceText must stay high-level and candidate-safe: describe qualities of a strong answer without giving the candidate a near-complete answer outline.",
  intermediate:
    "Aim for moderate complexity. The task may include one realistic tension or trade-off, but it must still be easy to parse on first read. guidanceText should indicate what good reasoning looks like without turning into a checklist the candidate can copy directly.",
  advanced:
    "Use a more demanding but still readable task. It may involve ambiguity, competing considerations, or nuanced application, but avoid unnecessary complication for its own sake. guidanceText must support high-quality responses without functioning as an answer key or revealing every major point the candidate should make.",
};

const MCQ_LEVEL_GUIDELINES: Record<CertificationLevel, string> = {
  basic:
    "Questions should test core recognition and basic understanding. Keep stems direct, avoid trick wording, and prefer distractors that are related but still clearly distinguishable to a prepared beginner.",
  intermediate:
    "Questions should test applied understanding. Use plausible distractors, but keep the stem readable and avoid stacking too many conditions into a single item.",
  advanced:
    "Questions should test nuanced understanding and discrimination. The correct answer must not stand out stylistically, and at least one distractor should be close enough that the candidate must reason carefully before choosing.",
};

const GENERATION_MODE_GUIDELINES: Record<GenerationMode, { moduleDraft: string; mcq: string }> = {
  ordinary: {
    moduleDraft:
      "Prefer a strong first-pass draft: keep the scenario realistic and self-contained, but avoid over-elaborating the situation or adding unnecessary sub-questions.",
    mcq:
      "Prefer a balanced first-pass question set: keep stems concise, ensure the level is appropriate, and avoid adding extra complexity unless it clearly improves assessment quality.",
  },
  thorough: {
    moduleDraft:
      "Take a more thorough authoring pass: improve clarity, realism and polish, but do not make the task harder just because this is a deeper pass. Use the chosen certification level to decide difficulty.",
    mcq:
      "Take a more thorough authoring pass: make stems precise, ensure distractors are substantively plausible, and improve coverage and rationale quality without automatically increasing difficulty beyond the chosen certification level.",
  },
};

function localizeForPrompt(value: LocalizedText | undefined, locale: GenerationLocale): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value.nb ?? value["en-GB"] ?? value.nn ?? Object.values(value)[0] ?? "";
}

function buildIndexedMcqPreview(questions: RevisableMcqQuestion[], locale: GenerationLocale): string {
  return questions
    .map((question, questionIndex) => {
      const optionLines = (question.options ?? [])
        .map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${localizeForPrompt(option, locale)}`)
        .join("\n");

      return [
        `Question ${questionIndex + 1}`,
        `Stem: ${localizeForPrompt(question.stem, locale)}`,
        "Options:",
        optionLines,
        `Correct answer: ${localizeForPrompt(question.correctAnswer, locale)}`,
        `Rationale: ${localizeForPrompt(question.rationale, locale)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function normalizeGeneratedMcqQuestions(questions: GeneratedMcqQuestion[]): string {
  return JSON.stringify(
    questions.map((question) => ({
      stem: question.stem.trim(),
      options: question.options.map((option) => option.trim()),
      correctAnswer: question.correctAnswer.trim(),
      rationale: question.rationale.trim(),
    })),
  );
}

function normalizeMcqTextForComparison(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tokenizeMcqText(value: string | undefined): string[] {
  return normalizeMcqTextForComparison(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function calculateTokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) shared += 1;
  }
  return shared / Math.max(leftSet.size, rightSet.size, 1);
}

function countExtraTokens(base: string[], candidate: string[]): number {
  const baseSet = new Set(base);
  return candidate.filter((token) => !baseSet.has(token)).length;
}

function isTokenSubset(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.every((token) => rightSet.has(token));
}

function isSubstantivelyDifferentText(source: string | undefined, revised: string | undefined): boolean {
  const normalizedSource = normalizeMcqTextForComparison(source);
  const normalizedRevised = normalizeMcqTextForComparison(revised);
  if (!normalizedSource || !normalizedRevised) {
    return normalizedSource !== normalizedRevised;
  }
  if (normalizedSource === normalizedRevised) {
    return false;
  }

  const sourceTokens = tokenizeMcqText(normalizedSource);
  const revisedTokens = tokenizeMcqText(normalizedRevised);
  const tokenOverlap = calculateTokenOverlap(sourceTokens, revisedTokens);
  const charDelta = Math.abs(normalizedSource.length - normalizedRevised.length);
  const sourceContainsRevised = normalizedSource.includes(normalizedRevised);
  const revisedContainsSource = normalizedRevised.includes(normalizedSource);
  const sourceTokensSubsetOfRevised = isTokenSubset(sourceTokens, revisedTokens);
  const revisedTokensSubsetOfSource = isTokenSubset(revisedTokens, sourceTokens);
  const extraTokenCount = revisedContainsSource
    ? countExtraTokens(sourceTokens, revisedTokens)
    : sourceContainsRevised
      ? countExtraTokens(revisedTokens, sourceTokens)
      : Number.POSITIVE_INFINITY;

  if (
    tokenOverlap >= 0.85 &&
    (sourceContainsRevised || revisedContainsSource)
  ) {
    return false;
  }

  if ((sourceContainsRevised || revisedContainsSource) && extraTokenCount <= 2) {
    return false;
  }

  if (
    (sourceTokensSubsetOfRevised && countExtraTokens(sourceTokens, revisedTokens) <= 2) ||
    (revisedTokensSubsetOfSource && countExtraTokens(revisedTokens, sourceTokens) <= 2)
  ) {
    return false;
  }

  if (tokenOverlap >= 0.9 && charDelta <= 12) {
    return false;
  }

  return true;
}

export type McqRevisionTarget = {
  questionIndex: number;
  optionIndex: number | null;
};

export function extractMcqRevisionTargets(instruction: string): McqRevisionTarget[] {
  const normalized = String(instruction ?? "").toLowerCase();
  const targets: McqRevisionTarget[] = [];
  const seen = new Set<string>();

  const pushTarget = (questionIndex: number | null, optionIndex: number | null) => {
    if (!Number.isInteger(questionIndex) || questionIndex === null || questionIndex < 0) {
      return;
    }
    if (optionIndex === null) {
      for (const existing of targets) {
        if (existing.questionIndex === questionIndex && existing.optionIndex !== null) {
          return;
        }
      }
    }
    const key = `${questionIndex}:${optionIndex ?? "q"}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ questionIndex, optionIndex });
  };

  for (const match of normalized.matchAll(/\b(?:option|alternativ|answer)\s*([a-f])\s*(?:i|in)?\s*(?:question|q|spørsmål|sporsmal)\s*(\d+)\b/gi)) {
    const optionIndex = match[1].charCodeAt(0) - 97;
    const questionIndex = Number.parseInt(match[2] ?? "", 10) - 1;
    pushTarget(questionIndex, optionIndex);
  }

  for (const match of normalized.matchAll(/\b(\d+)\s*([a-f])\b/gi)) {
    const questionIndex = Number.parseInt(match[1] ?? "", 10) - 1;
    const optionIndex = match[2].charCodeAt(0) - 97;
    pushTarget(questionIndex, optionIndex);
  }

  for (const match of normalized.matchAll(/\b(?:question|q|spørsmål|sporsmal)\s*(\d+)\b/gi)) {
    const questionIndex = Number.parseInt(match[1] ?? "", 10) - 1;
    pushTarget(questionIndex, null);
  }

  return targets;
}

function hasTargetedMcqChange(
  sourceQuestions: GeneratedMcqQuestion[],
  revisedQuestions: GeneratedMcqQuestion[],
  target: McqRevisionTarget,
): boolean {
  const sourceQuestion = sourceQuestions[target.questionIndex];
  const revisedQuestion = revisedQuestions[target.questionIndex];
  if (!sourceQuestion || !revisedQuestion) {
    return false;
  }

  if (target.optionIndex !== null) {
    const sourceOption = sourceQuestion.options[target.optionIndex];
    const revisedOption = revisedQuestion.options[target.optionIndex];
    if (sourceOption === undefined || revisedOption === undefined) {
      return false;
    }
    return isSubstantivelyDifferentText(sourceOption, revisedOption);
  }

  return (
    isSubstantivelyDifferentText(sourceQuestion.stem, revisedQuestion.stem) ||
    isSubstantivelyDifferentText(sourceQuestion.correctAnswer, revisedQuestion.correctAnswer) ||
    isSubstantivelyDifferentText(sourceQuestion.rationale, revisedQuestion.rationale) ||
    sourceQuestion.options.length !== revisedQuestion.options.length ||
    sourceQuestion.options.some((option, index) => {
      const revisedOption = revisedQuestion.options[index];
      return isSubstantivelyDifferentText(option, revisedOption);
    })
  );
}

export function hasMeaningfulMcqRevision(
  sourceQuestions: GeneratedMcqQuestion[],
  revisedQuestions: GeneratedMcqQuestion[],
  instruction: string,
): boolean {
  const sourceSignature = normalizeGeneratedMcqQuestions(sourceQuestions);
  const revisedSignature = normalizeGeneratedMcqQuestions(revisedQuestions);
  if (sourceSignature === revisedSignature) {
    return false;
  }

  const explicitTargets = extractMcqRevisionTargets(instruction);
  if (explicitTargets.length === 0) {
    return true;
  }

  return explicitTargets.every((target) => hasTargetedMcqChange(sourceQuestions, revisedQuestions, target));
}

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
Generation mode: ${input.generationMode}

## Authoring constraints

- The source material is for you only. The candidate will NOT see it.
- Write taskText and guidanceText so they are fully self-contained and usable on their own.
- Do not mention "source material", "the text above", "the material", "the document", "the attachment", or equivalent wording.
- Do not tell the candidate to read, review, use, cite, or refer to any unseen material.
- Any facts, context, terminology, or scenario details needed by the candidate must be embedded directly in the generated task itself.
- Use the certification level as the primary difficulty control.
- ${MODULE_DRAFT_LEVEL_GUIDELINES[input.certificationLevel]}
- ${GENERATION_MODE_GUIDELINES[input.generationMode].moduleDraft}
- guidanceText is candidate-facing support, not assessor notes and not an answer key.
- guidanceText must stay shorter and less specific than a marking rubric.
- Describe what characterises a strong response at a high level; do not enumerate every concrete point the candidate should include.

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
Generation mode: ${input.generationMode}

## Authoring constraints

- The source material is for you only. The candidate will NOT see it.
- Each question must be self-contained and understandable without any external text.
- Do not mention "source material", "text above", "document", "attachment", or any unseen reference material.
- Do not write stems, options, or rationales that assume the candidate can inspect the hidden source material.
- If background facts are needed, incorporate them directly into the question stem.

## Distractor quality

${DISTRACTOR_GUIDELINES[input.certificationLevel]}
${MCQ_LEVEL_GUIDELINES[input.certificationLevel]}
${GENERATION_MODE_GUIDELINES[input.generationMode].mcq}

## Option parity

All ${input.optionCount} options in a question must be comparable in length and level of detail. This is critical: a candidate should not be able to identify the correct answer by noticing that one option is longer, more specific, or more qualified than the others.

Rules:
- Write all options at the same level of specificity — if the correct answer contains a qualifier or clause, the distractors must too.
- If the correct answer is a short phrase, keep all options short. If it is a full sentence, make all options full sentences of similar length.
- Never pad distractors with vague filler words just to match length; instead, write distractors that are substantively comparable but wrong.
- Review each set of ${input.optionCount} options before finalising: if any single option stands out in length or detail, rewrite it.
- Avoid obviously wrong distractors, joke answers, or options that are noticeably more generic than the correct answer.
- At intermediate and advanced levels, ensure at least one distractor is close enough to require real discrimination.

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
  const indexedQuestions = buildIndexedMcqPreview(input.questions, input.locale);
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
- If the instruction points to a specific question or option reference such as "question 3", "Q3", "3b", "option B in question 3", or "third alternative in question 3", apply the change to that exact target.
- When the instruction asks for a local change to one option, one question, or one rationale, keep the rest of the question set unchanged unless a broader rewrite is explicitly requested.
- The revised output must contain a concrete, material change that satisfies the instruction. Do not return the original wording unchanged.
- A local revision must be substantively different, not just a cosmetic rephrasing or a minor wording tweak.

Target question count: ${questionCount}
Target option count per question: ${optionCount}

## Current questions (indexed review view)

${indexedQuestions}

## Current questions (JSON source of truth)

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

export function buildModuleDraftLocalizationPrompts(input: ModuleDraftLocalizationInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a professional translator for a certification platform. Translate the provided module draft faithfully and return strict JSON only - no markdown, no commentary.";

  const titleSection = input.title
    ? `\ntitle:\n${input.title}\n`
    : "";

  const titleReturnField = input.title
    ? `\n  "title": "translated title in ${LOCALE_DISPLAY[input.targetLocale]}",`
    : "";

  const userPrompt = `Translate the following certification module draft from ${LOCALE_DISPLAY[input.sourceLocale]} to ${LOCALE_DISPLAY[input.targetLocale]}.

## Translation rules

- Preserve meaning, structure, tone and difficulty.
- Keep the content fully self-contained for candidates.
- If taskText starts with "Scenario:", preserve that label in the target language.
- Do not add or remove assessment requirements.
- Do not summarise.

## Source draft
${titleSection}
taskText:
${input.taskText}

guidanceText:
${input.guidanceText}

## Return format

Return a single JSON object:
{${titleReturnField}
  "taskText": "translated task text in ${LOCALE_DISPLAY[input.targetLocale]}",
  "guidanceText": "translated guidance text in ${LOCALE_DISPLAY[input.targetLocale]}",
  "includesScenario": true or false
}`;

  return { systemPrompt, userPrompt };
}

export function buildMcqLocalizationPrompts(input: McqLocalizationInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a professional translator for a certification platform. Translate the provided MCQ set faithfully and return strict JSON only - no markdown, no commentary.";

  const serializedQuestions = JSON.stringify(input.questions, null, 2);
  const userPrompt = `Translate the following multiple-choice questions from ${LOCALE_DISPLAY[input.sourceLocale]} to ${LOCALE_DISPLAY[input.targetLocale]}.

## Translation rules

- Preserve meaning, difficulty, structure and question count.
- Preserve the number of answer options for each question.
- Keep each question self-contained.
- correctAnswer must match one of the translated options verbatim.
- Translate rationale as well.
- Do not add or remove questions or options.

## Source questions

${serializedQuestions}

## Return format

Return a single JSON object:
{
  "questions": [
    {
      "stem": "translated question text",
      "options": ["translated option 1", "translated option 2"],
      "correctAnswer": "one of the translated options verbatim",
      "rationale": "translated rationale"
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

  const parseRevision = async (promptText: string) => {
    const raw = await callLlm(systemPrompt, promptText);
    const parsed = mcqGenerationResponseCodec.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`MCQ revision LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
    }
    return parsed.data;
  };

  const sourceQuestions: GeneratedMcqQuestion[] = input.questions.map((question) => ({
    stem: localizeForPrompt(question.stem, input.locale),
    options: (question.options ?? []).map((option) => localizeForPrompt(option, input.locale)),
    correctAnswer: localizeForPrompt(question.correctAnswer, input.locale),
    rationale: localizeForPrompt(question.rationale, input.locale),
  }));
  const firstAttempt = await parseRevision(userPrompt);
  if (hasMeaningfulMcqRevision(sourceQuestions, firstAttempt.questions, input.instruction)) {
    return firstAttempt;
  }

  const retryPrompt = `${userPrompt}

## Retry rule

Your previous attempt did not apply the requested change concretely enough.
If the instruction names a specific question or option reference such as "question 3", "Q3", "3b", or "option B in question 3", you must change that exact target in a clearly visible way.
Return a revised question set where the requested change is concrete, visible, and materially different from the source questions.`;
  const secondAttempt = await parseRevision(retryPrompt);
  if (!hasMeaningfulMcqRevision(sourceQuestions, secondAttempt.questions, input.instruction)) {
    throw new Error("MCQ revision did not produce a material change. Please request a more specific change and try again.");
  }

  return secondAttempt;
}

export async function localizeModuleDraft(input: ModuleDraftLocalizationInput): Promise<ModuleDraftResult> {
  const { systemPrompt, userPrompt } = buildModuleDraftLocalizationPrompts(input);

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = moduleDraftResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Module draft localization failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

export async function localizeMcqQuestions(input: McqLocalizationInput): Promise<McqGenerationResult> {
  const { systemPrompt, userPrompt } = buildMcqLocalizationPrompts(input);

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = mcqGenerationResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`MCQ localization failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}
