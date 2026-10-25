import { describe, expect, it } from "vitest";
import { gradeMcqAnswer, shuffleOrderItems } from "../../src/modules/assessment/mcqQuestionTypes.js";

// #1077 leveranse 2: i «sett i riktig rekkefølge» ER rekkefølgen fasiten. Stokkingen må derfor aldri gi
// den riktige — også når tilfeldigheten treffer den — og rettingen er rett eller galt.

describe("shuffleOrderItems", () => {
  it("stokker på nytt når tilfeldigheten gir den riktige rekkefølgen", () => {
    // Fisher–Yates med random() = 0.99 lar hvert element bli stående: første runde gir identiteten.
    const rolls = [0.99, 0.99, 0.99, 0, 0, 0];
    let i = 0;
    const result = shuffleOrderItems(["a", "b", "c", "d"], () => rolls[i++ % rolls.length]!);
    expect(result).not.toEqual(["a", "b", "c", "d"]);
    expect([...result].sort()).toEqual(["a", "b", "c", "d"]);
    expect(i).toBeGreaterThan(3);
  });

  it("med ekte tilfeldighet: aldri den riktige, alltid de samme elementene", () => {
    for (let n = 0; n < 500; n++) {
      const result = shuffleOrderItems(["a", "b", "c"]);
      expect(result).not.toEqual(["a", "b", "c"]);
      expect([...result].sort()).toEqual(["a", "b", "c"]);
    }
  });
});

describe("gradeMcqAnswer — order", () => {
  const question = { questionType: "order", optionsJson: JSON.stringify(["Motta", "Vurdere", "Avgjøre"]), correctAnswer: "Motta" };
  it("riktig bare når hele rekkefølgen stemmer", () => {
    expect(gradeMcqAnswer(question, { orderedAnswers: ["Motta", "Vurdere", "Avgjøre"] })).toEqual({
      isCorrect: true, selectedAnswer: "Motta → Vurdere → Avgjøre", answerJson: JSON.stringify({ order: [0, 1, 2] }),
    });
    expect(gradeMcqAnswer(question, { orderedAnswers: ["Vurdere", "Motta", "Avgjøre"] }).isCorrect).toBe(false);
    expect(gradeMcqAnswer(question, { orderedAnswers: ["Motta", "Vurdere"] }).isCorrect).toBe(false);
    expect(gradeMcqAnswer(question, { orderedAnswers: ["Motta", "Motta", "Avgjøre"] }).isCorrect).toBe(false);
    expect(gradeMcqAnswer(question, { orderedAnswers: [] }).isCorrect).toBe(false);
    // Et svar sendt som et annet type svar, er ikke en rekkefølge.
    expect(gradeMcqAnswer(question, { selectedAnswer: "Motta" }).isCorrect).toBe(false);
  });
});
