export type BatchExpectedOutcome = "PASS" | "FAIL" | "UNDER_REVIEW";

export type AssessmentBatchCase = {
  id: string;
  description: string;
  expectedOutcome: BatchExpectedOutcome;
  mcqScaledScore: number;
  mcqPercentScore: number;
  moduleId: string;
  rawText: string;
  reflectionText: string;
  promptExcerpt: string;
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
    rawText: "Hepp Hepp Hepp som det. Hvorfor er alt rødt nå",
    reflectionText: "Hepp hopp topp",
    promptExcerpt: "Promp",
    moduleTaskText:
      "Write a practical reflection showing how generative AI was used, what changed through iteration, and how the work was quality assured.",
    moduleGuidanceText:
      "A good submission includes a substantive answer, explicit iteration notes, QA checks, and enough detail for reliable scoring.",
  },
  {
    id: "yellow_sensitive_data",
    description: "Sensitive-data handling case should go to manual review.",
    expectedOutcome: "UNDER_REVIEW",
    mcqScaledScore: 18,
    mcqPercentScore: 60,
    moduleId: "seed_module_genai_foundations",
    rawText:
      "I copied a customer list with names, email addresses, and personal identification numbers into a public generative AI tool to summarize it faster. I then planned to reuse the output without masking or approval.",
    reflectionText:
      "I did not perform a quality assurance step before sharing the result. I am unsure whether this handling is acceptable, but I thought the productivity gain justified it.",
    promptExcerpt:
      "Summarize this client data set, keep the identifiable details, and produce a shareable output for the project team.",
    moduleTaskText:
      "Describe a realistic AI-assisted work process and reflect on quality assurance and responsible use.",
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
    rawText:
      "I used generative AI to improve a draft workshop agenda and summary for an internal stakeholder meeting. First I summarized the original notes, then I asked the model to restructure the agenda by objective, decision point, and time box. I compared the draft against the meeting goal and removed vague items. After that I ran a second prompt to create a concise decision log and checked each item against the original notes before accepting it. The final output was a clearer agenda and a corrected summary that reduced preparation time while keeping the final wording under my control.",
    reflectionText:
      "The first prompt produced a generic agenda, so I refined it with explicit instructions about outcome, participants, and decision points. I then performed manual QA by comparing the AI output to the original notes, correcting one invented dependency and tightening the action items. The second iteration was substantially better because the prompt added structure and acceptance criteria. I would reuse the pattern, but only with a final human review before distribution.",
    promptExcerpt:
      "Rewrite this internal meeting draft into a professional agenda and decision log. Keep only evidence present in the source, add section headings, and avoid inventing facts.",
    moduleTaskText:
      "Write a practical reflection showing how generative AI was used, what changed through iteration, and how the work was quality assured.",
    moduleGuidanceText:
      "A strong submission is concrete, shows iteration, documents QA checks, and explains responsible use decisions.",
  },
];
