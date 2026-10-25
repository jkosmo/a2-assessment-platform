import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";
import type { RevisableMcqQuestion } from "../../src/modules/adminContent/llmContentGenerationService.js";

// #1077 leveranse 2b: KI-generering og KI-revisjon med «sett i riktig rekkefølge». Produkteier 2026-10-25:
// høyst én per test, bare der kilden har en fast rekkefølge, og KI sier fra når den ikke fant noen;
// revisjon som for «velg alle». Modellen byttes ut med faste svar — det som måles er hva plattformen ber
// om, og hva den gjør med det som kommer tilbake.

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
  multiplePlanProblems,
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
const order = (n: number, items = ["Receive the complaint", "Check the deadline", "Hear the party", "Decide"]) => ({
  questionType: "order",
  stem: `Put the steps of complaint ${n} in order.`,
  options: items,
  rationale: "The procedure section lists them in this order.",
});

const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};
// For 3 spørsmål: ett «velg alle» på plass 2 (indeks 1), 2 riktige av 4 — samme plan som testene for leveranse 1b.
const PLAN_Q2_TWO_CORRECT = [0, 0.9, 0, 0.3];
const generationInput = (questionCount: number, random: () => number = sequence(PLAN_Q2_TWO_CORRECT)) => ({
  sourceMaterial: "The complaint procedure: receive the complaint, check the deadline, hear the party, decide.",
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

describe("#1077 leveranse 2b — generering", () => {
  it("instruksen sier: høyst én rekkefølge, bare der kilden har en, aldri på en planlagt «velg alle», og si fra ellers", () => {
    const { userPrompt } = buildMcqGenerationPrompts(generationInput(3), [{ index: 1, correctCount: 2 }]);
    expect(userPrompt).toContain('AT MOST 1 question "questionType": "order"');
    expect(userPrompt).toContain('never in place of a planned "multiple" question');
    expect(userPrompt).toContain('"noOrderReason"');
    expect(userPrompt).toContain("IN THE CORRECT ORDER");
    // Kontroll: også uten plan for «velg alle» står regelen der.
    expect(buildMcqGenerationPrompts(generationInput(1), []).userPrompt).toContain('"questionType": "order"');
  });

  it("en rekkefølge utenfor planen tas imot: typen beholdes, correctAnswer er første element", async () => {
    llm.replies.push({ questions: [order(1), multiple(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.questions[0]).toMatchObject({ questionType: "order", correctAnswer: "Receive the complaint", options: order(1).options });
    expect(result.questions[0]).not.toHaveProperty("correctAnswers");
    expect(result.noOrderReason).toBeUndefined();
    expect(llm.prompts).toHaveLength(1);
  });

  it("ingen rekkefølge: grunnen fra modellen følger med til forfatteren", async () => {
    llm.replies.push({ questions: [single(1), multiple(2), single(3)], noOrderReason: "The source describes principles, not steps." });
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.noOrderReason).toBe("The source describes principles, not steps.");
    expect(llm.prompts).toHaveLength(1);
  });

  it("to rekkefølger: ett nytt forsøk som sier det; følges det, er det godt", async () => {
    llm.replies.push({ questions: [order(1), multiple(2), order(3)] }, { questions: [order(1), multiple(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain('at most 1 question may be "order", not 2');
    expect(result.questions.filter((q) => q.questionType === "order")).toHaveLength(1);
  });

  it("en rekkefølge på en planlagt «velg alle»-plass er et avvik", () => {
    const problems = multiplePlanProblems([single(1), order(2), single(3)] as never, [{ index: 1, correctCount: 2 }]);
    expect(problems.join(" ")).toContain('question 2 must be "multiple"');
  });

  it("to elementer, eller samme element to ganger, er feil fasit: nytt forsøk, så avslag", async () => {
    expect(findAnswerKeyProblems({ ...order(1), options: ["A", "B"] } as never, 0)).toEqual(['question 1: an "order" question has 3–6 items, not 2']);
    expect(findAnswerKeyProblems({ ...order(1), options: ["A", "B", "A"] } as never, 0)).toEqual(['question 1: an "order" question lists the same item twice']);
    expect(findAnswerKeyProblems(order(1) as never, 0)).toEqual([]);
    const bad = { ...order(1), options: ["A", "B"] };
    llm.replies.push({ questions: [bad, multiple(2), single(3)] }, { questions: [bad, multiple(2), single(3)] });
    await expect(generateMcqQuestions(generationInput(3))).rejects.toThrow(/answer key/);
  });

  it("en rekkefølge kuttes aldri — de siste stegene ville forsvunnet stille", () => {
    const raw = { questions: [{ ...order(1), options: ["1", "2", "3", "4", "5", "6", "7"] }] };
    clampMcqOptionCount(raw);
    expect(raw.questions[0]!.options).toHaveLength(7);
    // Kontroll: et vanlig spørsmål kuttes som før.
    const plain = { questions: [{ ...single(1), options: ["Purpose", "a", "b", "c", "d", "e", "f"] }] };
    clampMcqOptionCount(plain);
    expect(plain.questions[0]!.options).toHaveLength(6);
  });

  it("normaliseringen gjør correctAnswer til første element, uansett hva modellen skrev", () => {
    expect(normalizeGeneratedQuestionType({ ...order(1), correctAnswer: "Decide" } as never)).toMatchObject({ questionType: "order", correctAnswer: "Receive the complaint" });
  });
});

describe("#1077 leveranse 2b — revisjon", () => {
  const source = [order(1), single(2), single(3)];
  const revisionInput = (instruction: string, questions: unknown[] = source) => ({
    questions: questions as unknown as RevisableMcqQuestion[],
    instruction,
    locale: "en-GB" as const,
  });

  it("modellen ser at rekkefølgen er fasiten, og at den skal beholdes", async () => {
    llm.replies.push({ questions: [{ ...order(1), stem: "Order the complaint steps, start to finish." }, single(2), single(3)] });
    const result = await reviseMcqQuestions(revisionInput("Rephrase question 1"));
    const prompt = llm.prompts[0]!;
    expect(prompt).toContain("Type: order (put in the right order) — the options above ARE the correct order");
    expect(prompt).toContain("never reorder them unless the instruction says the order is wrong");
    expect(prompt).toContain('At most 1 question may be "order"');
    expect(result.questions[0]).toMatchObject({ questionType: "order", options: order(1).options });
  });

  it("en revisjon som lager to rekkefølger: nytt forsøk, så avslag", async () => {
    const two = [order(1), { ...order(2), options: ["a", "b", "c"] }, single(3)];
    llm.replies.push({ questions: two }, { questions: two });
    await expect(reviseMcqQuestions(revisionInput("Make the test harder"))).rejects.toThrow(/«put in the right order» \(at most 1\)/);
    expect(llm.prompts[1]).toContain('at most 1 "order"');
  });

  it("kontroll: et sett forfatteren selv har gitt to rekkefølger, tvinges ikke ned", async () => {
    const two = [order(1), { ...order(2), options: ["a", "b", "c"] }, single(3)];
    llm.replies.push({ questions: two.map((q, i) => (i === 2 ? { ...q, stem: "Which statement is accurate about lawful processing in this case?" } : q)) });
    const result = await reviseMcqQuestions(revisionInput("Rephrase question 3", two));
    expect(result.questions.filter((q) => q.questionType === "order")).toHaveLength(2);
  });
});
