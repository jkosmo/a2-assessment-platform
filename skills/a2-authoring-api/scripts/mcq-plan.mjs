#!/usr/bin/env node
// mcq-plan.mjs — which questions in a new test are «select all that apply», and how many options in
// each are correct (#1077, product owner 2026-10-24).
//
// A random number of the questions, between 10 % and 50 % of the set, in random positions, are
// "multiple"; each has a random number of correct options, from one to all. A fixed share or fixed
// positions would become a pattern a learner learns — and a language model is a poor source of
// randomness, so the draw is made here, not by you.
//
// The same draw as the platform's `planMultipleQuestions` (src/modules/adminContent/
// llmContentGenerationService.ts); a repo unit test holds the two together.
//
// Usage: node scripts/mcq-plan.mjs <questionCount> [optionCount=4]
// Prints one line per planned question, e.g. «Question 4: select all that apply — 3 of 4 correct»,
// and the same plan as JSON on the last line.

/**
 * @param {number} questionCount
 * @param {number} optionCount
 * @param {() => number} [random]
 * @returns {Array<{ index: number, correctCount: number }>} 0-based question index
 */
export function planMultipleQuestions(questionCount, optionCount, random = Math.random) {
  const min = Math.ceil(questionCount * 0.1);
  const max = Math.floor(questionCount * 0.5);
  if (max < 1 || max < min) return [];
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));
  const count = between(min, max);
  const indexes = Array.from({ length: questionCount }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((index) => ({ index, correctCount: between(1, optionCount) }));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const questionCount = Number.parseInt(process.argv[2] ?? "", 10);
  const optionCount = Number.parseInt(process.argv[3] ?? "4", 10);
  if (!Number.isInteger(questionCount) || questionCount < 1 || !Number.isInteger(optionCount) || optionCount < 2) {
    console.error("Usage: node scripts/mcq-plan.mjs <questionCount> [optionCount=4]");
    process.exit(2);
  }
  const plan = planMultipleQuestions(questionCount, optionCount);
  if (plan.length === 0) console.log(`All ${questionCount} questions have one correct answer.`);
  for (const entry of plan) {
    console.log(`Question ${entry.index + 1}: select all that apply — ${entry.correctCount} of ${optionCount} correct${entry.correctCount === optionCount ? " (every option)" : ""}`);
  }
  console.log(JSON.stringify(plan.map((entry) => ({ question: entry.index + 1, correctCount: entry.correctCount }))));
}
