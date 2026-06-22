import { z } from "zod";
import { env } from "../../config/env.js";
import type { LocalizedText } from "../../codecs/localizedTextCodec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CertificationLevel = "basic" | "intermediate" | "advanced";
export type GenerationLocale = "en-GB" | "nb" | "nn";
export type GenerationMode = "ordinary" | "thorough";

// v1.2.8: scenarioMode lets the author choose whether the generated task uses a scenario.
// "auto" keeps the legacy LLM-decides behaviour; "include" forces a scenario; "exclude"
// suppresses scenario framing.
export type ScenarioMode = "auto" | "include" | "exclude";

export type ModuleDraftInput = {
  sourceMaterial: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
  generationMode: GenerationMode;
  // When provided, the blueprint's learning objectives + complexityBudget constrain the
  // generated scenario so that scope, actor count, and trade-off count match the contract
  // also applied to MCQ generation. See #372.
  blueprint?: AssessmentBlueprint;
  scenarioMode?: ScenarioMode;
};

export type ModuleDraftResult = {
  taskText: string;
  assessorExpectedContent: string;
  candidateTaskConstraints: string;
  title?: string;
  includesScenario: boolean;
};

export type ModuleDraftRevisionInput = {
  taskText: string;
  assessorExpectedContent: string;
  candidateTaskConstraints?: string;
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
  // When provided, the blueprint's learningObjectives, keyTopics, and mcqProfile constrain
  // question distribution across topics so the MCQ set covers the contract that the
  // scenario was also generated against. See #372.
  blueprint?: AssessmentBlueprint;
};

export type McqDistractorMetadata = {
  option: string;
  whyTempting: string;
  whyWrongUnderStem: string;
  wouldBeCorrectIf: string;
};

export type GeneratedMcqQuestion = {
  stem: string;
  options: string[];
  correctAnswer: string;
  rationale: string;
  distractorMetadata?: McqDistractorMetadata[];
  eliminationRisk?: "low" | "medium" | "high";
};

export type McqGenerationResult = {
  questions: GeneratedMcqQuestion[];
  validationWarnings?: string[];
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
  assessorExpectedContent: string;
  candidateTaskConstraints?: string;
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

export type CourseCopyLocalizationInput = {
  title?: string;
  description?: string;
  sourceLocale: GenerationLocale;
  targetLocale: GenerationLocale;
};

export type CourseCopyLocalizationResult = {
  title?: string;
  description?: string;
};

export type SectionLocalizationInput = {
  title?: string;
  bodyMarkdown?: string;
  sourceLocale: GenerationLocale;
  targetLocale: GenerationLocale;
};

export type SectionLocalizationResult = {
  title?: string;
  bodyMarkdown?: string;
};

export type BlueprintInput = {
  sourceMaterial: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
};

export type AssessmentBlueprint = {
  learningObjectives: string[];
  keyTopics: string[];
  complexityBudget: {
    actors: number;
    concepts: number;
    tradeoffs: number;
  };
  mcqProfile: {
    suggestedCount: number;
    topicDistribution: Record<string, number>;
  };
  notes: string;
};

export type ModuleRubricInput = {
  taskText: string;
  candidateTaskConstraints?: string;
  assessorExpectedContent: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
  blueprint?: AssessmentBlueprint;
};

export type ModuleRubricCriterion = {
  id: string;
  label: string;
  description: string;
  maxScore: number;
  candidateVisible: boolean;
};

export type ModuleRubric = {
  criteria: ModuleRubricCriterion[];
  generatedFromTask: boolean;
  assessorNotes: string;
};

// ---------------------------------------------------------------------------
// Response codecs
// ---------------------------------------------------------------------------

const moduleDraftResponseCodec = z.object({
  taskText: z.string().min(1),
  assessorExpectedContent: z.string().min(1),
  candidateTaskConstraints: z.string().default(""),
  title: z.string().min(1).optional(),
  includesScenario: z.boolean().default(false),
});

const mcqDistractorMetadataCodec = z.object({
  option: z.string(),
  whyTempting: z.string(),
  whyWrongUnderStem: z.string(),
  wouldBeCorrectIf: z.string(),
});

const mcqGenerationResponseCodec = z.object({
  questions: z
    .array(
      z.object({
        stem: z.string().min(1),
        options: z.array(z.string().min(1)).min(2).max(6),
        correctAnswer: z.string().min(1),
        rationale: z.string().min(1),
        distractorMetadata: z.array(mcqDistractorMetadataCodec).optional(),
        eliminationRisk: z.enum(["low", "medium", "high"]).optional(),
      }),
    )
    .min(1),
});

const courseCopyLocalizationResponseCodec = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
}).refine((value) => Boolean(value.title || value.description), {
  message: "At least one localized field is required.",
});

const sectionLocalizationResponseCodec = z.object({
  title: z.string().min(1).optional(),
  bodyMarkdown: z.string().optional(),
}).refine((value) => Boolean(value.title || value.bodyMarkdown), {
  message: "At least one localized field is required.",
});

const assessmentBlueprintResponseCodec = z.object({
  learningObjectives: z.array(z.string().min(1)).min(1),
  keyTopics: z.array(z.string().min(1)).min(1),
  complexityBudget: z.object({
    actors: z.number().int().nonnegative(),
    concepts: z.number().int().nonnegative(),
    tradeoffs: z.number().int().nonnegative(),
  }),
  mcqProfile: z.object({
    suggestedCount: z.number().int().min(1),
    topicDistribution: z.record(z.string(), z.number().min(0).max(1)),
  }),
  notes: z.string().default(""),
});

const moduleRubricResponseCodec = z.object({
  criteria: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().min(1),
        maxScore: z.number().int().min(1).max(10),
        candidateVisible: z.boolean().default(true),
      }),
    )
    .min(2)
    .max(8),
  generatedFromTask: z.boolean().default(true),
  assessorNotes: z.string().default(""),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCALE_DISPLAY: Record<GenerationLocale, string> = {
  "en-GB": "British English",
  nb: "Norwegian Bokmål",
  nn: "Norwegian Nynorsk",
};

// Strong language directive injected into every prompt that takes a locale. The LLM otherwise
// tends to mirror the source material's language, so the bare "Language: X" hint is not enough.
// See #444 — MCQ generated in English when source material was English even though locale=nb.
function buildLanguageEnforcementDirective(locale: GenerationLocale): string {
  const display = LOCALE_DISPLAY[locale];
  return `## CRITICAL LANGUAGE RULE — read before authoring anything

Every visible string in your response (task text, stems, options, rationales, labels, descriptions, notes) MUST be written in ${display}. This rule overrides any tendency to mirror the source material's language.

If the source material is in a different language than ${display}, translate the relevant concepts into ${display} rather than echoing the source language. Do not produce output in any language other than ${display} under any circumstance.`;
}

