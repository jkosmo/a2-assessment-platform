import { describe, expect, it } from "vitest";
import {
  buildMcqGenerationPrompts,
  buildMcqLocalizationPrompts,
  buildMcqRevisionPrompts,
  buildModuleDraftPrompts,
  buildModuleDraftLocalizationPrompts,
  buildModuleDraftRevisionPrompts,
  buildSectionLocalizationPrompts,
  normaliseLiteralNewlines,
  detectDominantLanguage,
  extractMcqRevisionTargets,
  hasMeaningfulMcqRevision,
  isLikelyWrongLocale,
  parseRetryAfterMs,
  computeLlmBackoffMs,
} from "../../src/modules/adminContent/llmContentGenerationService.js";

// #479: Azure OpenAI 429/5xx retry helpers. A single un-retried 429 used to abort the whole
// authoring pipeline (condense → blueprint → draft), which crawl made easy to trigger via large
// source material. These pin the Retry-After parsing + backoff bounds.
describe("LLM retry backoff", () => {
  it("parses Retry-After as delta-seconds", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  it("parses Retry-After as an HTTP-date (future → positive ms)", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms as number).toBeGreaterThanOrEqual(0);
    expect(ms as number).toBeLessThanOrEqual(5000);
  });

  it("returns null for missing/garbage Retry-After", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });

  it("honours Retry-After when present (capped)", () => {
    expect(computeLlmBackoffMs(0, 3000)).toBe(3000);
    // Capped at the 20s ceiling even if the server asks for more.
    expect(computeLlmBackoffMs(0, 999_999)).toBe(20_000);
  });

  it("falls back to exponential backoff with jitter, bounded", () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const ms = computeLlmBackoffMs(attempt, null);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(20_000);
    }
    // Later attempts trend larger (jitter floor of attempt 3 ≥ attempt 0 ceiling here).
    expect(computeLlmBackoffMs(3, null)).toBeGreaterThanOrEqual(computeLlmBackoffMs(0, null));
  });
});

