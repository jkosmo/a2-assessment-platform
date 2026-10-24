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
  clampMcqOptionCount,
  findAnswerKeyProblems,
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

describe("#1077 — modellens svar til én form, og fasiter som ikke stemmer", () => {
  // QA 2.100.0: et riktig som ikke var et alternativ ordrett, ble fjernet STILLE — et sant alternativ
  // ble rettet som galt uten at noen fikk vite det. Nå meldes det, og normaliseringen retter ingenting.
  it("et riktig som ikke er et alternativ ordrett, er et funn — også når resten treffer", () => {
    expect(findAnswerKeyProblems({ ...multiple(1), correctAnswers: ["Purpose", "Legal basis."] }, 0)).toEqual([
      'question 1: correctAnswers ["Legal basis."] are not among the options verbatim',
    ]);
    expect(findAnswerKeyProblems({ ...multiple(1), correctAnswers: [] }, 2)).toEqual(['question 3: "multiple" without correctAnswers']);
    expect(findAnswerKeyProblems({ ...single(1), correctAnswer: "Purpose limitation" }, 0)).toHaveLength(1);
    // Kontroll: mellomrom rundt teksten er ikke et funn, og et riktig spørsmål har ingen.
    expect(findAnswerKeyProblems({ ...multiple(1), correctAnswers: [" Purpose", "Legal basis "] }, 0)).toEqual([]);
    expect(findAnswerKeyProblems(single(1), 0)).toEqual([]);
  });

  it("normaliseringen former: de riktige i alternativenes rekkefølge, correctAnswer det første", () => {
    const q = normalizeGeneratedQuestionType(multiple(1));
    expect(q).toMatchObject({ questionType: "multiple", correctAnswers: ["Purpose", "Legal basis"], correctAnswer: "Purpose" });
  });

  it("«single» og annet tull fra modellen blir ett svar; correctAnswers på det kastes", () => {
    const q = normalizeGeneratedQuestionType({ ...single(1), questionType: "single", correctAnswers: ["Colour"] });
    expect(q).not.toHaveProperty("questionType");
    expect(q).not.toHaveProperty("correctAnswers");
  });

  it("alle alternativene riktige er lov", () => {
    const q = normalizeGeneratedQuestionType({ ...multiple(1), correctAnswers: ["Font", "Purpose", "Colour", "Legal basis"] });
    expect(q.correctAnswers).toEqual(["Purpose", "Colour", "Legal basis", "Font"]);
  });

  it("generering: en fasit som ikke stemmer, gir ett forsøk til med beskjed om hva som var galt", async () => {
    llm.replies.push(
      { questions: [{ ...multiple(1), correctAnswers: ["Purpose", "Legal basis."] }, single(2), single(3)] },
      { questions: [multiple(1), single(2), single(3)] },
    );
    const result = await generateMcqQuestions(generationInput(3));
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain("Answer key retry");
    expect(llm.prompts[1]).toContain('correctAnswers ["Legal basis."]');
    expect(result.questions[0]!.correctAnswers).toEqual(["Purpose", "Legal basis"]);
    expect(result).not.toHaveProperty("answerKeyProblems");
  });

  it("generering: stemmer fasiten ikke etter andre forsøk heller, avvises svaret", async () => {
    const bad = { questions: [{ ...multiple(1), correctAnswers: ["Purpose", "Legal basis."] }, single(2), single(3)] };
    llm.replies.push(bad, bad);
    await expect(generateMcqQuestions(generationInput(3))).rejects.toThrow(/answer key that does not match the options/);
  });

  it("kutt av for mange alternativer beholder ALLE de riktige", () => {
    const raw = { questions: [{ ...multiple(1), options: ["a", "b", "c", "d", "e", "f", "g"], correctAnswers: ["f", "g"], correctAnswer: "f" }] };
    const clamped = clampMcqOptionCount(raw) as { questions: Array<{ options: string[] }> };
    expect(clamped.questions[0]!.options).toHaveLength(6);
    expect(clamped.questions[0]!.options).toEqual(expect.arrayContaining(["f", "g"]));
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

  // QA 2.100.0, S3: modellen skrev om alternativ c og lot fasiten peke på den gamle teksten.
  it("målrettet endring der fasiten ikke følger med: ett forsøk til, så avvist", async () => {
    const rewritten = source.map((q, i) => (i === 0 ? { ...q, options: ["Purpose", "Colour", "The lawful basis for processing", "Font"] } : q));
    llm.replies.push({ questions: rewritten }, { questions: rewritten });
    await expect(reviseMcqQuestions(revisionInput("endre 1c"))).rejects.toThrow(/answer key that does not match the options/);
    expect(llm.prompts[1]).toContain("Answer key retry");
    // Grunnen var fasiten, ikke at endringen manglet.
    expect(llm.prompts[1]).not.toContain("did not apply the requested change concretely enough");
  });

  it("målrettet endring der fasiten følger med i andre forsøk, godtas", async () => {
    const rewritten = source.map((q, i) => (i === 0 ? { ...q, options: ["Purpose", "Colour", "The lawful basis for processing", "Font"] } : q));
    const fixed = rewritten.map((q, i) => (i === 0 ? { ...q, correctAnswers: ["Purpose", "The lawful basis for processing"] } : q));
    llm.replies.push({ questions: rewritten }, { questions: fixed });
    const result = await reviseMcqQuestions(revisionInput("endre 1c"));
    expect(result.questions[0]!.correctAnswers).toEqual(["Purpose", "The lawful basis for processing"]);
  });

  it("over taket i første forsøk, innenfor i andre: godtas", async () => {
    const six = source.map((q, i) => (i < 6 ? { ...multiple(i + 1), correctAnswer: "Purpose" } : q));
    const five = source.map((q, i) => (i < 5 ? { ...multiple(i + 1), correctAnswer: "Purpose" } : q));
    llm.replies.push({ questions: six }, { questions: five });
    const result = await reviseMcqQuestions(revisionInput("Use more select-all questions"));
    expect(result.questions.filter((q) => q.questionType === "multiple")).toHaveLength(5);
    expect(llm.prompts[1]).toContain("your previous attempt had 6");
  });

  it("et sett forsøkeren alt har gjort til over halvparten, avvises ikke av en revisjon av språket", async () => {
    const mostly: typeof source = Array.from({ length: 10 }, (_, i) => (i < 7 ? { ...multiple(i + 1), correctAnswer: "Purpose" } : single(i + 1)));
    const reworded = mostly.map((q) => ({ ...q, rationale: `${q.rationale} Simpler wording for every reader.` }));
    llm.replies.push({ questions: reworded });
    const result = await reviseMcqQuestions({ ...revisionInput("Simplify the language"), questions: mostly as unknown as RevisableMcqQuestion[] });
    expect(result.questions.filter((q) => q.questionType === "multiple")).toHaveLength(7);
    expect(llm.prompts).toHaveLength(1);
  });

  it("en revisjon som ikke endrer noe i et sett med «velg alle»: nytt forsøk, så «ingen endring»", async () => {
    llm.replies.push({ questions: source }, { questions: source });
    await expect(reviseMcqQuestions(revisionInput("Make it better"))).rejects.toThrow(/produced no change/);
    expect(llm.prompts).toHaveLength(2);
  });

  it("«gjør 1b riktig også» endrer bare fasiten — og er en ekte endring", () => {
    const sourceQuestions = [{ ...multiple(1), questionType: "multiple" as const, correctAnswer: "Purpose", correctAnswers: ["Purpose", "Legal basis"] }];
    const revised = [{ ...sourceQuestions[0]!, correctAnswers: ["Purpose", "Colour", "Legal basis"] }];
    expect(hasMeaningfulMcqRevision(sourceQuestions, revised, "gjør 1b riktig også")).toBe(true);
    expect(hasMeaningfulMcqRevision(sourceQuestions, sourceQuestions, "gjør 1b riktig også")).toBe(false);
  });

  it("«gjør spørsmål 2 til velg alle» er en ekte endring, selv om teksten står", () => {
    const sourceQuestions = [single(1), single(2)];
    const revised = [single(1), { ...single(2), questionType: "multiple" as const, correctAnswers: ["Purpose", "Colour"] }];
    expect(hasMeaningfulMcqRevision(sourceQuestions, revised, "gjør spørsmål 2 til velg alle som stemmer")).toBe(true);
    // Kontroll: uendret er fortsatt uendret.
    expect(hasMeaningfulMcqRevision(sourceQuestions, sourceQuestions, "gjør spørsmål 2 til velg alle som stemmer")).toBe(false);
  });
});