// Function-word lists used by detectDominantLanguage (#444). These are deliberately small and
// high-frequency so even a 50–100 word output has multiple hits. nb and nn share most common
// words, so the heuristic only distinguishes English vs Norwegian — not nb vs nn — which is
// sufficient for the failure mode we protect against (LLM outputs English when nb/nn was asked).
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "of", "to", "in", "is", "for", "with", "on", "that",
  "this", "by", "as", "be", "it", "are", "from", "or", "an", "at",
]);

const NORWEGIAN_FUNCTION_WORDS = new Set([
  "og", "å", "som", "er", "ikke", "ikkje", "for", "på", "av", "med",
  "det", "en", "ei", "et", "til", "i", "ved", "om", "kan", "skal",
]);

export type DominantLanguage = "english" | "norwegian" | "indeterminate";

export function detectDominantLanguage(text: string): DominantLanguage {
  if (!text || text.length < 50) return "indeterminate";
  const tokens = text.toLowerCase().match(/[a-zæøå]+/g) ?? [];
  if (tokens.length < 20) return "indeterminate";

  let english = 0;
  let norwegian = 0;
  for (const token of tokens) {
    if (ENGLISH_FUNCTION_WORDS.has(token)) english++;
    if (NORWEGIAN_FUNCTION_WORDS.has(token)) norwegian++;
  }

  // Require at least 3 hits and a 2x lead to declare a winner. Norwegian wins ties because
  // a handful of words ("for", "i") overlap with English and would otherwise tip toward English.
  if (Math.max(english, norwegian) < 3) return "indeterminate";
  if (english >= norwegian * 2 && english >= 3) return "english";
  if (norwegian >= english * 2 && norwegian >= 3) return "norwegian";
  return "indeterminate";
}

export function isLikelyWrongLocale(text: string, expectedLocale: GenerationLocale): boolean {
  const detected = detectDominantLanguage(text);
  if (detected === "indeterminate") return false;
  if (expectedLocale === "en-GB") return detected === "norwegian";
  return detected === "english";
}

const DISTRACTOR_GUIDELINES: Record<CertificationLevel, string> = {
  basic:
    "ALL options must be thematically plausible and relevant to the domain. A candidate with partial knowledge must pause before rejecting any option. Do not write throwaway distractors that are obviously wrong by category, length, or absurdity.",
  intermediate:
    "ALL options must be plausible to a partially informed candidate. Every incorrect option must reflect a realistic misconception, wrong priority, or near-correct principle. It must be defensible if one condition in the stem were changed. Eliminate any option a candidate could reject without domain reasoning.",
  advanced:
    "ALL options must be substantively plausible. Every distractor must represent a genuine expert-level confusion, subtle definitional error, or claim that is correct in a nearby but different context. The correct answer must not be identifiable by style, length, specificity, or qualifier patterns. A well-prepared candidate must reason carefully about each option.",
};

const MODULE_DRAFT_LEVEL_GUIDELINES: Record<CertificationLevel, string> = {
  basic:
    "Keep the task approachable. Use plain language, a single clear situation when a scenario is needed, and avoid layered tensions or multiple competing sub-problems. Maximum scenario complexity: 1 actor, 0 trade-offs, 2 required concepts. Expected answer: 100–200 words, 10 minutes.",
  intermediate:
    "Aim for moderate complexity. The task may include one realistic tension or trade-off, but it must still be easy to parse on first read. Maximum scenario complexity: 2 actors, 1 trade-off, 3 required concepts. Expected answer: 250–450 words, 20 minutes.",
  advanced:
    "Use a more demanding but still readable task. It may involve ambiguity, competing considerations, or nuanced application, but avoid unnecessary complication for its own sake. Maximum scenario complexity: 3 actors, 2 trade-offs, 4 required concepts. Expected answer: 400–700 words, 30 minutes.",
};

export const COMPLEXITY_BUDGET: Record<
  CertificationLevel,
  { actorsMax: number; conceptsMax: number; tradeoffsMax: number; minWords: number; maxWords: number; timeBudgetMinutes: number }
