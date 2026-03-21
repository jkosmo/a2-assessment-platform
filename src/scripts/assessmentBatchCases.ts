export type BatchExpectedOutcome = "PASS" | "FAIL" | "UNDER_REVIEW";

export type AssessmentBatchCase = {
  id: string;
  description: string;
  expectedOutcome: BatchExpectedOutcome;
  mcqScaledScore: number;
  mcqPercentScore: number;
  moduleId: string;
  responseJson: Record<string, unknown>;
  moduleTaskText: string;
  moduleGuidanceText: string;
};

export const assessmentBatchCases: AssessmentBatchCase[] = [
  {
    id: "red_insufficient_content",
    description: "Minimal, clearly incomplete submission should fail automatically.",
    expectedOutcome: "FAIL",
    mcqScaledScore: 0,
    mcqPercentScore: 0,
    moduleId: "seed_module_genai_foundations",
    responseJson: {
      response: "Hepp Hepp Hepp som det. Hvorfor er alt rødt nå",
    },
    moduleTaskText: "Complete the assignment and submit your response.",
    moduleGuidanceText: "Include concrete examples and reasoning that support your answer.",
  },
  {
    id: "yellow_sensitive_data",
    description: "Sensitive-data handling case should go to manual review.",
    expectedOutcome: "UNDER_REVIEW",
    mcqScaledScore: 18,
    mcqPercentScore: 60,
    moduleId: "seed_module_genai_foundations",
    responseJson: {
      response:
        "I copied a customer list containing full names, email addresses, and personal identification numbers into a shared public document to prepare a summary for a project handoff. I then distributed the output to the full project team without masking any identifiable details or obtaining approval for the data handling.",
    },
    moduleTaskText: "Complete the assignment and submit your response.",
    moduleGuidanceText:
      "Responsible-use and data-handling concerns should be surfaced clearly when content includes sensitive or non-compliant handling.",
  },
  {
    id: "green_clear_pass",
    description: "Substantive, well-structured submission should pass.",
    expectedOutcome: "PASS",
    mcqScaledScore: 30,
    mcqPercentScore: 100,
    moduleId: "seed_module_genai_foundations",
    responseJson: {
      response:
        "I completed the task by first reviewing the brief and identifying the core objective, then structured my approach into three stages: initial draft, quality review, and final output. In the first stage I produced a draft addressing each required element. In the second stage I compared the draft against the original requirements, corrected two factual gaps, and tightened the action items. In the third stage I confirmed the output met the acceptance criteria and removed content that was not grounded in the source material. The final result was a clear, evidence-based response that directly addressed the task with concrete examples and a documented review step.",
    },
    moduleTaskText: "Complete the assignment and submit your response.",
    moduleGuidanceText: "Include concrete examples and reasoning that support your answer.",
  },
];
