// Typer for mcq-plan.mjs (samme mønster som mcq-cue-check.d.mts).
export declare function planMultipleQuestions(
  questionCount: number,
  optionCount: number,
  random?: () => number,
): Array<{ index: number; correctCount: number }>;
