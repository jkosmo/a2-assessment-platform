import { beforeEach, describe, expect, it, vi } from "vitest";
import { warmModuleGraph } from "../support/moduleGraphWarmup.js";
import type { RevisableMcqQuestion } from "../../src/modules/adminContent/llmContentGenerationService.js";

// #1077 leveranse 3b: KI-generering og KI-revisjon med «fyll inn ordet som mangler». Produkteier 2026-10-31:
// høyst ett per test, bare der kilden har et entydig ord, og KI sier fra når den ikke fant noe; de godkjente
// svarene er alle vanlige skrivemåter av det samme svaret. Revisjon som for «sett i rekkefølge». Modellen
// byttes ut med faste svar — det som måles er hva plattformen ber om, og hva den gjør med det som kommer.

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
  multiplePlanProblems,
  reviseMcqQuestions,
} = await import("../../src/modules/adminContent/llmContentGenerationService.js");

const single = (n: number) => ({
  stem: `Which statement about the appeal is accurate in case ${n}?`,
  options: ["It goes to the body that decided", "It goes to the ombudsman", "It goes to the court", "It goes to the minister"],
  correctAnswer: "It goes to the body that decided",
  rationale: "The act says the appeal is sent to the body that made the decision.",
});
const multiple = (n: number) => ({
  questionType: "multiple",
  stem: `Which elements must the appeal contain in case ${n}?`,
  options: ["The decision appealed", "A colour", "The change asked for", "A font"],
  correctAnswers: ["The decision appealed", "The change asked for"],
  rationale: "The act lists the decision and the change asked for.",
});
const fill = (n: number, answers = ["three", "3"]) => ({
  questionType: "fill",
  stem: `In case ${n}, the deadline for an appeal is ___ weeks.`,
  options: answers,
  rationale: "The act states three weeks.",
});