> = {
  basic:        { actorsMax: 1, conceptsMax: 2, tradeoffsMax: 0, minWords: 100, maxWords: 200, timeBudgetMinutes: 10 },
  intermediate: { actorsMax: 2, conceptsMax: 3, tradeoffsMax: 1, minWords: 250, maxWords: 450, timeBudgetMinutes: 20 },
  advanced:     { actorsMax: 3, conceptsMax: 4, tradeoffsMax: 2, minWords: 400, maxWords: 700, timeBudgetMinutes: 30 },
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

// v1.2.8: scenario decision can be author-locked. "auto" preserves the legacy LLM-decides
// flow; "include" requires a scenario; "exclude" forbids one. Same three-state contract is
// used by the client-side external-LLM prompt (admin-content-external-llm.js) — keep the
// directives semantically aligned across both prompts so author intent survives the handoff.
function renderScenarioDirective(scenarioMode: ScenarioMode): string {
  if (scenarioMode === "include") {
    return `## Scenario (required)

The author has decided this module MUST include a scenario. Produce one.

A scenario is a short, realistic situation (4-8 sentences) that grounds the task in a concrete context.

- Place it at the very top of taskText, clearly labelled "Scenario:" followed by a blank line
- Keep it realistic, concise (4-8 sentences), and grounded in the facts from the source material without referring to that material
- The task instruction below the scenario must direct the candidate to use the scenario as the basis for their response`;
  }
  if (scenarioMode === "exclude") {
    return `## Scenario (forbidden)

The author has decided this module must NOT include a scenario.

- Do NOT include a scenario, situation, case description, or roleplay framing in taskText
- Do NOT start taskText with "Scenario:" or any similar narrative opener
- Write taskText as a direct task or question to the candidate, grounded in the relevant facts and concepts from the source material but without a constructed situation
- Keep the task clear and concrete; if context is needed to make the task self-contained, integrate it as a single short statement rather than as a multi-sentence scenario`;
  }
  return `## Scenario decision

A scenario is a short, realistic situation (4-8 sentences) that grounds the task in a concrete context.

Include a scenario in taskText when:
- The module assesses situational analysis, ethical reasoning, professional judgement, or practical application of concepts
- A concrete situation would let candidates demonstrate understanding beyond pure recall

Do NOT include a scenario when:
- The task is primarily factual recall or text summarisation
- A scenario would feel artificial or forced given the content

If including a scenario:
- Place it at the very top of taskText, clearly labelled "Scenario:" followed by a blank line
- Keep it realistic, concise (4-8 sentences), and grounded in the facts from the source material without referring to that material
- The task instruction below the scenario must direct the candidate to use the scenario as the basis for their response`;
}

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
  const deployment = env.AZURE_OPENAI_AUTHORING_DEPLOYMENT ?? env.AZURE_OPENAI_DEPLOYMENT ?? "";
  const apiVersion = env.AZURE_OPENAI_API_VERSION;
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

// Normalizes a potentially-partial blueprint (e.g. from Zod-parsed request body where
// fields are nominally optional even with defaults) into the strict AssessmentBlueprint
// shape consumed by the generators. Returns undefined if input is undefined. See #372.
export type PartialAssessmentBlueprint = {
  learningObjectives?: string[];
  keyTopics?: string[];
  complexityBudget?: { actors?: number; concepts?: number; tradeoffs?: number };
  mcqProfile?: { suggestedCount?: number; topicDistribution?: Record<string, number> };
  notes?: string;
};
export function normalizeAssessmentBlueprint(
  raw: PartialAssessmentBlueprint | undefined,
): AssessmentBlueprint | undefined {
  if (!raw) return undefined;
  return {
    learningObjectives: raw.learningObjectives ?? [],
    keyTopics: raw.keyTopics ?? [],
    complexityBudget: {
      actors: raw.complexityBudget?.actors ?? 0,
      concepts: raw.complexityBudget?.concepts ?? 0,
      tradeoffs: raw.complexityBudget?.tradeoffs ?? 0,
    },
    mcqProfile: {
      suggestedCount: raw.mcqProfile?.suggestedCount ?? 10,
      topicDistribution: raw.mcqProfile?.topicDistribution ?? {},
    },
    notes: raw.notes ?? "",
  };
}

// Renders the optional assessment blueprint as a prompt section that downstream generators
// (scenario + MCQ) consume. Returns empty string when no blueprint is provided, so the
// generators fall back to the level-default complexity budget. See #372.
function renderBlueprintSection(blueprint: AssessmentBlueprint | undefined): string {
  if (!blueprint) return "";
  const objectives = blueprint.learningObjectives.length > 0
    ? blueprint.learningObjectives.map((o) => `- ${o}`).join("\n")
    : "- (none specified)";
  const topics = blueprint.keyTopics.length > 0
    ? blueprint.keyTopics.map((t) => `- ${t}`).join("\n")
    : "- (none specified)";
  const cb = blueprint.complexityBudget;
  return `
## Assessment blueprint (author-confirmed contract — follow strictly)

The blueprint defines the contract this task must satisfy. The MCQ for this module is generated against
the same blueprint, so consistent adherence here ensures the two formats stay calibrated.

Learning objectives to test:
${objectives}

Key topics covered by source material:
${topics}

Refined complexity targets (override defaults below if more specific):
- Actors in scenario: ${cb.actors}
- Distinct concepts to integrate: ${cb.concepts}
- Trade-offs or dilemmas: ${cb.tradeoffs}

Author notes: ${blueprint.notes || "(none)"}
`;
}

export function buildModuleDraftPrompts(input: ModuleDraftInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a module content author for a professional certification platform. Return strict JSON only - no markdown, no commentary.";

  const userPrompt = `Generate a certification module draft using the source material below as hidden author background only.

${buildLanguageEnforcementDirective(input.locale)}

Certification level: ${input.certificationLevel}
Language: ${LOCALE_DISPLAY[input.locale]}
Generation mode: ${input.generationMode}
${renderBlueprintSection(input.blueprint)}
## Authoring constraints

- The source material is for you only. The candidate will NOT see it.
- Write taskText so it is fully self-contained and usable on its own.
- Do not mention "source material", "the text above", "the material", "the document", "the attachment", or equivalent wording.
- Do not tell the candidate to read, review, use, cite, or refer to any unseen material.
- Any facts, context, terminology, or scenario details needed by the candidate must be embedded directly in the generated task itself.
- Use the certification level as the primary difficulty control.
- ${MODULE_DRAFT_LEVEL_GUIDELINES[input.certificationLevel]}
- ${GENERATION_MODE_GUIDELINES[input.generationMode].moduleDraft}

## Complexity budget (enforce strictly)

Respect these limits for ${input.certificationLevel} level:
- Maximum actors in scenario: ${COMPLEXITY_BUDGET[input.certificationLevel].actorsMax}
- Maximum distinct concepts required: ${COMPLEXITY_BUDGET[input.certificationLevel].conceptsMax}
- Maximum trade-offs or dilemmas: ${COMPLEXITY_BUDGET[input.certificationLevel].tradeoffsMax}
- Expected answer length: ${COMPLEXITY_BUDGET[input.certificationLevel].minWords}–${COMPLEXITY_BUDGET[input.certificationLevel].maxWords} words
- Expected completion time: ${COMPLEXITY_BUDGET[input.certificationLevel].timeBudgetMinutes} minutes

Before finalising, verify that a candidate can start a reasonable answer using only taskText and candidateTaskConstraints, plus expected prerequisite knowledge for this certification level. Do not introduce scenario elements that are not necessary to test the learning objective.

${renderScenarioDirective(input.scenarioMode ?? "auto")}

## Two separate output fields — do not mix their roles

**candidateTaskConstraints** (visible to candidate):
- 1–3 short sentences shown to the candidate alongside the task
- Clarify expected answer format, reasoning type, and scope
- Do NOT give away the answer, list expected points, or act as a scoring rubric
- Example: "Answer with a short recommendation and justify it with the most important considerations from the scenario. State your assumptions clearly. You do not need to cover every possible measure."

**assessorExpectedContent** (hidden from candidate — assessor use only):
- Concrete scoring support for the assessor
- Name the key points, trade-offs, and distinctions a strong response should cover
- May be more specific than the task itself — the candidate will NOT see this
- Include at least one note about what NOT to penalise if the task did not explicitly ask for it

## Source material (hidden author background)

${input.sourceMaterial}

## Return format

Return a single JSON object:
{
  "taskText": "full task text in ${LOCALE_DISPLAY[input.locale]}, including scenario at top if appropriate",
  "candidateTaskConstraints": "1–3 sentence visible candidate guidance in ${LOCALE_DISPLAY[input.locale]}",
  "assessorExpectedContent": "hidden assessor scoring support in ${LOCALE_DISPLAY[input.locale]}",
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

  // Render MCQ-specific guidance from blueprint (topic distribution constrains which key topics
  // each question targets; learning objectives steer cognitive level). Empty when no blueprint.
  let mcqBlueprintSection = "";
  if (input.blueprint) {
    const dist = Object.entries(input.blueprint.mcqProfile.topicDistribution);
    const distLines = dist.length > 0
      ? dist.map(([topic, weight]) => `- ${topic}: ~${Math.round(weight * 100)}% of questions`).join("\n")
      : "- (no topic distribution specified — distribute evenly across key topics)";
    const objectives = input.blueprint.learningObjectives.length > 0
      ? input.blueprint.learningObjectives.map((o) => `- ${o}`).join("\n")
      : "- (none specified)";
    const topics = input.blueprint.keyTopics.length > 0
      ? input.blueprint.keyTopics.map((t) => `- ${t}`).join("\n")
      : "- (none specified)";
    mcqBlueprintSection = `
## Assessment blueprint (author-confirmed contract — follow strictly)

The scenario task for this module is generated against the same blueprint. Adhere to the
contract so MCQ and scenario stay calibrated against each other.

Learning objectives the MCQ set must test:
${objectives}

Key topics from the source material:
${topics}

Target topic distribution for the ${input.questionCount} questions:
${distLines}

Author notes: ${input.blueprint.notes || "(none)"}
`;
  }

  const userPrompt = `Generate EXACTLY ${input.questionCount} multiple-choice questions (not fewer, not more) using the source material below as hidden author background only. The questions array in your JSON response must contain exactly ${input.questionCount} items.${mcqBlueprintSection}

${buildLanguageEnforcementDirective(input.locale)}

Certification level: ${input.certificationLevel}
Language: ${LOCALE_DISPLAY[input.locale]}
Generation mode: ${input.generationMode}

## Authoring constraints

- The source material is for you only. The candidate will NOT see it.
- Each question must be self-contained and understandable without any external text.
- Do not mention "source material", "text above", "document", "attachment", or any unseen reference material.
- Do not write stems, options, or rationales that assume the candidate can inspect the hidden source material.
- If background facts are needed, incorporate them directly into the question stem.

## Mandatory distractor quality — applies to every question

${DISTRACTOR_GUIDELINES[input.certificationLevel]}
${MCQ_LEVEL_GUIDELINES[input.certificationLevel]}
${GENERATION_MODE_GUIDELINES[input.generationMode].mcq}

Every option must be plausible to a partially informed candidate. Do not create throwaway distractors.

For each incorrect option, all three of the following must be true:
1. It reflects a realistic misconception, overgeneralisation, wrong priority, or nearby correct principle.
2. It would be correct or defensible if one relevant condition in the stem were different.
3. It cannot be eliminated without domain reasoning.

The correct answer must be the best answer under the exact conditions in the stem, not the only answer that sounds professional.

Reject and rewrite the question if any option is obviously wrong, irrelevant, too broad, too narrow, stylistically weaker, or categorically different from the correct answer.

## Option parity

All ${input.optionCount} options in a question must be comparable in length and level of detail. This is critical: a candidate should not be able to identify the correct answer by noticing that one option is longer, more specific, or more qualified than the others.

Rules:
- Write all options at the same level of specificity — if the correct answer contains a qualifier or clause, the distractors must too.
- If the correct answer is a short phrase, keep all options short. If it is a full sentence, make all options full sentences of similar length.
- Never pad distractors with vague filler words just to match length; instead, write distractors that are substantively comparable but wrong.
- Review each set of ${input.optionCount} options before finalising: if any single option stands out in length or detail, rewrite it.
- The correct answer must NOT have clearly more professional wording, more specific qualifiers, or a more "textbook" tone than the distractors.

Each question must have exactly ${input.optionCount} answer options. The correctAnswer must be one of the options verbatim.
Write all text in ${LOCALE_DISPLAY[input.locale]}.

## Source material (hidden author background)

${input.sourceMaterial}

## Return format

Return a single JSON object. For each incorrect option, include distractorMetadata with whyTempting, whyWrongUnderStem, and wouldBeCorrectIf. Set eliminationRisk to "low" if all distractors require domain reasoning to reject, "medium" if one could be eliminated without reasoning, "high" if one or more can be eliminated by non-domain reasoning (length, category, absurdity).

{
  "questions": [
    {
      "stem": "question text",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "correctAnswer": "option 1",
      "rationale": "explanation of why the correct answer is right and why each distractor is wrong",
      "distractorMetadata": [
        {
          "option": "option 2",
          "whyTempting": "why a partially informed candidate might choose this",
          "whyWrongUnderStem": "why it is wrong given the exact conditions in the stem",
          "wouldBeCorrectIf": "which condition in the stem would need to change for this to be correct"
        }
      ],
      "eliminationRisk": "low"
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

  const candidateConstraintsSection = input.candidateTaskConstraints
    ? `\ncandidateTaskConstraints (visible to candidate):\n${input.candidateTaskConstraints}`
    : "";

  const userPrompt = `Revise the following certification module draft based on the instruction below.

${buildLanguageEnforcementDirective(input.locale)}

Language: ${LOCALE_DISPLAY[input.locale]}

## Revision rules

- Apply the requested change directly to the draft.
- Keep taskText self-contained for candidates.
- Do not mention hidden source material or the editing process.
- Preserve the overall structure unless the instruction clearly asks for structural changes.
- If the task includes a scenario, keep it at the top of taskText labelled "Scenario:".
- candidateTaskConstraints is visible to the candidate — keep it brief (1–3 sentences) and do not turn it into an answer outline.
- assessorExpectedContent is hidden from the candidate — it is assessor-only scoring support.

## Current draft

taskText:
${input.taskText}
${candidateConstraintsSection}

assessorExpectedContent (hidden assessor notes):
${input.assessorExpectedContent}

## Revision instruction

${input.instruction}

## Return format

Return a single JSON object:
{
  "taskText": "revised task text in ${LOCALE_DISPLAY[input.locale]}",
  "candidateTaskConstraints": "revised 1–3 sentence visible candidate guidance in ${LOCALE_DISPLAY[input.locale]}",
  "assessorExpectedContent": "revised hidden assessor scoring support in ${LOCALE_DISPLAY[input.locale]}",
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

${buildLanguageEnforcementDirective(input.locale)}

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

  const candidateConstraintsSection = input.candidateTaskConstraints
    ? `\ncandidateTaskConstraints (visible to candidate):\n${input.candidateTaskConstraints}\n`
    : "";

  const titleReturnField = input.title
    ? `\n  "title": "translated title in ${LOCALE_DISPLAY[input.targetLocale]}",`
    : "";

  const userPrompt = `Translate the following certification module draft from ${LOCALE_DISPLAY[input.sourceLocale]} to ${LOCALE_DISPLAY[input.targetLocale]}.

${buildLanguageEnforcementDirective(input.targetLocale)}

## Translation rules

- Preserve meaning, structure, tone and difficulty.
- Keep taskText fully self-contained for candidates.
- If taskText starts with "Scenario:", preserve that label in the target language.
- candidateTaskConstraints is visible to the candidate — translate faithfully and keep it brief (1–3 sentences).
- assessorExpectedContent is hidden assessor-only content — translate faithfully and preserve all scoring details.
- Do not add or remove assessment requirements.
- Do not summarise.

## Source draft
${titleSection}
taskText:
${input.taskText}
${candidateConstraintsSection}
assessorExpectedContent (hidden assessor notes):
${input.assessorExpectedContent}

## Return format

Return a single JSON object:
{${titleReturnField}
  "taskText": "translated task text in ${LOCALE_DISPLAY[input.targetLocale]}",
  "candidateTaskConstraints": "translated 1–3 sentence visible candidate guidance in ${LOCALE_DISPLAY[input.targetLocale]}",
  "assessorExpectedContent": "translated hidden assessor scoring support in ${LOCALE_DISPLAY[input.targetLocale]}",
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

${buildLanguageEnforcementDirective(input.targetLocale)}

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

export function buildCourseCopyLocalizationPrompts(input: CourseCopyLocalizationInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a professional translator for a certification platform. Translate the provided course metadata faithfully and return strict JSON only - no markdown, no commentary.";

  const titleSection = typeof input.title === "string" && input.title.trim().length > 0
    ? `\ntitle:\n${input.title.trim()}\n`
    : "";

  const descriptionSection = typeof input.description === "string" && input.description.trim().length > 0
    ? `\ndescription:\n${input.description.trim()}\n`
    : "";

  const returnFields: string[] = [];
  if (titleSection) {
    returnFields.push(`  "title": "translated title in ${LOCALE_DISPLAY[input.targetLocale]}"`);
  }
  if (descriptionSection) {
    returnFields.push(`  "description": "translated description in ${LOCALE_DISPLAY[input.targetLocale]}"`);
  }

  const userPrompt = `Translate the following course metadata from ${LOCALE_DISPLAY[input.sourceLocale]} to ${LOCALE_DISPLAY[input.targetLocale]}.

${buildLanguageEnforcementDirective(input.targetLocale)}

## Translation rules

- Preserve meaning, tone and intended audience.
- Keep the course title concise and natural in the target language.
- Keep the description faithful; do not add marketing copy or extra detail.
- If a phrase should stay unchanged across languages, keep it unchanged.
- Do not add or remove fields.

## Source metadata
${titleSection}
${descriptionSection}
## Return format

Return a single JSON object:
{
${returnFields.join(",\n")}
}`;

  return { systemPrompt, userPrompt };
}

export function buildModuleRubricPrompts(input: ModuleRubricInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are an assessment design specialist. Derive a module-specific scoring rubric from the assignment text and assessor expectations. Return strict JSON only - no markdown, no commentary. Criteria must be specific to THIS task, not generic placeholders like 'quality and depth' or 'clarity'.";

  const constraintsSection = input.candidateTaskConstraints
    ? `## Visible constraints / instructions to the candidate\n\n${input.candidateTaskConstraints}\n\n`
    : "";

  const blueprintSection = input.blueprint
    ? `## Assessment blueprint (use to align criteria with learning objectives)\n\nLearning objectives:\n${input.blueprint.learningObjectives.map((o) => `- ${o}`).join("\n")}\n\nKey topics:\n${input.blueprint.keyTopics.map((t) => `- ${t}`).join("\n")}\n\nAuthor notes: ${input.blueprint.notes || "(none)"}\n\n`
    : "";

  const userPrompt = `Design a scoring rubric tailored to this specific module. The rubric must reflect what THIS assignment actually requires — not generic essay criteria.

${buildLanguageEnforcementDirective(input.locale)}

Language for labels and descriptions: ${LOCALE_DISPLAY[input.locale]}
Certification level: ${input.certificationLevel}

## Task text (what the candidate sees and must respond to)

${input.taskText}

${constraintsSection}## Assessor expectations (hidden — describes what a strong response covers)

${input.assessorExpectedContent}

${blueprintSection}## Authoring rules

- Produce 3-6 criteria. Each must name a specific dimension the task actually tests (e.g. "Trade-off between privacy and audit obligation", not "Quality of reasoning").
- Each \`description\` must reference concrete content from the task or assessor expectations so a human assessor can apply it without guessing.
- \`maxScore\` per criterion is an integer 1-10. Sum across all criteria should land in the range 10-30.
- \`id\` is short snake_case (e.g. "scenario_application", "priority_reasoning"). Stable across runs.
- \`candidateVisible: true\` means the criterion text is appropriate to show the candidate before they submit. Set false only for criteria that would leak the expected answer.
- \`assessorNotes\` is a short paragraph with one or two judgement calls the assessor should make consistently across submissions (e.g. don't penalise for missing X unless the task asked for it). Keep it under 60 words.
- \`generatedFromTask\` must be true.

## Return format

Return a single JSON object:
{
  "criteria": [
    {
      "id": "snake_case_id",
      "label": "Short label in ${LOCALE_DISPLAY[input.locale]}",
      "description": "1-2 sentences that name what the assessor checks for, grounded in the task.",
      "maxScore": integer 1-10,
      "candidateVisible": boolean
    }
  ],
  "generatedFromTask": true,
  "assessorNotes": "Short calibration note for assessors."
}`;

  return { systemPrompt, userPrompt };
}

export function buildBlueprintPrompts(input: BlueprintInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a certification content architect. Analyse the provided source material and return a structured assessment blueprint as strict JSON only - no markdown, no commentary.";

  const budget = COMPLEXITY_BUDGET[input.certificationLevel];

  const userPrompt = `Analyse the source material below and produce an assessment blueprint for a ${input.certificationLevel}-level certification module.

${buildLanguageEnforcementDirective(input.locale)}

Language for labels: ${LOCALE_DISPLAY[input.locale]}

## Complexity limits for ${input.certificationLevel} level

- Maximum actors in scenario: ${budget.actorsMax}
- Maximum distinct concepts required: ${budget.conceptsMax}
- Maximum trade-offs or dilemmas: ${budget.tradeoffsMax}
- Expected answer length: ${budget.minWords}–${budget.maxWords} words
- Expected completion time: ${budget.timeBudgetMinutes} minutes

## Source material (hidden author background)

${input.sourceMaterial}

## Return format

Return a single JSON object:
{
  "learningObjectives": ["1-4 specific, measurable learning objectives the assessment should test"],
  "keyTopics": ["3-8 key topics or concepts covered by the source material"],
  "complexityBudget": {
    "actors": number — recommended actor count for scenario (≤ ${budget.actorsMax}),
    "concepts": number — recommended distinct concepts to test (≤ ${budget.conceptsMax}),
    "tradeoffs": number — recommended trade-offs or dilemmas (≤ ${budget.tradeoffsMax})
  },
  "mcqProfile": {
    "suggestedCount": number — recommended number of MCQ questions (5-15),
    "topicDistribution": { "topic": fractional weight, ... } — keys are topic labels, values sum to 1.0
  },
  "notes": "brief author notes on how to use this material for assessment, potential pitfalls, or caveats"
}`;

  return { systemPrompt, userPrompt };
}

// #479: Azure OpenAI returns 429 ("too_many_requests") when the deployment's tokens-per-minute
// quota is exceeded — easy to hit now that crawl can produce large source material fanning into
// several big calls (condense → blueprint → draft → MCQ) within seconds. A single un-retried 429
// aborted the whole pipeline (and the condense fallback then sent the FULL oversized material
// downstream, guaranteeing more 429s). These calls are now retried with backoff that honours the
// server's Retry-After. 5xx are transient gateway errors and are retried too.
const LLM_MAX_ATTEMPTS = 4;
const LLM_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const LLM_BACKOFF_BASE_MS = 1_000;
const LLM_BACKOFF_MAX_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Parses a Retry-After header (delta-seconds or HTTP-date). Returns null when absent/unparseable.
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// Backoff for attempt N (0-based): honour Retry-After if the server sent one, otherwise exponential
// (1s, 2s, 4s, …) capped, with jitter to avoid thundering-herd retries across concurrent calls.
export function computeLlmBackoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, LLM_BACKOFF_MAX_MS);
  const exponential = Math.min(LLM_BACKOFF_BASE_MS * 2 ** attempt, LLM_BACKOFF_MAX_MS);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

async function callLlm(systemPrompt: string, userPrompt: string, maxTokens = 4000): Promise<unknown> {
  if (env.LLM_MODE !== "azure_openai") {
    throw new Error("LLM content generation requires LLM_MODE=azure_openai.");
  }

  const url = buildUrl();
  // Resolve token parameter: authoring-specific setting overrides the shared setting.
  // Use max_tokens by default (chat completion models); set AZURE_OPENAI_AUTHORING_TOKEN_LIMIT_PARAMETER
  // to max_completion_tokens when the authoring deployment is a reasoning model (o3/o4-series).
  const tokenLimitPref =
    env.AZURE_OPENAI_AUTHORING_TOKEN_LIMIT_PARAMETER ?? env.AZURE_OPENAI_TOKEN_LIMIT_PARAMETER;
  const tokenParam = tokenLimitPref === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens";
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: env.AZURE_OPENAI_AUTHORING_TEMPERATURE ?? 0.4,
    [tokenParam]: maxTokens,
  };

  let response: Response | null = null;
  for (let attempt = 0; attempt < LLM_MAX_ATTEMPTS; attempt++) {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.AZURE_OPENAI_API_KEY ?? "",
      },
      body: JSON.stringify(body),
    });

    if (response.ok || !LLM_RETRYABLE_STATUSES.has(response.status)) break;

    // Retryable (429/5xx). Back off and retry unless this was the last attempt.
    if (attempt < LLM_MAX_ATTEMPTS - 1) {
      const waitMs = computeLlmBackoffMs(attempt, parseRetryAfterMs(response.headers.get("retry-after")));
      console.warn(
        `[#479] Azure OpenAI ${response.status} — retrying in ${waitMs}ms (attempt ${attempt + 1}/${LLM_MAX_ATTEMPTS}).`,
      );
      await sleep(waitMs);
    }
  }

  if (!response || !response.ok) {
    const status = response?.status ?? 0;
    const text = response ? await response.text().catch(() => "") : "";
    throw new Error(`Azure OpenAI generation failed (${status}): ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error(
      `LLM output truncated (finish_reason=length, tokenParam=${tokenParam}, maxTokens=${maxTokens}). ` +
        `Increase AZURE_OPENAI_MAX_TOKENS or reduce the request size.`,
    );
  }
  const content = choice?.message?.content ?? "";
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

  const attempt = async (extraDirective: string | null): Promise<ModuleDraftResult> => {
    const promptToUse = extraDirective ? `${userPrompt}\n\n${extraDirective}` : userPrompt;
    const raw = await callLlm(systemPrompt, promptToUse);
    const parsed = moduleDraftResponseCodec.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Module draft LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
    }
    return parsed.data;
  };

  const first = await attempt(null);
  const sampleText = `${first.taskText}\n${first.assessorExpectedContent}`;
  if (!isLikelyWrongLocale(sampleText, input.locale)) {
    return first;
  }
  console.warn(
    `[#444] generateModuleDraft language mismatch: expected ${input.locale}, detected ${detectDominantLanguage(sampleText)}. Retrying with stronger directive.`,
  );
  const retryDirective = `## Language retry — your previous attempt was in the wrong language.\n\nYour previous response used the wrong language. Re-do the entire response with every visible string in ${LOCALE_DISPLAY[input.locale]}. The source material's language is irrelevant — output language is determined ONLY by this directive.`;
  const second = await attempt(retryDirective);
  const secondSample = `${second.taskText}\n${second.assessorExpectedContent}`;
  if (isLikelyWrongLocale(secondSample, input.locale)) {
    console.warn(
      `[#444] generateModuleDraft language retry also produced wrong language (expected ${input.locale}). Returning result anyway — operator must verify.`,
    );
  }
  return second;
}

// ---------------------------------------------------------------------------
// MCQ generation (#246)
// ---------------------------------------------------------------------------

// #551: deterministic guard against the "correct answer is almost always the longest" length cue.
// The generation prompt already mandates option parity, but the LLM doesn't always comply — this
// flags sets where the correct option is the longest in a high proportion of questions so the
// author is prompted to review/regenerate. Exported for unit testing.
export function detectCorrectAnswerLengthBias(
  questions: Array<{ options: string[]; correctAnswer: string }>,
  { minQuestions = 3, ratioThreshold = 0.7 }: { minQuestions?: number; ratioThreshold?: number } = {},
): { biased: boolean; longestCorrectRatio: number; consideredCount: number } {
  const considered = questions.filter(
    (q) => Array.isArray(q.options) && q.options.length >= 2 && typeof q.correctAnswer === "string",
  );
  if (considered.length < minQuestions) {
    return { biased: false, longestCorrectRatio: 0, consideredCount: considered.length };
  }
  let longestCorrect = 0;
  for (const q of considered) {
    const correct = q.correctAnswer.trim();
    const correctLen = correct.length;
    const distractorLengths = q.options
      .map((o) => o.trim())
      .filter((o) => o !== correct)
      .map((o) => o.length);
    const maxDistractor = distractorLengths.length > 0 ? Math.max(...distractorLengths) : 0;
    if (correctLen > maxDistractor) longestCorrect++;
  }
  const longestCorrectRatio = longestCorrect / considered.length;
  return {
    biased: longestCorrectRatio >= ratioThreshold,
    longestCorrectRatio,
    consideredCount: considered.length,
  };
}

function appendLengthBiasWarning(result: McqGenerationResult): McqGenerationResult {
  const { biased, longestCorrectRatio } = detectCorrectAnswerLengthBias(result.questions);
  if (!biased) return result;
  const pct = Math.round(longestCorrectRatio * 100);
  const warning = `Length cue: the correct answer is the longest option in ${pct}% of questions — review option parity so the answer isn't guessable by length (#551).`;
  return { ...result, validationWarnings: [...(result.validationWarnings ?? []), warning] };
}

export async function generateMcqQuestions(input: McqGenerationInput): Promise<McqGenerationResult> {
  const { systemPrompt, userPrompt } = buildMcqGenerationPrompts(input);

  // Each question with distractorMetadata (3 verbose fields per distractor) needs ~800 tokens.
  // Floor at 4000 so single-question calls don't under-allocate.
  const maxTokens = Math.max(4000, input.questionCount * input.optionCount * 200);

  const attempt = async (extraDirective: string | null): Promise<McqGenerationResult> => {
    const promptToUse = extraDirective ? `${userPrompt}\n\n${extraDirective}` : userPrompt;
    const raw = await callLlm(systemPrompt, promptToUse, maxTokens);
    const parsed = mcqGenerationResponseCodec.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`MCQ generation LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
    }
    // Defensive guard: the LLM occasionally returns one extra question even when the prompt
    // says "exactly N". Truncate to the requested count. If it returned fewer, leave as-is
    // and let downstream validation surface that. See #424.
    if (parsed.data.questions.length !== input.questionCount) {
      console.warn(
        `MCQ generation count mismatch: requested ${input.questionCount}, LLM returned ${parsed.data.questions.length}. ` +
        `${parsed.data.questions.length > input.questionCount ? "Truncating to requested count." : "Returning fewer than requested."}`,
      );
      if (parsed.data.questions.length > input.questionCount) {
        return { ...parsed.data, questions: parsed.data.questions.slice(0, input.questionCount) };
      }
    }
    return parsed.data;
  };

  const first = await attempt(null);
  const sampleText = mcqSampleForLanguageCheck(first);
  if (!isLikelyWrongLocale(sampleText, input.locale)) {
    return appendLengthBiasWarning(first);
  }
  console.warn(
    `[#444] generateMcqQuestions language mismatch: expected ${input.locale}, detected ${detectDominantLanguage(sampleText)}. Retrying with stronger directive.`,
  );
  const retryDirective = `## Language retry — your previous attempt was in the wrong language.\n\nYour previous response used the wrong language. Re-do every stem, option, correctAnswer and rationale in ${LOCALE_DISPLAY[input.locale]}. The source material's language is irrelevant — output language is determined ONLY by this directive.`;
  const second = await attempt(retryDirective);
  if (isLikelyWrongLocale(mcqSampleForLanguageCheck(second), input.locale)) {
    console.warn(
      `[#444] generateMcqQuestions language retry also produced wrong language (expected ${input.locale}). Returning result anyway — operator must verify.`,
    );
  }
  return appendLengthBiasWarning(second);
}

function mcqSampleForLanguageCheck(result: McqGenerationResult): string {
  const parts: string[] = [];
  for (const question of result.questions.slice(0, 3)) {
    parts.push(question.stem ?? "");
    parts.push((question.options ?? []).join(" "));
    parts.push(question.rationale ?? "");
  }
  return parts.join(" ");
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

// ---------------------------------------------------------------------------
// Scenario answerability check (#374)
// ---------------------------------------------------------------------------

export type ScenarioAnswerabilityInput = {
  taskText: string;
  candidateTaskConstraints: string | undefined | null;
  assessorExpectedContent: string | undefined | null;
  certificationLevel: CertificationLevel;
};

export type ScenarioAnswerabilityResult = {
  answerableWithoutHiddenInfo: boolean;
  minimalPassingAnswerWordCount: number;
  hiddenExpectationFlags: string[];
  warnings: string[];
};

const scenarioAnswerabilityResponseCodec = z.object({
  answerableWithoutHiddenInfo: z.boolean(),
  minimalPassingAnswerWordCount: z.number().int().nonnegative(),
  hiddenExpectationFlags: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

function buildScenarioAnswerabilityPrompts(input: ScenarioAnswerabilityInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a quality control system for a professional certification platform. Return strict JSON only - no markdown, no commentary.";

  const constraintsSection = input.candidateTaskConstraints?.trim()
    ? `\ncandidate task constraints (visible to candidate):\n${input.candidateTaskConstraints.trim()}`
    : "";

  const assessorSection = input.assessorExpectedContent?.trim()
    ? `\nassessor expected content (hidden from candidate):\n${input.assessorExpectedContent.trim()}`
    : "";

  const budget = COMPLEXITY_BUDGET[input.certificationLevel];

  const userPrompt = `Check if a candidate can answer the following task using only the information visible to them.

## Task (visible to candidate)
${input.taskText.trim()}${constraintsSection}

## Certification level: ${input.certificationLevel}
## Expected answer length: ${budget.minWords}–${budget.maxWords} words
${assessorSection}

## Instructions
1. Without consulting the assessor expected content, write the shortest answer that would deserve a passing mark at this certification level.
2. Count its approximate word count.
3. Check whether the assessor expected content contains expectations not reasonably derivable from the visible task and standard prerequisites for this certification level.
4. Flag each hidden expectation.

## Return format
{
  "answerableWithoutHiddenInfo": true if a well-prepared candidate can give a passing answer using only the visible task, false if they would need information absent from the visible task,
  "minimalPassingAnswerWordCount": approximate word count of the minimal passing answer,
  "hiddenExpectationFlags": ["description of each expectation in assessorExpectedContent not implied by the visible task — leave empty array if none"],
  "warnings": ["any other concerns about task quality — leave empty array if none"]
}`;

  return { systemPrompt, userPrompt };
}

export async function checkScenarioAnswerability(
  input: ScenarioAnswerabilityInput,
): Promise<ScenarioAnswerabilityResult> {
  if (env.LLM_MODE !== "azure_openai") {
    return { answerableWithoutHiddenInfo: true, minimalPassingAnswerWordCount: 0, hiddenExpectationFlags: [], warnings: [] };
  }
  const { systemPrompt, userPrompt } = buildScenarioAnswerabilityPrompts(input);
  try {
    const raw = await callLlm(systemPrompt, userPrompt, 1500);
    const parsed = scenarioAnswerabilityResponseCodec.safeParse(raw);
    if (!parsed.success) {
      return { answerableWithoutHiddenInfo: true, minimalPassingAnswerWordCount: 0, hiddenExpectationFlags: [], warnings: [`Answerability check returned unexpected format.`] };
    }
    return parsed.data;
  } catch {
    return { answerableWithoutHiddenInfo: true, minimalPassingAnswerWordCount: 0, hiddenExpectationFlags: [], warnings: [`Answerability check could not be completed.`] };
  }
}

export async function localizeCourseCopy(input: CourseCopyLocalizationInput): Promise<CourseCopyLocalizationResult> {
  const { systemPrompt, userPrompt } = buildCourseCopyLocalizationPrompts(input);

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = courseCopyLocalizationResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Course copy localization failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

// Markdown-preserving translation of a learning section (#514). Unlike course
// copy, bodyMarkdown must keep its markdown structure and {{asset:...}}
// placeholders intact — only human-readable text is translated.
export function buildSectionLocalizationPrompts(input: SectionLocalizationInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt =
    "You are a professional translator for a certification platform. Translate the provided learning-section content faithfully and return strict JSON only - no commentary.";

  const titleSection = typeof input.title === "string" && input.title.trim().length > 0
    ? `\ntitle:\n${input.title.trim()}\n`
    : "";
  const bodySection = typeof input.bodyMarkdown === "string" && input.bodyMarkdown.trim().length > 0
    ? `\nbodyMarkdown:\n${input.bodyMarkdown.trim()}\n`
    : "";

  const returnFields: string[] = [];
  if (titleSection) returnFields.push(`  "title": "translated title in ${LOCALE_DISPLAY[input.targetLocale]}"`);
  if (bodySection) returnFields.push(`  "bodyMarkdown": "translated markdown body in ${LOCALE_DISPLAY[input.targetLocale]}"`);

  const userPrompt = `Translate the following learning-section content from ${LOCALE_DISPLAY[input.sourceLocale]} to ${LOCALE_DISPLAY[input.targetLocale]}.

${buildLanguageEnforcementDirective(input.targetLocale)}

## Translation rules

- Translate ONLY human-readable text. Preserve meaning, tone and intended audience.
- Keep ALL markdown formatting exactly: headings (#), lists, links, emphasis, code blocks, tables, images.
- Do NOT translate or alter URLs, code, or {{asset:...}} placeholders.
- Do not add or remove content, fields, or markdown structure.

## Source content
${titleSection}
${bodySection}
## Return format

Return a single valid JSON object. Keep real line breaks inside the markdown (do NOT write the
two characters backslash + n; use actual newlines, which JSON encodes automatically):
{
${returnFields.join(",\n")}
}`;

  return { systemPrompt, userPrompt };
}

// Defensive: some models emit literal "\n" (backslash + n) instead of real
// newlines despite instructions (observed for nn but not en-GB). Normalise them
// back to newlines so markdown renders. Only touches backslash-n sequences.
export function normaliseLiteralNewlines(value: string | undefined): string | undefined {
  if (typeof value !== "string") return value;
  return value.includes("\\n") ? value.replace(/\\r\\n|\\n/g, "\n") : value;
}

export async function localizeSectionContent(input: SectionLocalizationInput): Promise<SectionLocalizationResult> {
  // Stub mode (local dev / CI): return a deterministic, clearly-tagged localisation
  // so the translate client→server flow is exercisable without a live LLM. Real
  // translation quality is validated against azure_openai on staging.
  if (env.LLM_MODE !== "azure_openai") {
    const tag = `[${input.targetLocale}]`;
    return {
      title: input.title ? `${tag} ${input.title}` : undefined,
      bodyMarkdown: input.bodyMarkdown ? `${tag} ${input.bodyMarkdown}` : undefined,
    };
  }

  const { systemPrompt, userPrompt } = buildSectionLocalizationPrompts(input);

  const raw = await callLlm(systemPrompt, userPrompt);
  const parsed = sectionLocalizationResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Section localization failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return {
    title: parsed.data.title,
    bodyMarkdown: normaliseLiteralNewlines(parsed.data.bodyMarkdown),
  };
}

// ---------------------------------------------------------------------------
// Assessment blueprint generation (#372)
// ---------------------------------------------------------------------------

export async function generateAssessmentBlueprint(input: BlueprintInput): Promise<AssessmentBlueprint> {
  const { systemPrompt, userPrompt } = buildBlueprintPrompts(input);
  const raw = await callLlm(systemPrompt, userPrompt, 2000);
  const parsed = assessmentBlueprintResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Assessment blueprint LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Source material condensation (#454 Phase 4)
// ---------------------------------------------------------------------------
// When combined source material exceeds 50K chars, run a single condensation LLM call
// before the blueprint/draft/MCQ/rubric pipeline. Keeps facts, definitions, key claims;
// drops navigation, boilerplate, repetitive content. Result is reused across all
// downstream calls so we pay 1 condensation cost instead of 4× full-context cost.

export interface CondenseSourceMaterialInput {
  sourceMaterial: string;
  certificationLevel: CertificationLevel;
  locale: GenerationLocale;
  targetMaxChars?: number;
}

export interface CondenseSourceMaterialResult {
  condensedText: string;
  originalLength: number;
  condensedLength: number;
}

function buildCondensationPrompts(input: CondenseSourceMaterialInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const targetMax = input.targetMaxChars ?? 30_000;
  const systemPrompt = `You condense source material for assessment-module authoring.

Goal: produce a faithful, fact-dense extract of the source material in ${LOCALE_DISPLAY[input.locale]} that an authoring LLM can use to generate a ${input.certificationLevel}-level module (blueprint, task text, MCQ, rubric criteria) WITHOUT seeing the original.

KEEP:
- Concrete facts, dates, names, numbers, definitions
- Key claims, conclusions, and the reasoning behind them
- Specific examples that could appear in test questions
- Structural information (sections, themes, distinctions)
- Direct quotes when they carry specific information
- Any technical terms or domain vocabulary

DROP:
- Navigation, page headers/footers, cookie banners
- Repetitive content, marketing fluff, generic transitions
- Tangential digressions not useful for assessment
- Already-summarized "this article will cover…" preambles
- Image/figure references where the image isn't accessible

OUTPUT FORMAT:
- One JSON object with a single field "condensedText" containing the condensed text in ${LOCALE_DISPLAY[input.locale]}
- The condensed text must be max ${targetMax.toLocaleString()} characters
- Preserve source attribution markers ([filename] / [hostname]) when present in input
- No meta-commentary about your process — just the condensed material inside condensedText
- No "Here is the condensed version:" preamble — start directly with the content`;

  const userPrompt = `Condense the following source material per the system instructions.

## Source material

${input.sourceMaterial}

## Return format

Return one JSON object:
{
  "condensedText": "the condensed material in ${LOCALE_DISPLAY[input.locale]}, max ${targetMax.toLocaleString()} characters"
}`;

  return { systemPrompt, userPrompt };
}

export async function condenseSourceMaterial(
  input: CondenseSourceMaterialInput,
): Promise<CondenseSourceMaterialResult> {
  const { systemPrompt, userPrompt } = buildCondensationPrompts(input);
  // 8000 tokens ≈ 30K-40K chars output budget; matches default target of 30K.
  const raw = await callLlm(systemPrompt, userPrompt, 8000);
  const condensedText = typeof (raw as { condensedText?: unknown })?.condensedText === "string"
    ? (raw as { condensedText: string }).condensedText.trim()
    : "";
  if (!condensedText) {
    throw new Error("Condensation LLM response missing condensedText.");
  }
  return {
    condensedText,
    originalLength: input.sourceMaterial.length,
    condensedLength: condensedText.length,
  };
}

// ---------------------------------------------------------------------------
// Module-specific rubric generation (#378)
// ---------------------------------------------------------------------------

export async function generateModuleRubric(input: ModuleRubricInput): Promise<ModuleRubric> {
  const { systemPrompt, userPrompt } = buildModuleRubricPrompts(input);
  const raw = await callLlm(systemPrompt, userPrompt, 2500);
  const parsed = moduleRubricResponseCodec.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Module rubric LLM response failed validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}
