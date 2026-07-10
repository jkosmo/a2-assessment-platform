# Localization — one primary language for the dialogue, three real translations before production

Why this exists: an imported package had content in only **one** language. The supported set is
**nb** (bokmål), **nn** (nynorsk) and **en-GB** (British English). The rule is: fix ONE primary
language for the whole dialogue (core principle 5 — never mix languages while authoring), then,
once the primary version is approved, produce **real translations** for all three before
production — never the same bokmål text copied into every locale field.

Deterministic helper: [scripts/localization-check.mjs](../scripts/localization-check.mjs)
(`checkLocalization`). Unit-tested in `test/unit/agent-authoring-localization.test.ts`.

## Which fields the schema localizes (and which it does NOT)

Use the CORRECT localized datatype per field — they are not uniform
(`src/modules/adminContent/adminContentSchemas.ts`):

| Field | Datatype | Requirement |
|---|---|---|
| module `title`, `description` | `localizedTextSchema` | string **or** strict `{en-GB, nb, nn}` (all three) |
| `promptTemplate.systemPrompt` / `userPromptTemplate`, `mcqSet` `title` | `localizedTextSchema` | strict object needs all three |
| MCQ question `stem`, each `options[]`, `correctAnswer`, `rationale` | `localizedTextSchema` | strict object needs all three |
| `taskText`, `assessorExpectedContent`, `candidateTaskConstraints` | `localizedTextSchema` | strict object needs all three |
| `submissionSchema.fields[].label` / `placeholder` | `localizedTextSchema` | strict object needs all three |
| course `title`, `description` | `localizedTextSchema` | strict object needs all three |
| section `title`, `bodyMarkdown` | **patch** `localizedTextPatchSchema` | string **or** *partial* object |

**MCQ correctAnswer** must equal one of `options` **by value** (`localizedTextIdentity`) — a
localized `correctAnswer` must match a localized option **structurally in every locale**, not by
index.

**Not localized by the contract:** `rubric.criteria` and `rubric.scalingRule` are
`z.record(z.unknown())` — plain JSON, **not** a localized datatype. The platform does not enforce
per-locale rubric criteria. If the author wants translated criteria, they must author the record
values themselves; this skill does **not** change the API contract to add localization the
platform doesn't have. Document this to the author rather than silently faking it.

## What to translate

Every **student-facing** field the schema localizes: course title/description, section
titles/body, module title/description, task text, submission/answer constraints, assessor
expected content, MCQ title/questions/options/rationales, and any attachment/reference intros.

Translations must **preserve**: meaning, assessment level/difficulty, the correct answer, option
count **and** order, and every formula / code / identifier / filename / URL. Use natural
nynorsk and natural British English — not a gloss of bokmål. Introduce **no new claims** in a
translation. For MCQ, verify the correct answer is **semantically identical** across languages by
re-checking the option mapping after translating — not just the index.

## The localization check (`checkLocalization`)

Run before production. Returns `{ missing, blindCopies, answerKeyChanges, tokenDrift, blocks,
reasons }`. It **blocks** when any of these hold:

- **missing** — a localized field lacks one of the three languages (a language "lost" a section,
  question, option, or field);
- **answerKeyChanges** — an MCQ `correctAnswer` maps to a **different option position** in some
  language than in the primary (a translation changed the correct answer), or fails to match any
  option in some locale;
- **tokenDrift** — a formula / URL / identifier / filename / legal-article reference present in
  the primary locale is **missing** from a translation;
- **blindCopies** — a prose field is identical across all three languages (the primary copied
  verbatim instead of translated). Short tokens, proper nouns and numbers ("GDPR", "72") are not
  flagged; only translatable prose is.

Block production if any mandatory localized field is missing. Equal structure across languages
(same questions, same option count/order, same criteria) is verified by the missing/answer-key
checks — options are single localized objects shared across locales, so "one language lost an
option" surfaces as that option missing a locale.

## What is deterministic vs behavioral

The check deterministically catches missing locales, answer-key drift, token loss and blind
copies. It cannot judge **translation quality** (is the nynorsk natural? is the meaning faithful?)
— that remains the skill's behavioral responsibility, ideally confirmed in the Gate 5 external QA
pass with a reviewer who reads all three languages.