describe("llm content generation prompts", () => {
  it("treats source material as hidden author background for module drafts", () => {
    const { userPrompt } = buildModuleDraftPrompts({
      sourceMaterial: "Internal policy notes about safe handling of customer data.",
      certificationLevel: "intermediate",
      locale: "en-GB",
      generationMode: "ordinary",
    });

    expect(userPrompt).toContain("The source material is for you only. The candidate will NOT see it.");
    expect(userPrompt).toContain("Write taskText so it is fully self-contained and usable on its own.");
    expect(userPrompt).toContain('Do not mention "source material"');
    expect(userPrompt).toContain("must be embedded directly in the generated task itself.");
    expect(userPrompt).toContain("use the scenario as the basis for their response");
    expect(userPrompt).toContain("## Source material (hidden author background)");
    expect(userPrompt).not.toContain("based on the source material below.");
  });

  it("includes generation mode guidance in module draft prompts", () => {
    const { userPrompt } = buildModuleDraftPrompts({
      sourceMaterial: "Internal policy notes about safe handling of customer data.",
      certificationLevel: "intermediate",
      locale: "en-GB",
      generationMode: "thorough",
    });

    expect(userPrompt).toContain("Generation mode: thorough");
    expect(userPrompt).toContain("Take a more thorough authoring pass");
  });

  it("uses certification level to calibrate module difficulty and guidance detail", () => {
    const basicPrompt = buildModuleDraftPrompts({
      sourceMaterial: "Internal policy notes about safe handling of customer data.",
      certificationLevel: "basic",
      locale: "en-GB",
      generationMode: "ordinary",
    }).userPrompt;

    const advancedPrompt = buildModuleDraftPrompts({
      sourceMaterial: "Internal policy notes about safe handling of customer data.",
      certificationLevel: "advanced",
      locale: "en-GB",
      generationMode: "ordinary",
    }).userPrompt;

    expect(basicPrompt).toContain("Use the certification level as the primary difficulty control.");
    expect(basicPrompt).toContain("Maximum scenario complexity: 1 actor");
    expect(advancedPrompt).toContain("It may involve ambiguity, competing considerations, or nuanced application");
    expect(advancedPrompt).toContain("Maximum scenario complexity: 3 actors");
  });

  it("extracts explicit MCQ targets from compact option references", () => {
    expect(extractMcqRevisionTargets("Endre alternativ 1C slik at det blir mer plausibelt.")).toEqual([
      { questionIndex: 0, optionIndex: 2 },
    ]);
    expect(extractMcqRevisionTargets("Change option B in question 3.")).toEqual([
      { questionIndex: 2, optionIndex: 1 },
    ]);
  });

  it("treats targeted MCQ revisions as invalid when the named option is unchanged", () => {
    const sourceQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A legal sanction", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    const revisedQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A legal sanction", "A revised salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    expect(
      hasMeaningfulMcqRevision(sourceQuestions, revisedQuestions, "Endre alternativ 1C slik at det blir mer plausibelt."),
    ).toBe(false);
  });

  it("treats targeted MCQ revisions as invalid when the named option is only cosmetically rephrased", () => {
    const sourceQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A legal sanction", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    const revisedQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A slightly revised legal sanction", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    expect(
      hasMeaningfulMcqRevision(sourceQuestions, revisedQuestions, "Endre alternativ 1C slik at det blir mer plausibelt."),
    ).toBe(false);
  });

  it("accepts targeted MCQ revisions when the named option is changed", () => {
    const sourceQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A legal sanction", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    const revisedQuestions = [
      {
        stem: "What best describes solidarity action?",
        options: ["A collective response", "A private complaint", "A coordinated workplace petition", "A salary bonus"],
        correctAnswer: "A collective response",
        rationale: "Solidarity action is collective rather than individual.",
      },
    ];

    expect(
      hasMeaningfulMcqRevision(sourceQuestions, revisedQuestions, "Endre alternativ 1C slik at det blir mer plausibelt."),
    ).toBe(true);
  });

  it("builds module draft localization prompts for target language translation", () => {
    const { userPrompt } = buildModuleDraftLocalizationPrompts({
      taskText: "Scenario:\n\nWorkers are discussing collective action.",
      assessorExpectedContent: "A strong answer should explain key principles.",
      sourceLocale: "nb",
      targetLocale: "en-GB",
    });

    expect(userPrompt).toContain("Translate the following certification module draft from Norwegian Bokm");
    expect(userPrompt).toContain("to British English");
    expect(userPrompt).toContain('If taskText starts with "Scenario:", preserve that label in the target language.');
    expect(userPrompt).toContain('"taskText": "translated task text in British English"');
  });

  it("builds MCQ localization prompts that preserve option structure", () => {
    const { userPrompt } = buildMcqLocalizationPrompts({
      questions: [
        {
          stem: "Hva er solidaritet?",
          options: ["Kollektiv handling", "Privat fordel", "Sanksjon", "Bonus"],
          correctAnswer: "Kollektiv handling",
          rationale: "Solidaritet handler om felles handling.",
        },
      ],
      sourceLocale: "nb",
      targetLocale: "nn",
    });

    expect(userPrompt).toContain("Translate the following multiple-choice questions from Norwegian Bokm");
    expect(userPrompt).toContain("to Norwegian Nynorsk");
    expect(userPrompt).toContain("Preserve the number of answer options for each question.");
    expect(userPrompt).toContain("correctAnswer must match one of the translated options verbatim.");
  });

  it("requires MCQs to be self-contained and not refer to hidden source material", () => {
    const { userPrompt } = buildMcqGenerationPrompts({
      sourceMaterial: "Reference notes about escalation thresholds and confidentiality duties.",
      certificationLevel: "advanced",
      locale: "en-GB",
      generationMode: "ordinary",
      questionCount: 4,
      optionCount: 4,
    });

    expect(userPrompt).toContain("The source material is for you only. The candidate will NOT see it.");
    expect(userPrompt).toContain(
      "Each question must be self-contained and understandable without any external text.",
    );
    expect(userPrompt).toContain(
      'Do not mention "source material", "text above", "document", "attachment", or any unseen reference material.',
    );
    expect(userPrompt).toContain("If background facts are needed, incorporate them directly into the question stem.");
    expect(userPrompt).toContain("## Source material (hidden author background)");
    expect(userPrompt).not.toContain("based on the source material below.");
  });

  it("includes generation mode guidance in MCQ prompts", () => {
    const { userPrompt } = buildMcqGenerationPrompts({
      sourceMaterial: "Reference notes about escalation thresholds and confidentiality duties.",
      certificationLevel: "advanced",
      locale: "en-GB",
      generationMode: "thorough",
      questionCount: 4,
      optionCount: 4,
    });

    expect(userPrompt).toContain("Generation mode: thorough");
    expect(userPrompt).toContain("Take a more thorough authoring pass");
  });

  it("uses certification level to calibrate MCQ difficulty without hardcoding four options", () => {
    const { userPrompt } = buildMcqGenerationPrompts({
      sourceMaterial: "Reference notes about escalation thresholds and confidentiality duties.",
      certificationLevel: "advanced",
      locale: "en-GB",
      generationMode: "ordinary",
      questionCount: 4,
      optionCount: 5,
    });

    expect(userPrompt).toContain("Questions should test nuanced understanding and discrimination.");
    expect(userPrompt).toContain("All 5 options in a question must be comparable in length and level of detail.");
    expect(userPrompt).toContain("Review each set of 5 options before finalising");
    expect(userPrompt).toContain("at least one distractor should be close enough that the candidate must reason carefully before choosing");
  });

  it("builds draft revision prompts around an explicit change instruction", () => {
    const { userPrompt } = buildModuleDraftRevisionPrompts({
      taskText: "Scenario:\n\nA workplace conflict has escalated.\n\nExplain how mediation could help.",
      assessorExpectedContent: "A strong answer should explain core mediation principles.",
      instruction: "Make the scenario more concrete and add clearer expectations about evidence.",
      locale: "en-GB",
    });

    expect(userPrompt).toContain("## Current draft");
    expect(userPrompt).toContain("## Revision instruction");
    expect(userPrompt).toContain("Make the scenario more concrete");
    expect(userPrompt).toContain('If the task includes a scenario, keep it at the top of taskText labelled "Scenario:".');
    expect(userPrompt).toContain('"includesScenario": true or false');
  });

  it("builds MCQ revision prompts that preserve count and option parity by default", () => {
    const { userPrompt } = buildMcqRevisionPrompts({
      questions: [
        {
          stem: "What best describes solidarity action?",
          options: ["A collective response", "A private complaint", "A legal sanction", "A salary bonus"],
          correctAnswer: "A collective response",
          rationale: "Solidarity action is collective rather than individual.",
        },
      ],
      instruction: "Make the distractors more plausible.",
      locale: "en-GB",
    });

    expect(userPrompt).toContain("Preserve the number of questions unless the instruction clearly asks for a different count.");
    expect(userPrompt).toContain("Preserve the number of answer options per question unless the instruction clearly asks for a different count.");
    expect(userPrompt).toContain('If the instruction points to a specific question or option reference such as "question 3", "Q3", "3b", "option B in question 3", or "third alternative in question 3", apply the change to that exact target.');
    expect(userPrompt).toContain("Target question count: 1");
    expect(userPrompt).toContain("Target option count per question: 4");
    expect(userPrompt).toContain("## Current questions (indexed review view)");
    expect(userPrompt).toContain("Question 1");
    expect(userPrompt).toContain("A. A collective response");
    expect(userPrompt).toContain("Make the distractors more plausible.");
  });

  // #245 — scenario generation decision
  describe("module draft scenario instructions (#245)", () => {
    it("instructs LLM to include scenario for situational/ethical content", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Theory of leadership ethics.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        generationMode: "ordinary",
      });

      expect(userPrompt).toContain("Include a scenario in taskText when:");
      expect(userPrompt).toContain("situational analysis, ethical reasoning, professional judgement");
      expect(userPrompt).toContain("Do NOT include a scenario when:");
      expect(userPrompt).toContain("factual recall or text summarisation");
    });

    it("instructs LLM to place scenario at top of taskText with Scenario: label", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Leadership frameworks.",
        certificationLevel: "advanced",
        locale: "nb",
        generationMode: "ordinary",
      });

      expect(userPrompt).toContain('Place it at the very top of taskText, clearly labelled "Scenario:"');
      expect(userPrompt).toContain("Keep it realistic, concise (4-8 sentences)");
    });

    it("requires includesScenario boolean in module draft return format", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Source.",
        certificationLevel: "basic",
        locale: "en-GB",
        generationMode: "ordinary",
      });

      expect(userPrompt).toContain('"includesScenario": true or false');
    });

    it("embeds certificationLevel and locale in module draft prompt", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Financial regulations.",
        certificationLevel: "advanced",
        locale: "nb",
        generationMode: "thorough",
      });

      expect(userPrompt).toContain("Certification level: advanced");
      expect(userPrompt).toContain("Norwegian Bokmål");
    });
  });

  // #246 — MCQ distractor calibration per certificationLevel
  describe("MCQ distractor calibration per certificationLevel (#246)", () => {
    it("basic level: allows clearly incorrect distractors but requires thematic relevance", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Intro to biology.",
        certificationLevel: "basic",
        locale: "en-GB",
        generationMode: "ordinary",
        questionCount: 3,
        optionCount: 4,
      });

      expect(userPrompt).toContain("Certification level: basic");
      expect(userPrompt).toContain("thematically plausible and relevant to the domain");
      expect(userPrompt).toContain("core recognition and basic understanding");
    });

    it("intermediate level: requires plausible misconceptions as distractors", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Sociology theory.",
        certificationLevel: "intermediate",
        locale: "nb",
        generationMode: "ordinary",
        questionCount: 4,
        optionCount: 4,
      });

      expect(userPrompt).toContain("Certification level: intermediate");
      expect(userPrompt).toContain("plausible to a partially informed candidate");
      expect(userPrompt).toContain("realistic misconception, wrong priority, or near-correct principle");
    });

    it("advanced level: requires expert-level confusion distractors", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Advanced contract law.",
        certificationLevel: "advanced",
        locale: "en-GB",
        generationMode: "thorough",
        questionCount: 5,
        optionCount: 4,
      });

      expect(userPrompt).toContain("Certification level: advanced");
      expect(userPrompt).toContain("genuine expert-level confusion");
      expect(userPrompt).toContain("A well-prepared candidate must reason carefully about each option");
    });

    it("distractor guidelines differ across levels", () => {
      const basic = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "basic", locale: "en-GB", generationMode: "ordinary", questionCount: 1, optionCount: 4 }).userPrompt;
      const intermediate = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "intermediate", locale: "en-GB", generationMode: "ordinary", questionCount: 1, optionCount: 4 }).userPrompt;
      const advanced = buildMcqGenerationPrompts({ sourceMaterial: "s", certificationLevel: "advanced", locale: "en-GB", generationMode: "thorough", questionCount: 1, optionCount: 4 }).userPrompt;

      // Each level has distinct guideline text
      expect(basic).not.toEqual(intermediate);
      expect(intermediate).not.toEqual(advanced);
    });

    it("enforces option parity rules for all levels", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        generationMode: "ordinary",
        questionCount: 4,
        optionCount: 5,
      });

      expect(userPrompt).toContain("## Option parity");
      expect(userPrompt).toContain("comparable in length and level of detail");
      expect(userPrompt).toContain("Each question must have exactly 5 answer options");
    });

    it("embeds the requested option count in the MCQ authoring prompt", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        generationMode: "ordinary",
        questionCount: 4,
        optionCount: 3,
      });

      expect(userPrompt).toContain("Generate EXACTLY 4 multiple-choice questions");
      expect(userPrompt).toContain("Each question must have exactly 3 answer options");
    });
  });

  describe("assessment blueprint consumption (#372)", () => {
    const blueprint = {
      learningObjectives: ["Apply privacy principles", "Identify processing risks"],
      keyTopics: ["GDPR Article 6", "data minimisation"],
      complexityBudget: { actors: 2, concepts: 3, tradeoffs: 1 },
      mcqProfile: {
        suggestedCount: 8,
        topicDistribution: { "GDPR Article 6": 0.5, "data minimisation": 0.5 },
      },
      notes: "Focus on practical, situational application.",
    };

    it("module-draft prompt embeds blueprint when provided", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        generationMode: "ordinary",
        blueprint,
      });

      expect(userPrompt).toContain("Assessment blueprint");
      expect(userPrompt).toContain("Apply privacy principles");
      expect(userPrompt).toContain("GDPR Article 6");
      expect(userPrompt).toContain("Actors in scenario: 2");
      expect(userPrompt).toContain("Focus on practical, situational application.");
    });

    it("module-draft prompt omits blueprint section when not provided", () => {
      const { userPrompt } = buildModuleDraftPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        generationMode: "ordinary",
      });

      expect(userPrompt).not.toContain("Assessment blueprint");
    });

    it("mcq prompt embeds blueprint topic distribution when provided", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        generationMode: "ordinary",
        questionCount: 8,
        optionCount: 4,
        blueprint,
      });

      expect(userPrompt).toContain("Assessment blueprint");
      expect(userPrompt).toContain("Apply privacy principles");
      expect(userPrompt).toContain("GDPR Article 6: ~50%");
      expect(userPrompt).toContain("data minimisation: ~50%");
    });

    it("mcq prompt omits blueprint section when not provided", () => {
      const { userPrompt } = buildMcqGenerationPrompts({
        sourceMaterial: "Any topic.",
        certificationLevel: "intermediate",
        locale: "en-GB",
        generationMode: "ordinary",
        questionCount: 4,
        optionCount: 4,
      });

      expect(userPrompt).not.toContain("Assessment blueprint");
    });
  });
});

