import { describe, expect, it } from "vitest";
import { gradeMcqAnswer, isAcceptedFillAnswer, normalizeFillAnswer, withinOneEdit } from "../../src/modules/assessment/mcqQuestionTypes.js";
import { findAnswerKeyProblems, normalizeGeneratedQuestionType, buildMcqLocalizationPrompts } from "../../src/modules/adminContent/llmContentGenerationService.js";
import { mcqQuestionTypeFields, mcqSetBodySchema } from "../../src/modules/adminContent/adminContentSchemas.js";

// #1077 leveranse 3: «fyll inn ordet som mangler». Alternativene er de godkjente svarene; rettingen ser
// bort fra store og små bokstaver, mellomrom og tegnsetting på slutten, og godtar ett feil tegn i svar
// på sju tegn eller mer (produkteier 2026-10-31). Ingen KI.

describe("normalizeFillAnswer", () => {
  it("store og små bokstaver, mellomrom og tegnsetting på slutten teller ikke", () => {
    expect(normalizeFillAnswer("  Tre   Uker. ")).toBe("tre uker");
    expect(normalizeFillAnswer("SAMTYKKE!?")).toBe("samtykke");
    // Tegn inni svaret er en del av svaret.
    expect(normalizeFillAnswer("6(1)(b)")).toBe("6(1)(b)");
  });
});

describe("withinOneEdit", () => {
  it("ett tegn byttet, lagt til eller borte", () => {
    expect(withinOneEdit("samtykke", "samtyke")).toBe(true);
    expect(withinOneEdit("samtykke", "samtykkke")).toBe(true);
    expect(withinOneEdit("samtykke", "samtikke")).toBe(true);
    expect(withinOneEdit("samtykke", "samtikkk")).toBe(false);
    expect(withinOneEdit("abc", "abc")).toBe(true);
  });
});

describe("isAcceptedFillAnswer", () => {
  const answers = [JSON.stringify({ nb: "tre", nn: "tre", "en-GB": "three" }), "3"];
  it("et godkjent svar på et hvilket som helst språk, eller en annen godkjent skrivemåte", () => {
    expect(isAcceptedFillAnswer(answers, "Tre")).toBe(true);
    expect(isAcceptedFillAnswer(answers, "three")).toBe(true);
    expect(isAcceptedFillAnswer(answers, " 3. ")).toBe(true);
    expect(isAcceptedFillAnswer(answers, "fire")).toBe(false);
    expect(isAcceptedFillAnswer(answers, "")).toBe(false);
    expect(isAcceptedFillAnswer(answers, "   ")).toBe(false);
  });

  it("ett feil tegn godtas bare i svar på sju tegn eller mer", () => {
    expect(isAcceptedFillAnswer(["samtykke"], "samtyke")).toBe(true);
    expect(isAcceptedFillAnswer(["samtykke"], "Samtykket")).toBe(true);
    // «tre» med ett tegn feil er et annet ord.
    expect(isAcceptedFillAnswer(["tre"], "tro")).toBe(false);
    expect(isAcceptedFillAnswer(["avtale"], "avtala")).toBe(false);
    // To feil er for mye, også i lange ord.
    expect(isAcceptedFillAnswer(["samtykke"], "samtike")).toBe(false);
  });
});

describe("gradeMcqAnswer — fill", () => {
  const question = { questionType: "fill", optionsJson: JSON.stringify(["tre", "3"]), correctAnswer: "tre" };
  it("riktig når det skrevne er et godkjent svar; svaret lagres som skrevet", () => {
    expect(gradeMcqAnswer(question, { textAnswer: "  Tre " })).toEqual({
      isCorrect: true, selectedAnswer: "Tre", answerJson: JSON.stringify({ text: "Tre" }),
    });
    expect(gradeMcqAnswer(question, { textAnswer: "fire" }).isCorrect).toBe(false);
    expect(gradeMcqAnswer(question, { textAnswer: "" }).isCorrect).toBe(false);
    // Et svar sendt som et annet type svar, er ikke et skrevet svar.
    expect(gradeMcqAnswer(question, { selectedAnswer: "tre" }).isCorrect).toBe(false);
  });
});

