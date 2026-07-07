# Authoring playbook — how to run a good course-authoring session

This is the conversational craft of the skill: how to *interview* the user, *design* a
pedagogically sound course, and *show it back* for approval before anything is created.
The mechanics (package format, API calls) live in `package-schema.md` and `api-flow.md`;
this file is about doing the authoring well.

The platform's model, which shapes everything below:
- **Learning sections teach** (markdown content, no assessment).
- **Modules assess** — in one of three modes:
  - `MCQ_ONLY` — multiple-choice only. For **recognition / factual recall** (definitions,
    "which of these is correct", rules).
  - `FREETEXT_ONLY` — a written answer graded by an LLM against a rubric. For **applied
    judgment / reasoning / explanation** where *how* they argue matters.
  - `FREETEXT_PLUS_MCQ` — both. For "check they know the facts **and** can apply them".
- A **course** orders sections and modules into a learning path.
- Everything you create is a **draft**; a human publishes later.

---

## Phase 1 — Discover (gather content & intent)

Don't ask twenty questions. Get the few things that determine the design, and when the user
is vague, **propose a concrete straw-man and let them correct it** — that is faster and gives
them something to react to.

Elicit (in roughly this order):

1. **Goal & topic** — what should a learner get out of this? One or two sentences.
2. **Audience** — who are they (role, seniority, prior knowledge)? This sets level, tone,
   examples, and language.
3. **Learning objectives** — the backbone. Phrase each as *"After this, a learner can ___"*
   (identify…, apply…, decide…, explain…). Everything downstream derives from these. If the
   user hasn't articulated them, propose 3–6 from the topic and confirm.
4. **Source material** — do they have real content to ground this in (a policy, notes, a
   document, a slide deck)? Ask them to paste/describe/upload it. **Ground the content in
   their material; do not invent facts, figures, regulations, or quotes.** If there is no
   source, say so plainly and keep claims general/uncontroversial.
5. **Assessment intent, per objective** — for each objective, is it *recall* (→ lean
   `MCQ_ONLY`), *applied judgment / written reasoning* (→ `FREETEXT_ONLY`), or *both*
   (→ `FREETEXT_PLUS_MCQ`)? You choose the mode; confirm your reasoning with the user.
6. **Scope** — how many modules and sections? If unspecified, propose a lean structure
   (a few well-formed modules beat many thin ones). Map roughly one module per objective.
7. **Language** (`locale`) and **certification level**.

Record the user's stated requirements verbatim in the package's `constraints` (audit trail).

## Phase 2 — Design (turn intent into a course)

**Structure.** Each objective usually becomes: a *section* that teaches it (when the learner
needs input) + a *module* that assesses it. Simple recall objectives may need only a module;
context/background may need only a section. Order so that **teaching precedes assessment**,
with an intro section first and (optionally) a summary section last.

**Pick the mode per module deliberately** (this is the most common design mistake):
- Recognition/recall, unambiguous right answer → `MCQ_ONLY`.
- "Explain / analyse / decide and justify", where the reasoning is the point → `FREETEXT_ONLY`.
- Knowledge that must then be applied → `FREETEXT_PLUS_MCQ`.

**Write real, specific content:**
- *Task text* (free-text modules): a concrete scenario or prompt, not "Discuss X". Give the
  learner something to *do/decide*, ideally grounded in the source material.
- *Rubric criteria*: each criterion tied to the objective, named, with a described scale
  (e.g. `"identifisering": "0–4: identifiserer korrekt grunnlag og avgrenser mot alternativene"`).
  Avoid a lone vague "quality" criterion — criteria must be observable.
- *MCQ questions*: the stem tests **one** idea; 3–4 options; **distractors reflect real
  misconceptions** (plausible, not obviously wrong); exactly one unambiguously correct
  option; a short `rationale` explaining why. Never "all of the above".
- *Assessor expected content* (free-text): what a strong answer contains — this guides the
  LLM grader.

**Scope discipline.** Prefer fewer, well-formed modules. A course that assesses six things
shallowly is worse than one that assesses three things well.

## Phase 3 — Preview & approve (show it BEFORE you build)

**This is mandatory and happens before you build the package, validate, or write anything.**
Render the whole course back to the user *in the conversation*, in readable form, and get
explicit approval. Iterate on their feedback here — it is far cheaper than fixing created
drafts.

Use this shape:

```
## Forslag: <kurstittel>
<én linje om kurset> · Målgruppe: <…> · Språk: <…> · Nivå: <…>

Struktur (rekkefølge):
1. 📄 Seksjon: <tittel>
2. 📝 Modul: <tittel> — <mode> — vurderer: <objektiv>
3. 📝 Modul: <tittel> — <mode> — vurderer: <objektiv>
4. 📄 Seksjon: Oppsummering

---
### 1. Seksjon: <tittel>
<selve innholdet, eller et sammendrag hvis langt>

### 2. Modul: <tittel>  (FREETEXT_ONLY)
**Oppgave:** <task text>
**Vurderingskriterier:** <kriterium 1 (skala)>, <kriterium 2 (skala)>

### 3. Modul: <tittel>  (MCQ_ONLY)
**Spørsmål 1:** <stem>
- a) <option>   b) <option>   c) <option ✓>   d) <option>
  *Riktig: c — <rationale>*
...
```

Then ask, explicitly: **"Ser dette riktig ut? Vil du endre rekkefølge, innhold, oppgaver
eller vurderingsform før jeg oppretter utkastene?"** Only build the package after the user
approves. Re-preview after any substantive change.

## Phase 4 — Export

Once approved, build the `a2-authoring-package/v1`, validate, and create the drafts
(`api-flow.md`). If the validate report surfaces a content problem (e.g. an MCQ missing an
answer), fix it and, if it changed what the learner sees, re-preview.

### Fallback when the agent can't reach the API directly

Some conversational environments can't make outbound calls to the installation. In that
case **do not lose the work** — emit the course to disk in the platform's portable format
and hand it to the user for manual import:

1. Produce an **`a2-content-export/v1` course envelope** (self-contained: inlines each module
   and section payload under `course.items[]` with `sortOrder`; `exportFormat`,
   `exportedAt`, and `audit: {}` on each). The leaf payloads are the *same* shapes as the
   authoring package, so this is a mechanical wrap. See `package-schema.md` for the mapping.
2. Write it to a file, e.g. `kurs-<navn>.json`, and tell the user to import it via the
   existing **admin-UI course import** (Innholdsforvaltning → importer). The import creates
   the same drafts; nothing is published.

This fallback needs no token and no network from the agent — only that the user can save a
file and use the admin UI. Prefer the direct API when it's available (it returns deep links);
use the file fallback when it isn't.
