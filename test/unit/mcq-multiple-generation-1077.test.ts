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
  multiplePlanProblems,
  normalizeGeneratedQuestionType,
  planMultipleQuestions,
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

// Styrt tilfeldighet: tallene brukes i rekkefølge, så planen blir den samme hver gang.
const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};
// For 3 spørsmål: ett «velg alle» (10–50 % av 3 er nøyaktig 1), stokkingen legger det på plass 2, og
// 0,3 gir 2 riktige av 4. Samme plan som `multiple(n)` er skrevet for.
const PLAN_Q2_TWO_CORRECT = [0, 0.9, 0, 0.3];
const generationInput = (questionCount: number, random: () => number = sequence(PLAN_Q2_TWO_CORRECT)) => ({
  sourceMaterial: "Article 30 requires the record to state the purpose and the legal basis.",
  certificationLevel: "basic" as const,
  locale: "en-GB" as const,
  generationMode: "ordinary" as const,
  questionCount,
  optionCount: 4,
  random,
});

beforeEach(() => {
  llm.replies = [];
  llm.prompts = [];
});

// Produkteier 2026-10-24, tredje avgjørelse: et TILFELDIG antall spørsmål (10–50 %), på tilfeldige
// plasser, er «velg alle», hvert med et tilfeldig antall riktige (ett til alle). Plattformen trekker
// planen, modellen konstruerer spørsmålene. «Kilden avgjør» ga null av tretti på stage.
describe("#1077 — generering: plattformen trekker planen, modellen følger den", () => {
  it("planen: 10–50 % av settet, ulike plasser i stigende rekkefølge, 1 til alle riktige", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const counts = new Set<number>();
    const correct = new Set<number>();
    for (let run = 0; run < 500; run += 1) {
      const plan = planMultipleQuestions(10, 4, random);
      counts.add(plan.length);
      expect(plan.length).toBeGreaterThanOrEqual(1);
      expect(plan.length).toBeLessThanOrEqual(5);
      expect(new Set(plan.map((e) => e.index)).size).toBe(plan.length);
      expect(plan.map((e) => e.index)).toEqual([...plan.map((e) => e.index)].sort((a, b) => a - b));
      for (const e of plan) {
        expect(e.index).toBeGreaterThanOrEqual(0);
        expect(e.index).toBeLessThan(10);
        correct.add(e.correctCount);
      }
    }
    // Hele spennet brukes — ikke et fast antall som deltakeren kan lære seg.
    expect([...counts].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...correct].sort()).toEqual([1, 2, 3, 4]);
  });

  it("kontroll: for få spørsmål gir ingen «velg alle»; 2 spørsmål gir ett", () => {
    expect(planMultipleQuestions(1, 4, () => 0.5)).toEqual([]);
    expect(planMultipleQuestions(2, 4, () => 0.5)).toHaveLength(1);
  });

  it("instruksen sier hvilke spørsmål og hvor mange riktige, og ber om fakta fra kilden", () => {
    const { userPrompt } = buildMcqGenerationPrompts(generationInput(10), [{ index: 2, correctCount: 2 }, { index: 6, correctCount: 4 }]);
    expect(userPrompt).toContain('- Question 3: "multiple", exactly 2 of 4 options correct.');
    expect(userPrompt).toContain('- Question 7: "multiple", exactly 4 of 4 options correct (every option is correct).');
    expect(userPrompt).toContain("Construct each planned question for that purpose: search the source material for facts");
    expect(userPrompt).toContain("must not reveal or hint at how many options are correct");
    expect(userPrompt).toContain("never in the singular");
  });

  it("kontroll: en tom plan ber bare om ett svar", () => {
    const { userPrompt } = buildMcqGenerationPrompts(generationInput(10), []);
    expect(userPrompt).toContain('Do not set "questionType"');
    expect(userPrompt).not.toContain("the platform's plan");
  });

  it("som planlagt: beholdes, med de riktige i alternativenes rekkefølge, uten nytt forsøk", async () => {
    llm.replies.push({ questions: [single(1), multiple(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(llm.prompts[0]).toContain('- Question 2: "multiple", exactly 2 of 4 options correct.');
    expect(result.questions[1]).toMatchObject({ questionType: "multiple", correctAnswers: ["Purpose", "Legal basis"], correctAnswer: "Purpose" });
    expect(result.questions[0]).not.toHaveProperty("questionType");
    expect(result.validationWarnings ?? []).toEqual([]);
    expect(llm.prompts).toHaveLength(1);
  });

  it("ingen «velg alle» (slik stage så ut): nytt forsøk med beskjed, og andre forsøk godtas", async () => {
    llm.replies.push({ questions: [single(1), single(2), single(3)] }, { questions: [single(1), multiple(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain("Question type retry");
    expect(llm.prompts[1]).toContain('question 2 must be "multiple" with exactly 2 correct options, but has one correct answer');
    expect(result.validationWarnings ?? []).toEqual([]);
  });

  it("feil antall riktige: nytt forsøk", async () => {
    llm.replies.push({ questions: [single(1), { ...multiple(2), correctAnswers: ["Purpose", "Colour", "Legal basis"] }, single(3)] }, { questions: [single(1), multiple(2), single(3)] });
    await generateMcqQuestions(generationInput(3));
    expect(llm.prompts[1]).toContain("question 2 must have exactly 2 correct options, not 3.");
  });

  it("et «velg alle» på en plass som skulle ha ett svar: nytt forsøk", async () => {
    llm.replies.push({ questions: [multiple(1), multiple(2), single(3)] }, { questions: [single(1), multiple(2), single(3)] });
    await generateMcqQuestions(generationInput(3));
    expect(llm.prompts[1]).toContain('question 1 must have exactly one correct answer, not "multiple".');
  });

  it("bommer modellen to ganger, får forfatteren en advarsel — spørsmålene beholdes", async () => {
    const twoMultiple = { questions: [multiple(1), multiple(2), single(3)] };
    llm.replies.push(twoMultiple, twoMultiple);
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.questions).toHaveLength(3);
    expect((result.validationWarnings ?? []).join(" ")).toMatch(/differ from the plan/);
  });

  it("planlagt med ett riktig: et «velg alle» med ett riktig er riktig", () => {
    expect(multiplePlanProblems([single(1), { ...multiple(2), correctAnswers: ["Purpose"] }] as never, [{ index: 1, correctCount: 1 }])).toEqual([]);
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
      { questions: [single(1), { ...multiple(2), correctAnswers: ["Purpose", "Legal basis."] }, single(3)] },
      { questions: [single(1), multiple(2), single(3)] },
    );
    const result = await generateMcqQuestions(generationInput(3));
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain("Answer key retry");
    expect(llm.prompts[1]).toContain('correctAnswers ["Legal basis."]');
    expect(result.questions[1]!.correctAnswers).toEqual(["Purpose", "Legal basis"]);
    expect(result).not.toHaveProperty("answerKeyProblems");
  });

  it("generering: stemmer fasiten ikke etter andre forsøk heller, avvises svaret", async () => {
    const bad = { questions: [single(1), { ...multiple(2), correctAnswers: ["Purpose", "Legal basis."] }, single(3)] };
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

// Skillet trekker planen med sitt eget skript (en språkmodell er en dårlig terning). Samme trekning
// som plattformen: samme tilfeldige tall gir samme plan.
describe("#1077 — skillets mcq-plan.mjs trekker som plattformen", () => {
  it("samme tilfeldige tall gir samme plan, for mange settstørrelser", async () => {
    const skill = await import("../../skills/a2-authoring-api/scripts/mcq-plan.mjs");
    for (const [questionCount, optionCount] of [[3, 4], [6, 3], [10, 4], [15, 5], [20, 4]] as const) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const rng = () => { let s = seed * 7919; return () => ((s = (s * 48271) % 2147483647) / 2147483647); };
        expect(skill.planMultipleQuestions(questionCount, optionCount, rng())).toEqual(planMultipleQuestions(questionCount, optionCount, rng()));
      }
    }
  });
});
