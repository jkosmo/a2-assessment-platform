# Module Draft JSON Authoring Prompt

Use this prompt when drafting module content with an LLM before importing it into `/admin-content`.

## Goal

Return one JSON object only.

The JSON must be suitable for the `Import draft JSON` section in the content workspace.

Do not include markdown fences.
Do not include explanation text.
Do not include comments.

## Prompt Template

```text
You are producing a module draft JSON for an assessment platform.

Return one JSON object only.
Do not wrap the JSON in markdown.
Do not include commentary.
Do not include comments.

Requirements:
- The root object must contain exactly these sections:
  - module
  - rubric
  - promptTemplate
  - mcqSet
  - moduleVersion
- Localized participant-facing text should use the locales:
  - en-GB
  - nb
  - nn
- Keep systemPrompt and userPromptTemplate concise and production-oriented.
- MCQ questions must include:
  - stem
  - options
  - correctAnswer
  - rationale
- correctAnswer must match one of the options exactly.
- rubric.criteria, rubric.scalingRule, and rubric.passRule must be valid JSON objects.
- moduleVersion.taskText must describe the participant assignment clearly.
- moduleVersion.guidanceText must describe what a good submission should include.
- validFrom and validTo should be empty strings unless a date range is explicitly provided.

Return JSON in this exact shape:
{
  "module": {
    "title": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "description": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "certificationLevel": "",
    "validFrom": "",
    "validTo": ""
  },
  "rubric": {
    "criteria": {},
    "scalingRule": {},
    "passRule": {}
  },
  "promptTemplate": {
    "systemPrompt": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "userPromptTemplate": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "examples": []
  },
  "mcqSet": {
    "title": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "questions": []
  },
  "moduleVersion": {
    "taskText": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    },
    "guidanceText": {
      "en-GB": "",
      "nb": "",
      "nn": ""
    }
  }
}

Source material follows:
[PASTE SOURCE MATERIAL HERE]
```

## Notes

- If you already have an exported module JSON, use the workspace import directly. This prompt is for authoring a simpler draft format.
- After import, review the fields in `/admin-content`, then save a new draft version and publish separately.
