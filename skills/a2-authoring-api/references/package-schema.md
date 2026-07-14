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

Every `title`/text field accepts either a **plain string** or a locale object. Module/course titles
use the strict object form (`{"en-GB": "…", "nb": "…", "nn": "…"}` — all three required); section
`title`/`bodyMarkdown` accept a *partial* object (e.g. only `nb`).

> **⚠️ Deliver ALL THREE languages (`nb`, `nn`, `en-GB`) for every localized field — sections
> included.** The partial-object allowance on `section.title`/`bodyMarkdown` exists for incremental
> edits in the admin UI; it is **NOT** a licence for an agent to ship a single-language course. A
> course produced by this skill must be complete in nb, nn **and** en-GB at generation time, with
> **real translations** — never the primary text copied into every locale, and never one locale left
> out. **Why it is mandatory, not "ideal":** anything left in one language must be translated later
> by a human via the platform's on-demand LLM localizer — **central token cost we avoid entirely by
> translating once, here, at production.** `checkLocalization` blocks a missing locale and flags a
> blind-copy (see [localization.md](localization.md)). Use a plain string ONLY for a genuinely
> locale-independent value (a proper noun, a number) — never as a shortcut past translating prose.

## `type: "section"`

```json
{
  "clientRef": "intro",
  "type": "section",
  "payload": {
    "title": { "nb": "Introduksjon til GDPR", "nn": "Introduksjon til GDPR", "en-GB": "Introduction to GDPR" },
    "bodyMarkdown": {
      "nb": "## Hva er GDPR\n\nGDPR regulerer behandling av personopplysninger …",
      "nn": "## Kva er GDPR\n\nGDPR regulerer behandling av personopplysningar …",
      "en-GB": "## What is the GDPR\n\nThe GDPR governs the processing of personal data …"
    }
  }
}
```

A section needs `title` + `bodyMarkdown`, **each carrying all three locales** (`nb`, `nn`, `en-GB`)
with real translations — see the mandatory-completeness note above. To include a figure, add an
optional `assets[]` and reference each figure from the markdown as `![alt](asset:<sourceId>)` —
below.

### Section figures — optional `assets[]` (#763, Layer B)

The skill **designs** figures as part of authoring — propose one simple figure per visual point in
the structure gate, draw it as SVG alongside the text (see [figure-design.md](figure-design.md)) —
and carries them inline on the section payload:

```json
{
  "clientRef": "prosess",
  "type": "section",
  "payload": {
    "title": { "nb": "Saksgangen", "nn": "Sakshandsaminga", "en-GB": "The case workflow" },
    "bodyMarkdown": {
      "nb": "## Saksgang\n\n![Saksflyt](asset:fig-flow)",
      "nn": "## Sakshandsaming\n\n![Saksflyt](asset:fig-flow)",
      "en-GB": "## Case workflow\n\n![Case flow](asset:fig-flow)"
    },
    "assets": [
      {
        "sourceId": "fig-flow",
        "filename": "saksflyt.svg",
        "mimeType": "image/svg+xml",
        "sizeBytes": 1234,
        "contentBase64": "PHN2Zy…",
        "sourceLocale": "nb",
        "localizedVariants": [
          { "locale": "nn", "contentBase64": "PHN2Zy…" },
          { "locale": "en-GB", "contentBase64": "PHN2Zy…" }
        ]
      }
    ]
  }
}
```

- **`sourceId` is a client-chosen token** (`[a-zA-Z0-9_-]{1,64}`) you invent — NOT a DB id. The
  markdown references it as `asset:<sourceId>`; leave the ref pointing at your `sourceId`, never
  pre-remap it.
- On `create_section`, A2 imports each asset (re-sanitises SVG, mime/size guards), remaps every
  `asset:<sourceId>` in the stored markdown to the new `SectionAsset` id, and **echoes the
  `sourceId → assetId` map** back so you can track your refs. Same ref/remap + mime/limit contract as
  the export `assets[]` (below): allowed mimes `image/svg+xml`, `image/png`, `image/jpeg`,
  `image/gif`, `image/webp`; 5 MB per asset. Omit `assets` entirely for a text-only section.
