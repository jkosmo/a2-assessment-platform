import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";
import type { RevisableMcqQuestion } from "../../src/modules/adminContent/llmContentGenerationService.js";

// #1077 leveranse 1b: KI-generering og KI-revisjon med «velg alle som stemmer». Produkteier 2026-10-24:
// ved generering avgjør kilden, høyst omtrent hvert tredje; ved generell revisjon vurderer modellen selv,
// høyst halvparten. Modellen byttes ut med faste svar — det som måles er hva plattformen ber om, og
// hva den gjør med det som kommer tilbake.

const mockEnv = vi.hoisted(() => ({
  LLM_MODE: "azure_openai",
  AZURE_OPENAI_ENDPOINT: "https://example.invalid",
  AZURE_OPENAI_DEPLOYMENT: "d",
  AZURE_OPENAI_API_VERSION: "v",
  AZURE_OPENAI_API_KEY: "k",
}));
vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));

const llm = vi.hoisted(() => ({ replies: [] as unknown[], prompts: [] as string[] }));
vi.mock("../../src/modules/llm/azureOpenAiRetry.js", () => ({
  parseRetryAfterMs: () => null,
  computeLlmBackoffMs: () => 0,
  fetchAzureOpenAiWithRetry: async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { messages: Array<{ content: string }> };
    llm.prompts.push(body.messages[1]!.content);
    const reply = llm.replies.shift();
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }] }) };
  },
}));

warmModuleGraph(() => import("../../src/modules/adminContent/llmContentGenerationService.js"));

const {
  buildMcqGenerationPrompts,
  generateMcqQuestions,
  hasMeaningfulMcqRevision,
  normalizeGeneratedQuestionType,
  reviseMcqQuestions,
} = await import("../../src/modules/adminContent/llmContentGenerationService.js");

const single = (n: number) => ({
  stem: `Which statement about the processing record is accurate in case ${n}?`,
  options: ["Purpose", "Colour", "Font", "Margin"],
  correctAnswer: "Purpose",
  rationale: "Article 30 lists the purpose.",
});
const multiple = (n: number) => ({
  questionType: "multiple",
  stem: `Which elements must the processing record contain in case ${n}?`,
  options: ["Purpose", "Colour", "Legal basis", "Font"],
  correctAnswers: ["Legal basis", "Purpose"],
  rationale: "Article 30 lists purpose and legal basis; colour and font are not required.",
});

const generationInput = (questionCount: number) => ({
  sourceMaterial: "Article 30 requires the record to state the purpose and the legal basis.",
  certificationLevel: "basic" as const,
  locale: "en-GB" as const,
  generationMode: "ordinary" as const,
  questionCount,
  optionCount: 4,
});

beforeEach(() => {
  llm.replies = [];
  llm.prompts = [];
});

