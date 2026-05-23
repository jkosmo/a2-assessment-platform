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
// v1.2.7: forsterket språk-kravet etter at testing 2026-05-23 avdekket at MCQ-alternativer
// og kriterier kom på engelsk selv om kildematerialet var norsk. Alle deltakerrettede felt
// MÅ nå være locale-objekter med alle tre språk fylt ut.
export const EXTERNAL_LLM_AUTHORING_PROMPT = `You are producing a module draft JSON for an assessment platform.

Return one JSON object only.
Preferred output is a downloadable \`.json\` file.
If your interface cannot return a file, return the JSON as the only content in one code cell / code block.
Do not include commentary.
Do not include comments.

LANGUAGE REQUIREMENT (CRITICAL):
- The platform supports three locales: en-GB, nb (Norwegian Bokmål), nn (Norwegian Nynorsk).
- Detect the dominant language of the source material below.
- Every participant-facing text field listed under "Locale-object fields" MUST be a JSON
  object with all three keys: "en-GB", "nb", "nn". Each key must contain a complete,
  fluent translation — never leave a key empty, never leave a key in the wrong language.
- Translate consistently: terminology, tone, and worked examples must align across locales.
- This applies equally to MCQ stems, every MCQ option, correctAnswer, rationale, and every
  rubric criterion's label and description. Do NOT leave these in English when the source
  is in another language.

Locale-object fields (each MUST be { "en-GB": "...", "nb": "...", "nn": "..." }):
- module.title
- module.description
- mcqSet.title
- moduleVersion.taskText
- moduleVersion.assessorExpectedContent
- moduleVersion.candidateTaskConstraints
- For every MCQ question: stem, correctAnswer, rationale, AND each entry in options
- For every rubric criterion: label, description

Structural requirements:
- Root object must contain exactly these sections: module, rubric, mcqSet, moduleVersion.
- MCQ questions must include:
  - stem (locale object)
  - options — array of 3-5 entries, where each entry is itself a locale object
  - correctAnswer (locale object) — its value in each locale must match exactly one of the
    options' values in the SAME locale
  - rationale (locale object) — short explanation of why the correct answer is correct
- rubric.criteria must be a JSON object keyed by criterion-id, where each criterion has:
  - label (locale object)
  - description (locale object)
  - maxScore (integer 1-10)
  - candidateVisible (boolean — whether the criterion is shown to the candidate)
- moduleVersion.taskText must describe the participant assignment clearly.
- moduleVersion.assessorExpectedContent describes what a good submission should include (hidden from candidate).
- moduleVersion.candidateTaskConstraints (optional content; the key + locale object are required) — short constraint hints shown to the candidate.
- module.certificationLevel must be one of: "basic", "intermediate", "advanced".

Return JSON in this exact shape (replace the placeholder strings with real, fully translated content — do NOT leave any locale key empty or in the wrong language):
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
