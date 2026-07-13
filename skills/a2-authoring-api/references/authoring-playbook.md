# Authoring playbook — running the gated authoring dialogue

The craft behind each gate in SKILL.md's **normal track**: how to locate source material,
agree objectives, agree structure, write each element (grounded, never invented), QA against
the objectives, and produce. The mechanics (package format, API calls) are in
`package-schema.md` and `api-flow.md`.

The platform model that shapes everything:
- **Learning sections teach** (markdown, no assessment).
- **Modules assess**, in one mode: `MCQ_ONLY` (recognition/recall), `FREETEXT_ONLY` (applied
  judgment / written reasoning), `FREETEXT_PLUS_MCQ` (both).
- A **course** orders sections and modules into a path.
- Everything you create is a **draft**; a human publishes later.

**Non-negotiable (from SKILL.md):** never write content without a traceable source; at a genuine
gap use `[Avklaring: …]`, never invention; don't produce content before its gate is approved.

---

## Gate 1 — Source

The most important gate, and the one that prevents "the agent spun off and invented a course."
Establish what the course is built on **before** proposing objectives.

1. Ask what the course should be based on. Three legitimate sources:
   - **Uploaded/pasted material** (a policy, notes, a document, a deck) — preferred.
   - **Web search** — the author may ask you to help find authoritative material. Search, then
     **present the sources you found (title + what each covers) and let the author confirm which
     to use.** The author is ultimately responsible for the content; your job is to ground it in
     sources they have seen and accepted, not to substitute your own recall.
   - **The author's own explicit input** (they dictate the substance).
2. If nothing is available and the author does not want to supply or web-source material, do
   **not** silently invent a course. Say so, and offer the opt-in path explicitly: *"Jeg har
   ikke noe kildemateriale å bygge på. Vil du at jeg lager et ubekreftet utkast fra allmenn
   kunnskap som du selv må verifisere? Alt vil bli merket [Avklaring]."* Proceed on general
   knowledge only if they say yes (this is the `auto` posture; keep the draft clearly flagged).
3. Record the confirmed sources — you will cite them into `constraints` at production, and QA
   (gate 5) re-reads them.

Do not move to objectives until the source basis is confirmed (or the author has explicitly
opted into an unsourced draft).

## Gate 2 — Learning objectives

Objectives are the backbone; structure and assessment derive from them.

- **Confirm the course's primary language here** (default to the language of the source material).
  Everything downstream — every title, task, rubric and MCQ — is written in this one language; do
  not switch languages between elements (core principle 5).
- Derive 3–6 objectives **from the confirmed source**, each phrased *"After this, a learner can
  ___"* (identify…, apply…, decide…, explain…), in the confirmed language. Ground each in
  something the source supports.
- Present them and ask if they're right. Add/cut/reword on the author's steer.
- If an objective can't be supported by the source, flag it (`[Avklaring: …]`) rather than
  inventing support for it.

Stop and get the objectives approved before proposing structure.

## Gate 3 — Structure

Turn approved objectives into a concrete outline, and confirm it before writing any content.

- **Map each objective** to: a section that teaches it (when the learner needs input) + a module
  that assesses it. Simple recall may need only a module; background may need only a section.
- **Choose the assessment mode per module deliberately** (the most common design mistake):
  - recognition / recall / unambiguous right answer → `MCQ_ONLY`
  - "explain / analyse / decide and justify", where the reasoning is the point → `FREETEXT_ONLY`
  - knowledge that must then be applied → `FREETEXT_PLUS_MCQ`
- **Order** so teaching precedes assessment; intro section first, optional summary last.
- **Scope discipline:** prefer a few well-formed modules over many thin ones. Map roughly one
  module per objective.

Present the outline as a table (sections + modules, order, mode, which objective each assesses)
and iterate until the author confirms it. No element content is written yet.

**Propose figure placements here (Layer B).** As you agree the structure, flag sections that would
otherwise be dense prose and propose **where a figure earns its place — one simple figure per
discrete visual point** (a process → a **flow**; a set of options/branches → a **tree/decision**; a
few related entities → **boxes-and-arrows**; the parts of one thing → a **labelled diagram**).
Several small figures beat one crowded one; a short definition stays prose. Propose *placements*
only (which point, which template) — you draw the SVG at Gate 4 with the text. The author confirms
which figures to design. See `figure-design.md`.

## Gate 4 — Each element (one at a time)

Now write content, **one element per turn**, grounded in the source, and get each approved
before the next. Do not dump all elements at once.

Per module, write real, specific, sourced content:
- **Task text** (free-text modules): a concrete scenario or prompt tied to the source — give the
  learner something to *do/decide*, not "Discuss X".
- **Rubric criteria:** each tied to the objective, named, with a described scale (e.g.
  `"identifisering": "0–4: identifiserer korrekt grunnlag og avgrenser mot alternativene"`).
  No lone vague "quality" criterion — criteria must be observable.
- **Assessor expected content:** what a strong answer contains (guides the LLM grader).
- **MCQ questions:** stem tests one idea; 3–4 options; **distractors are real misconceptions**
  (plausible, not obviously wrong); exactly one unambiguously correct option; a short `rationale`.
  Never "all of the above".

Per section: the teaching markdown, grounded in the source. Summarise long source rather than
copying it verbatim, and keep claims to what the source supports.