describe("#1077 — generering: kilden avgjør, høyst hvert tredje", () => {
  it("instruksen gjør ett svar til standard og setter taket til hvert tredje", () => {
    const { userPrompt } = buildMcqGenerationPrompts(generationInput(10));
    expect(userPrompt).toContain("one correct answer is the default");
    expect(userPrompt).toContain("ONLY where the source material itself states several things that are all true");
    expect(userPrompt).toContain("At most 3 of the 10 questions");
    expect(userPrompt).toContain("ALL options may be correct");
    expect(userPrompt).toContain("must not reveal or hint at how many options are correct");
  });

  it("kontroll: med for få spørsmål til et «velg alle» ber instruksen bare om ett svar", () => {
    const { userPrompt } = buildMcqGenerationPrompts(generationInput(2));
    expect(userPrompt).toContain('Do not set "questionType"');
    expect(userPrompt).not.toContain("At most");
  });

  it("et «velg alle» fra modellen beholdes, med de riktige i alternativenes rekkefølge", async () => {
    llm.replies.push({ questions: [multiple(1), single(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.questions[0]).toMatchObject({ questionType: "multiple", correctAnswers: ["Purpose", "Legal basis"], correctAnswer: "Purpose" });
    expect(result.questions[1]).not.toHaveProperty("questionType");
    expect(result.validationWarnings ?? []).toEqual([]);
  });

  it("flere enn hvert tredje gir en advarsel til forfatteren — spørsmålene beholdes", async () => {
    llm.replies.push({ questions: [multiple(1), multiple(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.questions).toHaveLength(2 + 1);
    expect((result.validationWarnings ?? []).join(" ")).toMatch(/2 of 3 questions are «select all that apply»/);
  });
});

describe("#1077 — modellens svar til én form", () => {
  it("riktige som ikke er alternativer, fjernes; ingen igjen → ett svar, hvis det finnes", () => {
    const q = normalizeGeneratedQuestionType(
      { ...multiple(1), correctAnswers: ["Something else"], correctAnswer: "Purpose" },
      0,
      "test",
    );
    expect(q).not.toHaveProperty("questionType");
    expect(q.correctAnswer).toBe("Purpose");
  });

  it("et «velg alle» uten brukbare riktige og uten svar avvises", () => {
    expect(() => normalizeGeneratedQuestionType({ ...multiple(1), correctAnswers: [] }, 0, "test")).toThrow(/no usable correct answer/);
  });

  it("«single» og annet tull fra modellen blir ett svar; correctAnswers på det kastes", () => {
    const q = normalizeGeneratedQuestionType({ ...single(1), questionType: "single", correctAnswers: ["Colour"] }, 0, "test");
    expect(q).not.toHaveProperty("questionType");
    expect(q).not.toHaveProperty("correctAnswers");
  });

  it("alle alternativene riktige er lov", () => {
    const q = normalizeGeneratedQuestionType({ ...multiple(1), correctAnswers: ["Font", "Purpose", "Colour", "Legal basis"] }, 0, "test");
    expect(q.correctAnswers).toEqual(["Purpose", "Colour", "Legal basis", "Font"]);
  });
});

describe("#1077 — revisjon: typen beholdes, høyst halvparten", () => {
  // Som ruta sender dem: et «velg alle» har også correctAnswer (det første riktige, mcqQuestionTypeFields).
  const source: Array<Record<string, unknown> & { stem: string; rationale: string }> = [
    { ...multiple(1), correctAnswer: "Purpose" },
    ...Array.from({ length: 9 }, (_, i) => single(i + 2)),
  ];
  const revisionInput = (instruction: string) => ({
    questions: source as unknown as RevisableMcqQuestion[],
    instruction,
    locale: "en-GB" as const,
  });

  it("typen og de riktige går med inn i instruksen, med taket", async () => {
    llm.replies.push({ questions: source.map((q, i) => (i === 3 ? { ...q, stem: `${q.stem} Rewritten with a new angle on lawful processing.` } : q)) });
    await reviseMcqQuestions(revisionInput("Make the questions harder"));
    const prompt = llm.prompts[0]!;
    expect(prompt).toContain("Type: multiple (select all that apply)");
    expect(prompt).toContain("Correct answers: Legal basis | Purpose");
    expect(prompt).toContain("Keep every question's type");
    // DESIGN_1077: «gjør testen vanskeligere» er også en generell forespørsel.
    expect(prompt).toContain("or for a harder test");
    expect(prompt).toContain("Any other instruction keeps every type as it is");
    expect(prompt).toContain("At most 5 of the 10 questions");
  });

  it("over halvparten: ett forsøk til, og så avvist", async () => {
    const tooMany = source.map((q, i) => (i < 6 ? { ...multiple(i + 1) } : { ...q, rationale: `${q.rationale} Revised.` }));
    llm.replies.push({ questions: tooMany }, { questions: tooMany });
    await expect(reviseMcqQuestions(revisionInput("Use more select-all questions"))).rejects.toThrow(/at most 5 are allowed/);
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain("your previous attempt had 6");
  });

  it("kontroll: fem av ti er innenfor", async () => {
    const five = source.map((q, i) => (i < 5 ? { ...multiple(i + 1) } : q));
    llm.replies.push({ questions: five });
    const result = await reviseMcqQuestions(revisionInput("Use more select-all questions"));
    expect(result.questions.filter((q) => q.questionType === "multiple")).toHaveLength(5);
    expect(llm.prompts).toHaveLength(1);
  });

  it("«gjør spørsmål 2 til velg alle» er en ekte endring, selv om teksten står", () => {
    const sourceQuestions = [single(1), single(2)];
    const revised = [single(1), { ...single(2), questionType: "multiple" as const, correctAnswers: ["Purpose", "Colour"] }];
    expect(hasMeaningfulMcqRevision(sourceQuestions, revised, "gjør spørsmål 2 til velg alle som stemmer")).toBe(true);
    // Kontroll: uendret er fortsatt uendret.
    expect(hasMeaningfulMcqRevision(sourceQuestions, sourceQuestions, "gjør spørsmål 2 til velg alle som stemmer")).toBe(false);
  });
});
