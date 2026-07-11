# `a2-authoring-package/v1` — contract reference

Authoritative Zod schema: `src/modules/adminContent/agentAuthoringSchemas.ts`.
Design rationale: `doc/design/AGENT_AUTHORING_647.md` §2.

## Top level

```json
{
  "packageFormat": "a2-authoring-package/v1",
  "locale": "nb",
  "constraints": { "source": "…", "requirements": "…" },
  "objects": [ { "clientRef": "…", "type": "module|section|course", "payload": { … } } ]
}
```

- `packageFormat` — required literal.
- `locale` — optional, informative only (the primary language you authored in).
- `constraints` — optional free-form JSON; record the user's requirements verbatim for
  audit/debug. The server never interprets it. **Never put secrets here.**
- `objects` — 1+ entries. `clientRef` must match `[a-z0-9-]{1,64}` and be unique in the
  package.
- **All objects are strict**: unknown fields are rejected (`unknown_field`). There are no
  publish/audit fields — do not invent `publishedAt`, `autoPublish`, `audit`, `status`, …

## Localized text

Every `title`/text field accepts either a **plain string** (recommended — applies to all
locales) or a locale object. Module/course titles use the strict object form
(`{"en-GB": "…", "nb": "…", "nn": "…"}` — all three required); section `title`/`bodyMarkdown`
accept a partial object (e.g. only `nb`).

## `type: "section"`

```json
{
  "clientRef": "intro",
  "type": "section",
  "payload": {
    "title": "Introduksjon til GDPR",
    "bodyMarkdown": "## Hva er GDPR\n…markdown only, no assets…"
  }
}
```

## `type: "module"`

`payload.module` = metadata; `payload.activeVersion` = the assessable content. Which
`activeVersion` fields are required/forbidden depends on `assessmentMode`
(`required_for_mode` / `forbidden_for_mode` in the validate report):

| Field | FREETEXT_PLUS_MCQ (default) | FREETEXT_ONLY | MCQ_ONLY |
|---|---|---|---|
| `taskText` | required | required | forbidden |
| `rubric` | required | required | forbidden |
| `promptTemplate` | required | required | forbidden |
| `mcqSet` | required | forbidden | required |
| `assessorExpectedContent`, `candidateTaskConstraints`, `submissionSchema`, `assessmentPolicy`, `assessmentBlueprint` | optional | optional | optional (`assessmentPolicy.passRules.mcqMinPercent` recommended) |

FREETEXT_ONLY example:

```json
{
  "clientRef": "module-1",
  "type": "module",
  "payload": {
    "module": {
      "title": "Behandlingsgrunnlag",
      "description": "Vurdering av behandlingsgrunnlag i praksis",
      "certificationLevel": "basic"
    },
    "activeVersion": {
      "assessmentMode": "FREETEXT_ONLY",
      "taskText": "Beskriv hvilket behandlingsgrunnlag som gjelder når …",
      "assessorExpectedContent": "Kandidaten identifiserer artikkel 6(1)(b) og begrunner …",
      "rubric": {
        "criteria": { "identifisering": "0-4: …", "begrunnelse": "0-4: …" },
        "scalingRule": { "practical_weight": 100, "max_total": 8 }
      },
      "promptTemplate": {
        "systemPrompt": "Du er sensor for …",
        "userPromptTemplate": "Vurder besvarelsen mot rubrikken …"
      }
    }
  }
}
```

MCQ_ONLY: drop the three free-text fields, add
`"mcqSet": { "title": "…", "questions": [{ "stem": "…", "options": ["…", "…"], "correctAnswer": "…", "rationale": "…" }] }`
(`correctAnswer` must be one of `options`; 2–6 options; write plausible distractors).
FREETEXT_PLUS_MCQ: include both the free-text triple and `mcqSet`.

## `type: "course"`

```json
{
  "clientRef": "course-main",
  "type": "course",
  "payload": {
    "course": { "title": "GDPR for saksbehandlere", "description": "…", "certificationLevel": "basic" },
    "items": [
      { "type": "SECTION", "ref": "intro" },
      { "type": "MODULE", "ref": "module-1" },
      { "type": "MODULE", "moduleId": "cmr8…existing" }
    ]
  }
}
```

- Each item has **exactly one** of `ref` (package object) or `moduleId`/`sectionId`
  (existing content, checked against the DB). Array order = course order.
- A course without any MODULE item validates but warns (`course_without_modules`) — it can
  never be completed/published until a module is added.

## Validate report

`POST /api/admin/content/agent-authoring/validate` → `200`:

```json
{
  "valid": false,
  "summary": { "errors": 1, "warnings": 1, "objects": 3 },
  "issues": [
    { "severity": "error", "path": "objects[1].payload.activeVersion.mcqSet", "code": "required_for_mode", "message": "assessmentMode MCQ_ONLY requires mcqSet." }
  ],
  "plan": []
}
```

`plan` (only when `errors == 0`) is the execution order:
`create_section`* → `create_module`* → `create_course` → `set_course_items`.

## Fallback format: `a2-content-export/v1` course envelope (for manual import)

When the agent can't call the API (see playbook §4), emit the course as a **self-contained
`a2-content-export/v1` course envelope** written to disk; the user imports it via the
existing admin-UI course import. The **leaf payloads are identical** to the authoring
package (same `module`/`activeVersion`/`section` shapes) — the conversion is a mechanical
re-wrap:

```json
{
  "exportFormat": "a2-content-export/v1",
  "exportedAt": "<now ISO>",
  "scope": "course",
  "course": {
    "course": {
      "title": "…", "description": "…", "certificationLevel": "…",
      "audit": {},
      "items": [
        { "type": "SECTION", "sortOrder": 0, "section": { …section payload…, "audit": {} } },
        { "type": "MODULE",  "sortOrder": 1, "module":  { …module payload…  } }
      ]
    }
  }
}
```

Mapping from an `a2-authoring-package/v1`:
- Each package `course.items[]` entry → a `course.items[]` entry here, in array order, with
  `sortOrder` = index; resolve `ref` → the referenced object's inlined payload.
- Inline each referenced module/section payload directly (this format is self-contained —
  no `clientRef`).
- Add `audit: {}` to each module `activeVersion`, each section, and the course. Empty audit
  = no publish history ⇒ import never auto-publishes (drafts only).
- `exportFormat` / `exportedAt` / `scope: "course"` on the envelope. **`exportedAt` (and any
  `audit.publishedAt`) MUST be `Date.toISOString()` shape (`YYYY-MM-DDTHH:mm:ss.sssZ`)** — Zod
  `.datetime()` rejects timezone offsets and microseconds. Build this envelope with
  `buildFallbackEnvelope` and validate it with the round-trip in
  [export-validation.md](export-validation.md) (`scripts/export-validate.mjs`); do not hand-roll
  the date or call the file "validated" without the read-back check.

Only whole courses use this fallback path; a lone module can use the module-scoped envelope
(`scope: "module"`) the same way.