describe("section localization prompts (#514)", () => {
  it("instructs markdown + placeholder preservation and targets the right locale", () => {
    const { systemPrompt, userPrompt } = buildSectionLocalizationPrompts({
      title: "Intro",
      bodyMarkdown: "# Heading\n\nSee {{asset:fig1}} and [link](https://a-2.no).",
      sourceLocale: "nb",
      targetLocale: "en-GB",
    });
    expect(systemPrompt.toLowerCase()).toContain("translator");
    expect(userPrompt).toContain("{{asset:...}}");
    expect(userPrompt.toLowerCase()).toContain("markdown");
    expect(userPrompt).toContain('"bodyMarkdown"');
    expect(userPrompt).toContain('"title"');
    // The actual content to translate is embedded.
    expect(userPrompt).toContain("{{asset:fig1}}");
  });

  it("omits a field that was not provided", () => {
    const { userPrompt } = buildSectionLocalizationPrompts({
      title: "Bare tittel",
      sourceLocale: "nb",
      targetLocale: "nn",
    });
    expect(userPrompt).toContain('"title"');
    expect(userPrompt).not.toContain('"bodyMarkdown"');
  });

  it("normalises literal backslash-n back to real newlines", () => {
    expect(normaliseLiteralNewlines("# Hei\\n\\nLes dette")).toBe("# Hei\n\nLes dette");
    // Real newlines are left untouched.
    expect(normaliseLiteralNewlines("# Hei\n\nLes dette")).toBe("# Hei\n\nLes dette");
    expect(normaliseLiteralNewlines(undefined)).toBeUndefined();
  });
});