const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};
// For 3 spørsmål: ett «velg alle» på plass 2 (indeks 1), 2 riktige av 4 — samme plan som testene for leveranse 2b.
const PLAN_Q2_TWO_CORRECT = [0, 0.9, 0, 0.3];
const generationInput = (questionCount: number, random: () => number = sequence(PLAN_Q2_TWO_CORRECT)) => ({
  sourceMaterial: "The deadline for an appeal is three weeks. The appeal is sent to the body that made the decision.",
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

describe("#1077 leveranse 3b — generering", () => {
  it("instruksen sier: høyst ett, bare der kilden har ordet, aldri på en planlagt «velg alle», alle skrivemåter, og si fra ellers", () => {
    const { userPrompt } = buildMcqGenerationPrompts(generationInput(3), [{ index: 1, correctCount: 2 }]);
    expect(userPrompt).toContain('AT MOST 1 question "questionType": "fill"');
    expect(userPrompt).toContain('never in place of a planned "multiple" question, and never as the "order" question');
    expect(userPrompt).toContain('"noFillReason"');
    expect(userPrompt).toContain("exactly one blank written as three underscores (___)");
    expect(userPrompt).toContain('every common way to write that same answer — the number in words and in digits ("three", "3")');
    expect(userPrompt).toContain("Never a word with another meaning.");
    // Kontroll: også uten plan for «velg alle» står regelen der.
    expect(buildMcqGenerationPrompts(generationInput(1), []).userPrompt).toContain('AT MOST 1 question "questionType": "fill"');
  });

  it("et «fyll inn» utenfor planen tas imot: typen og de godkjente svarene beholdes, correctAnswer er det første", async () => {
    llm.replies.push({ questions: [fill(1), multiple(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.questions[0]).toMatchObject({ questionType: "fill", correctAnswer: "three", options: ["three", "3"] });
    expect(result.questions[0]).not.toHaveProperty("correctAnswers");
    expect(result.noFillReason).toBeUndefined();
    expect(llm.prompts).toHaveLength(1);
  });

  it("ingen «fyll inn»: grunnen fra modellen følger med til forfatteren", async () => {
    llm.replies.push({ questions: [single(1), multiple(2), single(3)], noFillReason: "The key points are judgements, not terms or figures." });
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.noFillReason).toBe("The key points are judgements, not terms or figures.");
    expect(llm.prompts).toHaveLength(1);
  });

  it("grunnen følger med også når modellen ga ett spørsmål for mye og settet kuttes", async () => {
    llm.replies.push({ questions: [single(1), multiple(2), single(3), single(4)], noFillReason: "No key term.", noOrderReason: "No steps." });
    const result = await generateMcqQuestions(generationInput(3));
    expect(result.questions).toHaveLength(3);
    expect(result).toMatchObject({ noFillReason: "No key term.", noOrderReason: "No steps." });
  });

  it("to «fyll inn»: ett nytt forsøk som sier det; følges det, er det godt", async () => {
    llm.replies.push({ questions: [fill(1), multiple(2), fill(3)] }, { questions: [fill(1), multiple(2), single(3)] });
    const result = await generateMcqQuestions(generationInput(3));
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain('at most 1 question may be "fill", not 2');
    expect(result.questions.filter((q) => q.questionType === "fill")).toHaveLength(1);
  });

  it("et «fyll inn» på en planlagt «velg alle»-plass er et avvik", () => {
    const problems = multiplePlanProblems([single(1), fill(2), single(3)] as never, [{ index: 1, correctCount: 2 }]);
    expect(problems.join(" ")).toContain('question 2 must be "multiple"');
    // Kontroll: utenfor planen er det ikke et avvik.
    expect(multiplePlanProblems([fill(1), multiple(2), single(3)] as never, [{ index: 1, correctCount: 2 }])).toEqual([]);
  });

  it("uten lukke, eller med to, er feil fasit: nytt forsøk, så avslag", async () => {
    const bad = { ...fill(1), stem: "The deadline for an appeal is three weeks." };
    llm.replies.push({ questions: [bad, multiple(2), single(3)] }, { questions: [bad, multiple(2), single(3)] });
    await expect(generateMcqQuestions(generationInput(3))).rejects.toThrow(/answer key/);
    expect(llm.prompts[1]).toContain('a "fill" question has exactly one blank (___) in its stem');
  });

  it("de godkjente svarene telles ikke som et lengdesignal («three» er lengre enn «3»)", async () => {
    // Fem spørsmål, random 0: planen er ett «velg alle» på plass 2 med ett riktig. Av de tre vanlige har to
    // det lengste alternativet som svar (67 % — under grensen på 70 %). Talt med, ville «fyll inn» gitt 75 %.
    const longest = (n: number) => ({ ...single(n), options: ["The body that made the decision", "Court", "Ombud", "King"], correctAnswer: "The body that made the decision" });
    const shortest = { ...single(5), options: ["Yes", "Not without consent", "Only on Sundays", "Only in writing"], correctAnswer: "Yes" };
    const oneCorrect = { ...multiple(2), correctAnswers: ["The decision appealed"] };
    llm.replies.push({ questions: [fill(1), oneCorrect, longest(3), longest(4), shortest] });
    const result = await generateMcqQuestions(generationInput(5, () => 0));
    expect(llm.prompts, "settet fulgte planen").toHaveLength(1);
    expect((result.validationWarnings ?? []).join(" ")).not.toContain("Length cue");
    // Kontroll: med et fjerde vanlig spørsmål der svaret er lengst, kommer advarselen.
    llm.replies.push({ questions: [longest(1), oneCorrect, longest(3), longest(4), shortest] });
    const control = await generateMcqQuestions(generationInput(5, () => 0));
    expect((control.validationWarnings ?? []).join(" ")).toContain("Length cue");
  });
});

describe("#1077 leveranse 3b — revisjon", () => {
  const source = [fill(1), single(2), single(3)];
  const revisionInput = (instruction: string, questions: unknown[] = source) => ({
    questions: questions as unknown as RevisableMcqQuestion[],
    instruction,
    locale: "en-GB" as const,
  });

  it("modellen får reglene, og kan gjøre om et spørsmål når forfatteren ber om det — høyst ett", async () => {
    llm.replies.push({ questions: [{ ...fill(1), stem: "The appeal deadline in case 1 is ___ weeks." }, single(2), single(3)] });
    const result = await reviseMcqQuestions(revisionInput("Rephrase question 1"));
    const prompt = llm.prompts[0]!;
    expect(prompt).toContain('At most 1 question may be "fill" in the result. Convert a question to "fill" only when the instruction asks for it (by name, or in general)');
    expect(prompt).toContain("exactly one blank written as three underscores (___)");
    expect(prompt).not.toContain('Never turn another question into "fill"');
    expect(result.questions[0]).toMatchObject({ questionType: "fill", options: ["three", "3"] });
  });

  it("en revisjon som lager to «fyll inn»: nytt forsøk, så avslag", async () => {
    const two = [fill(1), fill(2, ["consent"]), single(3)];
    llm.replies.push({ questions: two }, { questions: two });
    await expect(reviseMcqQuestions(revisionInput("Make the test harder"))).rejects.toThrow(/«fill in the missing word» \(at most 1\)/);
    expect(llm.prompts[1]).toContain('at most 1 "fill"');
  });

  it("kontroll: et sett forfatteren selv har gitt to «fyll inn», tvinges ikke ned", async () => {
    const two = [fill(1), fill(2, ["consent"]), single(3)];
    llm.replies.push({ questions: two.map((q, i) => (i === 2 ? { ...q, stem: "Which statement is accurate about where the appeal is sent in this case?" } : q)) });
    const result = await reviseMcqQuestions(revisionInput("Rephrase question 3", two));
    expect(result.questions.filter((q) => q.questionType === "fill")).toHaveLength(2);
  });
});