describe("lagringsskjemaet — fill", () => {
  const set = (question: Record<string, unknown>) => mcqSetBodySchema.safeParse({ title: "Sett", questions: [{ rationale: "Fordi.", ...question }] });

  it("én lukke og ett godkjent svar er nok", () => {
    expect(set({ questionType: "fill", stem: "Fristen er ___ uker.", options: ["tre"] }).success).toBe(true);
    expect(set({ questionType: "fill", stem: { nb: "Fristen er ___ uker.", "en-GB": "The deadline is ___ weeks." }, options: [{ nb: "tre", "en-GB": "three" }, "3"] }).success).toBe(true);
  });

  it("uten lukke, med to lukker, eller lukke bare på ett språk: avvist", () => {
    expect(set({ questionType: "fill", stem: "Fristen er tre uker.", options: ["tre"] }).success).toBe(false);
    expect(set({ questionType: "fill", stem: "___ er ___ uker.", options: ["tre"] }).success).toBe(false);
    expect(set({ questionType: "fill", stem: { nb: "Fristen er ___ uker.", "en-GB": "The deadline is three weeks." }, options: ["tre"] }).success).toBe(false);
  });

  it("for mange eller like godkjente svar: avvist", () => {
    expect(set({ questionType: "fill", stem: "___", options: ["a", "b", "c", "d", "e", "f", "g"] }).success).toBe(false);
    expect(set({ questionType: "fill", stem: "___", options: ["tre", "tre"] }).success).toBe(false);
  });

  it("de andre typene krever fortsatt to alternativer", () => {
    expect(set({ stem: "Hva?", options: ["A"], correctAnswer: "A" }).success).toBe(false);
  });

  it("feltene som lagres: typen, det første svaret som correctAnswer, ingen egen fasit", () => {
    expect(mcqQuestionTypeFields({ questionType: "fill", options: ["tre", "3"] })).toEqual({ questionType: "fill", correctAnswer: "tre", answerKeyJson: null });
  });
});

describe("KI — fill i revisjon og oversettelse", () => {
  it("fasitkontrollen ser lukka og antallet svar", () => {
    const q = (stem: string, options: string[]) => ({ questionType: "fill", stem, options, rationale: "r" }) as never;
    expect(findAnswerKeyProblems(q("Fristen er ___ uker.", ["tre", "3"]), 0)).toEqual([]);
    expect(findAnswerKeyProblems(q("Fristen er tre uker.", ["tre"]), 0)[0]).toContain("exactly one blank");
    expect(findAnswerKeyProblems(q("___", ["tre", "tre"]), 0)[0]).toContain("twice");
  });

  it("typen beholdes, og det første svaret blir correctAnswer", () => {
    expect(normalizeGeneratedQuestionType({ questionType: "fill", stem: "___", options: ["tre", "3"], rationale: "r" } as never))
      .toMatchObject({ questionType: "fill", correctAnswer: "tre", options: ["tre", "3"] });
  });

  it("oversettelsen får regelen om lukka bare når et spørsmål har en", () => {
    const base = { sourceLocale: "nb" as const, targetLocale: "en-GB" as const };
    const withBlank = buildMcqLocalizationPrompts({ ...base, questions: [{ stem: "Fristen er ___ uker.", options: ["tre"], correctAnswer: "tre", rationale: "r" }] });
    expect(withBlank.userPrompt).toContain("keep exactly one blank (___)");
    const without = buildMcqLocalizationPrompts({ ...base, questions: [{ stem: "Hva?", options: ["A", "B"], correctAnswer: "A", rationale: "r" }] });
    expect(without.userPrompt).not.toContain("blank (___)");
  });
});