describe("language enforcement directive (#444)", () => {
  it("injects a CRITICAL LANGUAGE RULE into module draft prompts", () => {
    const { userPrompt } = buildModuleDraftPrompts({
      sourceMaterial: "Internal policy notes.",
      certificationLevel: "intermediate",
      locale: "nb",
      generationMode: "ordinary",
    });

    expect(userPrompt).toContain("CRITICAL LANGUAGE RULE");
    expect(userPrompt).toContain("Norwegian Bokmål");
    expect(userPrompt).toContain("This rule overrides any tendency to mirror the source material's language.");
  });

  it("injects a CRITICAL LANGUAGE RULE into MCQ generation prompts", () => {
    const { userPrompt } = buildMcqGenerationPrompts({
      sourceMaterial: "Internal policy notes.",
      certificationLevel: "intermediate",
      locale: "nb",
      generationMode: "ordinary",
      questionCount: 4,
      optionCount: 4,
    });

    expect(userPrompt).toContain("CRITICAL LANGUAGE RULE");
    expect(userPrompt).toContain("Norwegian Bokmål");
  });

  it("targets the target locale (not source) in localization prompts", () => {
    const { userPrompt } = buildModuleDraftLocalizationPrompts({
      taskText: "Some English task.",
      assessorExpectedContent: "Hidden assessor notes.",
      sourceLocale: "en-GB",
      targetLocale: "nb",
    });

    expect(userPrompt).toContain("CRITICAL LANGUAGE RULE");
    // Should enforce the target (nb), not the source (en-GB)
    expect(userPrompt).toMatch(/in Norwegian Bokmål/);
  });
});

