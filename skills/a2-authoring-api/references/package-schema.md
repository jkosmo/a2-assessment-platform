# The package — `a2-authoring-package/v1`

Contents: [Top level](#top-level) · [Text in three languages](#text-in-three-languages) ·
[A section](#a-section) · [Pictures and figures — `assets[]`](#pictures-and-figures--assets) ·
[A module](#a-module) · [The course](#the-course) · [From package to delivery](#from-package-to-delivery)

The package is the one file you assemble: `work/package.json`. Production reads it and makes the
import file from it; the API takes it as it is. A whole package:
[examples/course-from-slides/package.json](../examples/course-from-slides/package.json).

## Top level

```json
{
  "packageFormat": "a2-authoring-package/v1",
  "locale": "nb",
  "constraints": { "source": "…", "requirements": "…" },
  "objects": [ { "clientRef": "…", "type": "section", "payload": { } } ]
}
```

- `packageFormat` — required, exactly this value.
- `locale` — the language the course was written in. The checks read it as the primary language.
- `constraints` — free-form. Put the confirmed sources and the author's stated requirements here,
  in the author's words. The platform keeps it for the record and never interprets it. **Never a
  token or any other secret.**
- `objects` — one entry per section, module and course. `type` is `section`, `module` or
  `course`. `clientRef` is the id you give it: 1–64 of `a–z`, `0–9` and `-`, unique in the
  package, and the same id as in the course state and the slide list.
- **Unknown fields are refused.** There are no publish, status or audit fields — do not add any.

## Text in three languages

Every text a learner sees is written as an object with all three languages:

```json
{ "nb": "Introduksjon til GDPR", "nn": "Introduksjon til GDPR", "en-GB": "Introduction to the GDPR" }
```

A plain string is only for a value that is the same in every language. Which fields this covers,
and what a translation must keep: [localization.md](localization.md).

## A section

```json
{
  "clientRef": "sec-kilder",
  "type": "section",
  "payload": {
    "title": { "nb": "Hva du gir KI", "nn": "Kva du gir KI", "en-GB": "What you give the AI" },
    "bodyMarkdown": {
      "nb": "Utkastet blir aldri bedre enn det du legger inn. Tre kilder er vanlige.\n\n### …",
      "nn": "Utkastet blir aldri betre enn det du legg inn. Tre kjelder er vanlege.\n\n### …",
      "en-GB": "The draft is never better than what you put in. Three sources are common.\n\n### …"
    },
    "assets": [ ]
  }
}
```

`title` and `bodyMarkdown` are required. `assets` is left out for a section with text only. How
to write the body: [section-content.md](section-content.md).

## Pictures and figures — `assets[]`

Each picture, icon and figure a section shows is one entry. While you work, the entry **points
at the file**:

```json
"assets": [
  { "sourceId": "img-innstillinger", "file": "deck/images/slide-10-1.png" },
  { "sourceId": "ikon-sakliste", "file": "deck/icons/image7.svg" },
  { "sourceId": "fig-arbeidsgang", "file": "figures/arbeidsgang.svg", "sourceLocale": "nb",
    "localizedVariants": [
      { "locale": "nn", "file": "figures/arbeidsgang-nn.svg" },
      { "locale": "en-GB", "file": "figures/arbeidsgang-en.svg" } ],
    "layoutVariants": [
      { "layout": "narrow", "file": "figures/arbeidsgang.narrow.svg",
        "localizedVariants": [
          { "locale": "nn", "file": "figures/arbeidsgang-nn.narrow.svg" },
          { "locale": "en-GB", "file": "figures/arbeidsgang-en.narrow.svg" } ] } ] }
]
```

- **`file`** is relative to the folder the package is in. `produce-course.mjs` reads each file and
  writes what the platform's format carries instead — `filename`, `mimeType`, `sizeBytes` and
  `contentBase64`. Do not encode files yourself.
- **`sourceId`** is a name you choose (1–64 of letters, digits, `_` and `-`), unique in the
  section. The text shows the picture as `![alt text](asset:<sourceId>)`. The platform replaces
  the name with its own id at import; leave the reference as you wrote it.
- Every entry is shown in the text, in every language, and every `asset:` reference has an entry.
- **Types:** svg, png, jpg, gif, webp. 5 MB per file; 25 MB for a course in all.
- **`sourceLocale` and `localizedVariants`** are for a figure with labels: the language of the
  drawing in `file`, and one drawing per other language. A picture or an icon has neither.
- **`layoutVariants`** holds the narrow layout of a flow, with its own language variants.
  `narrow` is the only layout, and only a flow drawn by `draw-flow-figure.mjs` has one. It must
  carry the same labels as the wide drawing, in every language.

## A module

`payload.module` describes the module; `payload.activeVersion` is what is tested. Which fields
`activeVersion` needs depends on `assessmentMode`:

| Field | `FREETEXT_PLUS_MCQ` | `FREETEXT_ONLY` | `MCQ_ONLY` |
|---|---|---|---|
| `taskText` | required | required | not allowed |
| `rubric` | required | required | not allowed |
| `promptTemplate` | required | required | not allowed |
| `mcqSet` | required | not allowed | required |
| `assessorExpectedContent`, `candidateTaskConstraints`, `submissionSchema`, `assessmentPolicy`, `assessmentBlueprint` | optional | optional | optional |

A free-text module (texts shown in one language here to keep the example short — write all
three):

```json
{
  "clientRef": "mod-behandlingsgrunnlag",
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
        "criteria": { "identifisering": "0–4: …", "begrunnelse": "0–4: …" },
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

A multiple-choice module has no `taskText`, `rubric` or `promptTemplate`, and has

```json
"mcqSet": {
  "title": "…",
  "questions": [
    { "stem": "…", "options": ["…", "…", "…"], "correctAnswer": "…", "rationale": "…" }
  ]
},
"assessmentPolicy": { "passRules": { "mcqMinPercent": 75 } }
```

`correctAnswer` is written out in full and equals one of `options` exactly — in every language.
Write three or four options. A module with both has the free-text fields and `mcqSet`.

`certificationLevel` is `basic`, `intermediate` or `advanced`
([course-design.md](course-design.md#level-and-scope)). How to write tasks, criteria and
questions: [modules.md](modules.md).

## The course

```json
{
  "clientRef": "kurs-motereferat",
  "type": "course",
  "payload": {
    "course": { "title": "…", "description": "…", "certificationLevel": "basic" },
    "items": [
      { "type": "SECTION", "ref": "sec-arbeidsgang" },
      { "type": "SECTION", "ref": "sec-kilder" },
      { "type": "MODULE", "ref": "mod-referat" }
    ]
  }
}
```

- `items` is the course's order. Each `ref` is the `clientRef` of a section or module in the
  package; every section and module in the package is placed.
- A course needs at least one module: without one it can never be completed.
- Through the API only, an item may instead name content that already exists on the platform:
  `{ "type": "MODULE", "moduleId": "…" }` or `{ "type": "SECTION", "sectionId": "…" }`. An import
  file cannot.
- A package **without** a course object is a delivery of lone sections and modules
  ([check-and-produce.md](check-and-produce.md#a-lone-section-or-module)).

## From package to delivery

`node scripts/produce-course.mjs work/package.json …` checks the package and writes the import
file ([check-and-produce.md](check-and-produce.md#gate-6--production)). With
`--package-out work/package.complete.json` it also writes the package with every file attached —
the form the API takes ([api-flow.md](api-flow.md)).
