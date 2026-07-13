# Localization — one primary language for the dialogue, three real translations before production

Why this exists: an imported package had content in only **one** language. The supported set is
**nb** (bokmål), **nn** (nynorsk) and **en-GB** (British English). The rule is: fix ONE primary
language for the whole dialogue (core principle 5 — never mix languages while authoring), then,
once the primary version is approved, produce **real translations** for all three before
production — never the same bokmål text copied into every locale field.

**The delivered course must be complete in all three languages — including sections.** The platform
*can* translate a missing locale on demand, but it does so with a central LLM call that costs tokens
every time. Translating once, here at production, avoids that recurring central cost entirely — so
completeness is **mandatory, not "nice to have."** Note the schema asymmetry that makes this easy to
get wrong: `section.title`/`bodyMarkdown` accept a *partial* object (only `nb` validates at import),
so a single-language section will **not** be rejected by the platform — the skill must self-enforce
completeness via `checkLocalization` before delivering.

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

## Figures are localized too (#763, Layer B)

A figure whose labels are in one language breaks the multilingual promise exactly as untranslated
prose does. After the primary is approved, **each text-bearing SVG figure gets `localizedVariants`
for the other two locales**: translate the `<text>` runs, keep the geometry identical (same number
of labels, same positions — geometry never changes, only the label strings). This reuses the #657
SVG-localization mechanism (`sourceLocale` + per-locale variant blobs); it does not invent a new
one. **Raster figures cannot be localized** (baked pixels) — if an author-supplied raster carries
text, flag it as untranslatable and advise an SVG instead.

`checkLocalization` (via `checkFigureLocalization`) extends the check to figures and **blocks** when:

- **missingVariants** — a text-bearing SVG figure lacks a variant for one of the other two locales;
- **textCountMismatches** — a variant's label count differs from the original's (a label was lost
  or added — the geometry/structure drifted);
- **tokenDrift** — a formula / URL / identifier / filename / article-reference present in an
  original label is missing from a variant;
- **blindCopies** — a variant's labels are identical to the original's translatable prose (the
  figure was copied, not translated). Short single-word labels ("Start", "A", "72") that
  legitimately stay identical are not flagged.

The figure findings are returned under `result.figures` and folded into the top-level `blocks`.

## What is deterministic vs behavioral

The check deterministically catches missing locales, answer-key drift, token loss and blind
copies — for prose fields **and** figure labels. It cannot judge **translation quality** (is the
nynorsk natural? is the meaning faithful? do the translated labels still fit the drawing?) — that
remains the skill's behavioral responsibility, ideally confirmed in the Gate 5 external QA pass
with a reviewer who reads all three languages.