describe("detectDominantLanguage (#444)", () => {
  it("returns 'norwegian' for a clearly Norwegian paragraph", () => {
    const text = "En kommune skal innføre fjernhjemler. Det er viktig å vurdere balansen og ta avveininger som er praktiske. Vi kan ikke se bort fra at det er en risiko for at ansatte ved kontoret blir overarbeidet og at det går ut over kvaliteten i tjenestene som leveres til innbyggerne.";
    expect(detectDominantLanguage(text)).toBe("norwegian");
  });

  it("returns 'english' for a clearly English paragraph", () => {
    const text = "A municipality needs to introduce remote access for records requests. It is important to weigh the balance of access rights and privacy. We must make trade-offs that are practical to execute.";
    expect(detectDominantLanguage(text)).toBe("english");
  });

  it("returns 'indeterminate' for very short text", () => {
    expect(detectDominantLanguage("Hei")).toBe("indeterminate");
    expect(detectDominantLanguage("")).toBe("indeterminate");
  });

  it("returns 'indeterminate' when neither language dominates clearly", () => {
    // Mixed/ambiguous prose — should not declare a winner
    const text = "ID URL JSON HTTP API REST OAuth SAML XML YAML CSS HTML JavaScript TypeScript GraphQL gRPC OpenAPI Swagger Postman Insomnia curl wget HTTP/2 WebSocket TCP UDP IP DNS";
    expect(detectDominantLanguage(text)).toBe("indeterminate");
  });
});

