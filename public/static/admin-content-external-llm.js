// #455: ekstern-LLM-handoff i Samtale. Bruker kan kopiere en authoring-prompt til clipboard,
// gå til ChatGPT/Claude/annet, få ut JSON, og lime tilbake. JSON blir parset og brukt til
// å populere sessionDraft slik at brukeren lander i Samtales draft-ready-state — samme
// som etter vanlig LLM-generering.

// Inline prompt-mal. doc/MODULE_DRAFT_JSON_AUTHORING_PROMPT.md beskriver den eldre
// Avansert-flyten (med promptTemplate-seksjon, flat options-array, guidanceText). Denne
// strengen er kanonisk for Samtale-flyten siden v1.2.7 — strengere språk-krav, MCQ-
// options som locale-objekter, assessorExpectedContent. Ikke synk tilbake til doc-en uten
// å oppdatere den eldre Avansert-importeren samtidig.
//
// v1.2.6: locale-felt-navn ble oppdatert til assessorExpectedContent (#449). Beholder
// `guidanceText` som backwards-compat alias i parsern.
// v1.2.7: forsterket språk-kravet — alle deltakerrettede felt MÅ være locale-objekter med
// alle tre språk fylt ut. MCQ-alternativer endret fra flat string-array til array av
// locale-objekter.
// v1.2.8: prompten justert til paritet med Samtale-pipelinens 4 separate LLM-kall
// (buildBlueprintPrompts, buildModuleDraftPrompts, buildMcqGenerationPrompts,
// buildModuleRubricPrompts). Henter inn: authoring constraints (self-contained,
// ingen kilde-referanser), complexity budget per cert-level, scenario decision,
// tydelige roller for taskText/candidateTaskConstraints/assessorExpectedContent,
// MCQ distractor quality + option parity, oppgave-spesifikke rubric-kriterier.
//
// v1.2.8: scenarioMode-parameter ("auto" | "include" | "exclude") byttet ut den statiske
// scenario-seksjonen. Brukeren velger eksplisitt om oppgaven skal ha scenario (samme valg
// brukes også av Samtale-flytens server-side prompt — se buildModuleDraftPrompts).
const SCENARIO_SECTION_AUTO = `# 4. SCENARIO DECISION (for moduleVersion.taskText)

A scenario is a short, realistic situation (4–8 sentences) that grounds the task in a concrete context.

Include a scenario when the module tests situational analysis, ethical reasoning, professional judgement, or practical application. Skip a scenario when the task is primarily factual recall or text summarisation, or when a scenario would feel forced.

If including a scenario:
- Start taskText with the literal token "Scenario:" on its own line, followed by a blank line, then the situation, then a blank line, then the task instruction.
- Keep the scenario realistic, concise, and grounded in facts from the source — without referring to that source.
- The task instruction below the scenario must direct the candidate to use the scenario as the basis for their response.`;

const SCENARIO_SECTION_INCLUDE = `# 4. SCENARIO (REQUIRED — for moduleVersion.taskText)

The author has decided this module MUST include a scenario. Produce one.

A scenario is a short, realistic situation (4–8 sentences) that grounds the task in a concrete context.

Format requirements:
- Start taskText with the literal token "Scenario:" on its own line, followed by a blank line, then the situation, then a blank line, then the task instruction.
- Keep the scenario realistic, concise, and grounded in facts from the source — without referring to that source.
- The task instruction below the scenario must direct the candidate to use the scenario as the basis for their response.`;

const SCENARIO_SECTION_EXCLUDE = `# 4. NO SCENARIO (for moduleVersion.taskText)

The author has decided this module must NOT include a scenario.

- Do NOT include a scenario, situation, case description, or roleplay framing in taskText.
- Do NOT start taskText with "Scenario:" or any similar narrative opener.
- Write taskText as a direct task or question to the candidate, grounded in the relevant facts and concepts from the source, but without a constructed situation.
- Keep the task clear and concrete; if context is needed to make the task self-contained, integrate it as a single short statement rather than as a multi-sentence scenario.`;

function resolveScenarioSection(scenarioMode) {
  if (scenarioMode === "include") return SCENARIO_SECTION_INCLUDE;
  if (scenarioMode === "exclude") return SCENARIO_SECTION_EXCLUDE;
  return SCENARIO_SECTION_AUTO;
}

// Build the authoring prompt for the chosen scenarioMode. Returns the full string that
// gets copied to the clipboard / shown in the import modal. Default is "auto" — same
// behaviour as the static const we used in v1.2.6 and v1.2.7.
export function buildExternalLlmAuthoringPrompt(scenarioMode = "auto") {
  return PROMPT_HEADER + resolveScenarioSection(scenarioMode) + PROMPT_TRAILER;
}