**Draw the figure in the same turn as the text (Layer B).** For each figure agreed at Gate 3,
draft the **SVG in the same turn as the element's text** so they are reviewed as one integrated
unit. The figure **diagrams what the text/source says — it never invents** data, numbers or
relationships the source doesn't support. Use a template skeleton from `figure-design.md`, keep
labels short and in the one primary language as plain `<text>` (never baked into paths), reference
it from the markdown as `![alt](asset:<sourceId>)`. **Present the figure *with* the text in the
preview** — show the SVG inline (rendered) AND describe it in words ("flyt: Motta sak → Vurder
grunnlag → Fatt vedtak") so the author can approve the integrated whole: *"ser tekst + figur
riktig ut sammen?"*. One figure, one point — if it's getting crowded, split it.

Anything the source doesn't cover → `[Avklaring: …]`, not invention (figures included). Approve
each element (text + figure together), then move to the next.

## Gate 5 — External QA (against the objectives)

An independent check that the course delivers the objectives — a real second opinion, not a
rubber stamp.

- **Prefer a separate agent where the environment allows it** (Claude Code / orchestrated). Give
  it only the confirmed source, the objectives, and the finished course; ask it to verify each
  objective is both **taught** (a section covers it) and **assessed** (a module tests it), and to
  list gaps, overclaims (content not supported by the source), and un-assessed objectives. The
  fresh context avoids the author-agent's anchoring bias.
- **In a single-context chat**, do the equivalent as a deliberate fresh pass: re-derive the
  objectives from the source in isolation, then audit the course against them.
- **Check language consistency:** every title, task, rubric and MCQ must be in the one confirmed
  language. Flag any element that drifted (e.g. an English module title in a Norwegian course) —
  this is a real, easy-to-miss failure; fix it before producing.
- **Check the figures (Layer B):** each figure makes **one point** and no more; it **matches the
  approved text** (diagrams it, invents nothing beyond it); its labels are short and in the **one
  primary language**; it is SVG with real `<text>` (not raster, not text-as-paths). Flag a figure
  that is decorative, over-packed, contradicts the text, or has drifted language — fix before
  producing.
- Report findings to the author; fix gaps/overclaims before producing. Overclaims are resolved by
  softening to what the source supports or by `[Avklaring: …]`, never by inventing support.

## Gate 6 — Produce

Only after QA passes and the author approves:

1. Build the `a2-authoring-package/v1` (`package-schema.md`). Put the author's stated
   requirements **and the confirmed sources** into `constraints` (audit trail). **Attach the
   figures (Layer B):** for every section with an approved figure, add the SVG (and its localized
   variants) to that section payload's `assets[]` — `{ sourceId, filename, mimeType:
   "image/svg+xml", sizeBytes, contentBase64, sourceLocale, localizedVariants }` — and keep the
   markdown ref as `asset:<sourceId>` (the server remaps it on create/import; never pre-remap).
   Every `asset:<ref>` needs a matching entry and vice versa.
2. Validate (dry-run) and fix errors; if a fix changes what the learner sees, re-confirm with the
   author. Validate now also checks figures: `missing_asset` / `unreferenced_asset`, mime,
   per-asset size, and that each SVG survives sanitisation.
3. Create the drafts in plan order (`api-flow.md`). Section create carries `assets[]`; the response
   returns an `assetMap` (`sourceId → assetId`) and the persisted markdown already points at the
   new asset ids. Report admin links + `agentRunId`, and remind the author to review and publish
   manually.

### Fallback when the agent can't reach the API

Some conversational environments can't make outbound calls. Don't lose the work — emit an
**`a2-content-export/v1` course envelope** to a file and have the author import it via the admin-UI
course import:

1. Produce a self-contained course envelope (inline each module/section payload under
   `course.items[]` with `sortOrder`; `exportFormat`, `exportedAt`, `audit: {}`). Leaf payloads
   are identical to the authoring package — a mechanical re-wrap; see `package-schema.md`
   §"Fallback format". **Figures travel too:** each section's `assets[]` (SVG + localized
   variants, base64) rides along in the envelope, and the `asset:<sourceId>` refs are remapped on
   import (Layer A). Stay within the caps (5 MB/asset, 25 MB total decoded).
2. Write it to `kurs-<navn>.json` and tell the author to import via **Innholdsforvaltning → Kurs →
   Importer kurs-pakke**. It creates the same drafts; nothing is published.
3. **Validate before delivering.** Generate the file with `buildFallbackEnvelope`, then run the
   read-back **round-trip** (`roundTripFallbackExport`) against the same schema as A2's import —
   the file is not "validated" until this passes, and the validated file is the delivered file.
   Report the named checks (never a generic "validated"). See
   [export-validation.md](export-validation.md).
4. **Write it ASCII-safe (#754).** The round-trip emits the JSON with every non-ASCII char escaped as
   `\uXXXX` and fails delivery on any mojibake, so `æ/ø/å` survive download/import intact. If you
   hand-write the file (no script), escape non-ASCII yourself — a raw UTF-8 file re-encoded as
   Latin-1 turns Norwegian text into `Ã¦/Ã¸/Ã¥` in the imported course.

No token or network needed — only that the author can save a file and use the admin UI.