describe("isLikelyWrongLocale (#444)", () => {
  it("flags English output when nb was requested", () => {
    const englishText = "A municipality needs to introduce remote access for records requests. It is important to weigh the balance between access rights and privacy.";
    expect(isLikelyWrongLocale(englishText, "nb")).toBe(true);
  });

  it("flags English output when nn was requested", () => {
    const englishText = "A municipality needs to introduce remote access for records requests. It is important to weigh the balance between access rights and privacy.";
    expect(isLikelyWrongLocale(englishText, "nn")).toBe(true);
  });

  it("flags Norwegian output when en-GB was requested", () => {
    const norwegianText = "En kommune skal innføre nye rutiner. Det er viktig å vurdere balansen og ta avveininger som er praktiske. Vi kan ikke se bort fra at det er en risiko for at ansatte blir overarbeidet og at det går ut over kvaliteten.";
    expect(isLikelyWrongLocale(norwegianText, "en-GB")).toBe(true);
  });

  it("does NOT flag Norwegian output when nb was requested", () => {
    const norwegianText = "En kommune skal innføre nye rutiner. Det er viktig å vurdere balansen og ta avveininger som er praktiske. Vi kan ikke se bort fra at det er en risiko for at ansatte blir overarbeidet og at det går ut over kvaliteten.";
    expect(isLikelyWrongLocale(norwegianText, "nb")).toBe(false);
  });

  it("does NOT flag English output when en-GB was requested", () => {
    const englishText = "A municipality needs to introduce remote access for records requests. It is important to weigh the balance between access rights and privacy.";
    expect(isLikelyWrongLocale(englishText, "en-GB")).toBe(false);
  });

  it("does NOT flag indeterminate text in either direction (avoid false positives)", () => {
    const ambiguous = "JSON HTTP API REST OAuth SAML XML YAML";
    expect(isLikelyWrongLocale(ambiguous, "nb")).toBe(false);
    expect(isLikelyWrongLocale(ambiguous, "en-GB")).toBe(false);
  });
});