- The validate report checks figure consistency per section: `missing_asset`, `unreferenced_asset`
  (warning), `unsupported_asset_mime`, `asset_too_large`, `asset_svg_unsanitizable`,
  `duplicate_asset_source_id`.
- **`localizedVariants`** carries the #657 translated-SVG variants (one base64 per locale), added
  after the primary language is approved; omit for raster or untranslated figures.

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

### Section figures/images — optional `assets[]` (#749, Layer A)

A section payload MAY carry its figures/images inline so they survive export/import (without
this, `asset:<id>` markdown refs would break on the destination). Each entry:

```json
{
  "type": "SECTION", "sortOrder": 0,
  "section": {
    "title": "…", "bodyMarkdown": "![Diagram](asset:cmr8src…)", "audit": {},
    "assets": [
      {
        "sourceId": "cmr8src…",
        "filename": "diagram.svg",
        "mimeType": "image/svg+xml",
        "sizeBytes": 1234,
        "contentBase64": "PHN2Zy…",
        "sourceLocale": "nb",
        "localizedVariants": [ { "locale": "en-GB", "contentBase64": "PHN2Zy…" } ]
      }
    ]
  }
}
```

- **Ref/remap contract:** `bodyMarkdown` references each figure as `![alt](asset:<sourceId>)`,
  where `<sourceId>` equals the asset's `sourceId`. On import, A2 decodes each blob, **re-sanitises
  SVG**, stores it to a fresh blob, creates a new `SectionAsset`, and rewrites every
  `asset:<sourceId>` in the markdown to the new asset id — so `sourceId` is a *matching key only*,
  never a destination id. Leave the markdown refs pointing at `sourceId`; do not pre-remap them.
- **Allowed mime types:** `image/svg+xml`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
  Per-asset limit 5 MB; the whole export is capped at 25 MB of decoded asset bytes.
- **`localizedVariants`** carries the #657 translated-SVG variants (one base64 per locale); omit
  for raster or untranslated figures. `assets` is fully optional — omit it entirely for a
  markdown-only section (old asset-less files import unchanged).
- **Figures are designed by the skill (Layer B, shipped).** The skill proposes figures in the
  structure gate and draws them as SVG alongside the text ([figure-design.md](figure-design.md)); an
  authoring package carries them on the section payload (see "Section figures" above). This export
  `assets[]` is the *transport* half — how figures on a section travel through the fallback file —
  using the same ref/remap contract.
- `exportFormat` / `exportedAt` / `scope: "course"` on the envelope. **`exportedAt` (and any
  `audit.publishedAt`) MUST be `Date.toISOString()` shape (`YYYY-MM-DDTHH:mm:ss.sssZ`)** — Zod
  `.datetime()` rejects timezone offsets and microseconds. Build this envelope with
  `buildFallbackEnvelope` and validate it with the round-trip in
  [export-validation.md](export-validation.md) (`scripts/export-validate.mjs`); do not hand-roll
  the date or call the file "validated" without the read-back check.
- **Encoding — write ASCII-safe JSON (#754).** Escape every non-ASCII character as a `\uXXXX` JSON
  escape so the delivered file is pure ASCII. A `\uXXXX` escape decodes to the correct codepoint in
  any JSON parser regardless of the file's byte encoding, so Norwegian `æ/ø/å` cannot be corrupted by
  a download/editor/transfer that re-encodes UTF-8 as Latin-1 (which turns them into `Ã¦/Ã¸/Ã¥`).
  `buildFallbackEnvelope` + `roundTripFallbackExport` emit ASCII-safe output and **refuse to deliver**
  a file that already contains such mojibake (the `encoding-integrity` check); if you hand-write the
  file instead, emit the `\uXXXX` escapes yourself. (SVG figure text is unaffected — it uses XML
  numeric entities like `&#248;`.)

Only whole courses use this fallback path; a lone module can use the module-scoped envelope
(`scope: "module"`) the same way.