const PROMPT_HEADER = `You are producing a complete module draft for a professional certification assessment platform. Return one strict JSON object only — no markdown wrapper, no commentary, no comments inside the JSON. Preferred output is a downloadable \`.json\` file; if your interface cannot return a file, return the JSON as the only content in a single code block.

# 1. LANGUAGE REQUIREMENT (CRITICAL)

- The platform supports three locales: en-GB, nb (Norwegian Bokmål), nn (Norwegian Nynorsk).
- Detect the dominant language of the source material below and treat that as the authoritative content source.
- Every participant-facing text field listed under "Locale-object fields" MUST be a JSON object with all three keys: "en-GB", "nb", "nn". Each key must contain a complete, fluent translation — never empty, never in the wrong language.
- Translate consistently: terminology, tone, scenario details, and worked examples must align across all three locales.
- This applies to MCQ stems, every MCQ option, correctAnswer, rationale, and every rubric criterion's label and description. Do NOT leave any of these in English when the source is Norwegian (or vice versa).

Locale-object fields (each MUST be { "en-GB": "...", "nb": "...", "nn": "..." }):
- module.title
- module.description
- mcqSet.title
- moduleVersion.taskText
- moduleVersion.assessorExpectedContent
- moduleVersion.candidateTaskConstraints
- For every MCQ question: stem, correctAnswer, rationale, AND each entry in options
- For every rubric criterion: label, description

# 2. AUTHORING CONSTRAINTS (apply to taskText AND every MCQ question)

- The source material is hidden background for you only. The candidate will NOT see it.
- Every output must be self-contained and answerable from itself alone.
- Do NOT use phrases like "source material", "the text above", "the document", "the attachment", "as described", "the material provided", or equivalent wording.
- Do NOT instruct the candidate to read, review, cite, or refer to any unseen text.
- Any facts, context, definitions, or scenario details a candidate needs must be embedded directly in the relevant taskText, MCQ stem, or candidateTaskConstraints.

# 3. CERTIFICATION LEVEL + COMPLEXITY BUDGET

Choose module.certificationLevel based on the source material's depth and the realistic skill level it tests: "basic", "intermediate", or "advanced". Then enforce the matching complexity budget below. The budget is a HARD CEILING — do not exceed it.

| Level        | Max actors | Max concepts | Max trade-offs | Answer length    | Time   |
|--------------|------------|--------------|----------------|------------------|--------|
| basic        | 1          | 2            | 0              | 100–200 words    | 10 min |
| intermediate | 2          | 3            | 1              | 250–450 words    | 20 min |
| advanced     | 3          | 4            | 2              | 400–700 words    | 30 min |

Authoring tone per level:
- basic: plain language, single clear situation when a scenario is needed, no layered tensions.
- intermediate: may include one realistic tension or trade-off; still easy to parse on first read.
- advanced: may involve ambiguity or competing considerations; avoid complication for its own sake.

Before finalising, verify a candidate at this level can begin a reasonable answer using only the visible taskText + candidateTaskConstraints plus expected prerequisite knowledge.

`;

