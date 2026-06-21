import { describe, expect, it } from "vitest";
import { detectCorrectAnswerLengthBias } from "../../src/modules/adminContent/llmContentGenerationService.js";

// #551: deterministic guard — flag MCQ sets where the correct answer is the longest option in a
// high proportion of questions (a classic "length cue" that lets candidates guess).

function q(correct: string, ...distractors: string[]) {
  return { options: [correct, ...distractors], correctAnswer: correct };
}

describe("detectCorrectAnswerLengthBias (#551)", () => {
  it("flags a set where the correct answer is consistently the longest", () => {
    const questions = [
      q("A long, carefully-qualified correct answer", "Short", "Tiny", "Brief"),
      q("Another notably longer correct option here", "No", "Maybe", "Yes"),
      q("The detailed and precise correct choice text", "A", "B", "C"),
    ];
    const result = detectCorrectAnswerLengthBias(questions);
    expect(result.biased).toBe(true);
    expect(result.longestCorrectRatio).toBe(1);
  });

  it("does not flag a balanced set (similar option lengths)", () => {
    const questions = [
      q("Option alpha here", "Option beta here", "Option gamma now", "Option delta xx"),
      q("Choice one is fine", "Choice two is fine", "Choice three okk", "Choice four okkk"),
      q("Pick aaaa bbbb cc", "Pick dddd eeee ff", "Pick gggg hhhh ii", "Pick jjjj kkkk ll"),
    ];
    expect(detectCorrectAnswerLengthBias(questions).biased).toBe(false);
  });

  it("does not flag below the ratio threshold (only some questions biased)", () => {
    const questions = [
      q("A very long correct answer that stands out clearly", "Short", "Tiny", "Brief"),
      q("Even", "Even text", "Even longer text", "Even longest text here"), // correct shortest
      q("Same size A", "Same size B", "Same size C", "Same size D"),
      q("Same len 1", "Same len 2", "Same len 3", "Same len 4"),
    ];
    expect(detectCorrectAnswerLengthBias(questions).biased).toBe(false);
  });

  it("does not flag short sets (below minQuestions)", () => {
    const questions = [q("A long correct answer that stands out", "x", "y")];
    expect(detectCorrectAnswerLengthBias(questions).biased).toBe(false);
  });

  it("respects a custom threshold", () => {
    const questions = [
      q("Long correct answer one here", "a", "b"),
      q("Long correct answer two here", "c", "d"),
      q("Short", "A longer distractor wins", "b"), // correct not longest
    ];
    // 2/3 ≈ 0.67 — below default 0.7, above a 0.6 threshold.
    expect(detectCorrectAnswerLengthBias(questions).biased).toBe(false);
    expect(detectCorrectAnswerLengthBias(questions, { ratioThreshold: 0.6 }).biased).toBe(true);
  });
});