const PROMPT_TRAILER = `

# 5. TWO SEPARATE OUTPUT FIELDS — do not mix their roles

**moduleVersion.taskText** (visible to candidate):
- The full task the candidate must respond to, including the scenario at the top if one is used.
- Self-contained — a candidate must be able to answer using only taskText + candidateTaskConstraints.

**moduleVersion.candidateTaskConstraints** (visible to candidate):
- 1–3 short sentences shown alongside the task.
- Clarify expected answer format, reasoning type, and scope.
- Do NOT give away the answer, list expected points, or act as a scoring rubric.
- Example shape: "Answer with a short recommendation and justify it with the most important considerations from the scenario. State your assumptions clearly. You do not need to cover every possible measure."

**moduleVersion.assessorExpectedContent** (hidden from candidate — assessor use only):
- Concrete scoring support for the assessor.
- Name the key points, trade-offs, and distinctions a strong response should cover.
- May be more specific than the task itself — the candidate will NOT see this.
- Include at least one note about what NOT to penalise if the task did not explicitly ask for it.

# 6. MCQ AUTHORING

Produce mcqSet.questions, an array of 5–10 questions. Each question has exactly 4 options (one correct, three distractors). Apply these rules to every question:

**Self-contained**: Stems must be answerable without any reference to source material, attachments, or prior text. Incorporate any needed facts directly into the stem.

**Distractor quality** — for each of the three incorrect options, all three of the following must be true:
1. It reflects a realistic misconception, overgeneralisation, wrong priority, or nearby correct principle.
2. It would be correct or defensible if one relevant condition in the stem were different.
3. It cannot be eliminated without domain reasoning.

No throwaway distractors. Reject and rewrite the question if any option is obviously wrong, irrelevant, too broad, too narrow, stylistically weaker, or categorically different from the correct answer.

**Option parity**: All four options in a question must be comparable in length and level of detail. A candidate must not be able to identify the correct answer by noticing that one option is longer, more specific, more qualified, or written in a more "textbook" tone than the others. If the correct answer contains a qualifier or clause, the distractors must too. Never pad distractors with vague filler.

**correctAnswer match**: correctAnswer.<locale> must match exactly one of the options' <locale> values in the SAME locale. This must hold for all three locales independently.

**rationale**: 1–3 sentences explaining why the correct answer is right; optionally note why the most tempting distractor is wrong under the stem's exact conditions.

# 7. RUBRIC CRITERIA

Produce rubric.criteria, an object keyed by criterion id, with 3–6 entries.

- Each criterion must name a SPECIFIC dimension the task actually tests (e.g. "Trade-off between privacy and audit obligation", not "Quality of reasoning" or "Clarity"). Generic criteria are not acceptable.
- Each description must reference concrete content from the task or assessor expectations so a human assessor can apply the criterion without guessing.
- Keys are short snake_case strings, stable across runs: e.g. "scenario_application", "priority_reasoning", "evidence_quality".
- maxScore is an integer 1–10. The sum of maxScore across all criteria should land in 10–30.
- candidateVisible: true if the criterion text is appropriate to show the candidate before they submit. Set false only when the criterion would leak the expected answer.

# 8. RETURN FORMAT

Return one JSON object with this exact top-level shape (fill every locale key with real translated content — do not leave any key empty or in the wrong language):

{
  "module": {
    "title": { "en-GB": "", "nb": "", "nn": "" },
    "description": { "en-GB": "", "nb": "", "nn": "" },
    "certificationLevel": "intermediate"
  },
  "rubric": {
    "criteria": {
      "criterion_id_1": {
        "label": { "en-GB": "", "nb": "", "nn": "" },
        "description": { "en-GB": "", "nb": "", "nn": "" },
        "maxScore": 5,
        "candidateVisible": true
      }
    }
  },
  "mcqSet": {
    "title": { "en-GB": "", "nb": "", "nn": "" },
    "questions": [
      {
        "stem": { "en-GB": "", "nb": "", "nn": "" },
        "options": [
          { "en-GB": "", "nb": "", "nn": "" },
          { "en-GB": "", "nb": "", "nn": "" },
          { "en-GB": "", "nb": "", "nn": "" },
          { "en-GB": "", "nb": "", "nn": "" }
        ],
        "correctAnswer": { "en-GB": "", "nb": "", "nn": "" },
        "rationale": { "en-GB": "", "nb": "", "nn": "" }
      }
    ]
  },
  "moduleVersion": {
    "taskText": { "en-GB": "", "nb": "", "nn": "" },
    "candidateTaskConstraints": { "en-GB": "", "nb": "", "nn": "" },
    "assessorExpectedContent": { "en-GB": "", "nb": "", "nn": "" }
  }
}

Source material follows:
[PASTE SOURCE MATERIAL HERE]
`;

// Strip code-fence wrappers if the LLM returned the JSON inside one. We accept:
//   - Raw JSON
//   - \`\`\`json{...}\`\`\`
//   - \`\`\`{...}\`\`\`
//   - With or without trailing whitespace/newlines
function stripCodeFences(raw) {
  const trimmed = String(raw ?? "").trim();
  // Try fenced first
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

// Parses + normalises the JSON returned by an external LLM. Throws on missing required
// fields. Tolerates two field-name dialects: assessorExpectedContent (current) and
// guidanceText (legacy — what the doc prompt still says). Tolerates string OR locale-
// object for any localisable field.
export function parseExternalLlmJson(raw) {
  const cleaned = stripCodeFences(raw);
  if (!cleaned) {
    throw new Error("Empty JSON input.");
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err?.message ?? "parse failed"}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON root must be an object.");
  }

  const module_ = parsed.module ?? {};
  const moduleVersion = parsed.moduleVersion ?? {};
  const rubric = parsed.rubric ?? {};
  const mcqSet = parsed.mcqSet ?? {};

  if (!module_.title) {
    throw new Error("Missing required field: module.title");
  }
  if (!moduleVersion.taskText) {
    throw new Error("Missing required field: moduleVersion.taskText");
  }

  // assessorExpectedContent (current name) OR guidanceText (legacy name from doc prompt)
  const assessorExpectedContent =
    moduleVersion.assessorExpectedContent ?? moduleVersion.guidanceText ?? "";

  const certificationLevel =
    typeof module_.certificationLevel === "string" && module_.certificationLevel
      ? module_.certificationLevel
      : "intermediate";

  return {
    moduleTitle: module_.title,
    moduleDescription: module_.description ?? null,
    certificationLevel,
    taskText: moduleVersion.taskText,
    assessorExpectedContent,
    candidateTaskConstraints: moduleVersion.candidateTaskConstraints ?? "",
    mcqQuestions: Array.isArray(mcqSet.questions) ? mcqSet.questions : [],
    criteria: rubric.criteria && typeof rubric.criteria === "object" ? rubric.criteria : null,
  };
}
