# Course figures & assets — design note

Status: **design** (not yet implemented). Companion to issue #749 (asset transport) and the
`a2-authoring-api` skill (EPIC #647). Builds on the existing section-asset system (#483/F4) and
localized-SVG mechanism (#657).

## Why this matters (motivation)

Agent-authored courses and sections easily become **walls of text**. Many learners understand
concepts far better when figures and illustrations *supplement* the prose — a diagram of a
process, a decision tree, a labelled schematic. Three consequences shape this design:

1. **Figures are part of authoring, not an afterthought.** They must be designed *together with*
   the text so text + figure + illustration form one integrated whole — not bolted on after the
   prose is finished.
2. **Authors need help designing figures.** A subject-matter owner should not have to open a
   drawing tool. The skill should propose *where* a visual helps and *draft the figure itself*,
   grounded in the same source as the text.
3. **Figures with text must be translated.** The platform supports `nb`/`nn`/`en-GB`; a figure
   whose labels are in one language breaks the multilingual promise. Figure text must localize
   alongside the prose.

## Core principle: one figure, one point

**Keep figures simple — each figure makes exactly one point.** A figure is not a place to pack a
whole section into one dense diagram; it illustrates a single idea (one process, one comparison,
one relationship). Prefer **several simple figures** over one complex one. This is deliberate on
three fronts:

- **Pedagogy:** one figure → one takeaway is easier to read and remember than a busy schematic.
- **Quality:** simple figures are what an LLM can author cleanly as SVG; complex ones drift into
  messy, mislabelled output.
- **Localization & maintenance:** few, short labels translate reliably and survive edits.

This principle drives the rest of the design: the skill proposes **one simple figure per discrete
visual point**, drawn from a small set of simple templates — not bespoke mega-diagrams.

## Two layers

- **Layer A — Asset transport (foundation).** Export, import and the skill's fallback must carry
  the binary/figure content, not just markdown references. Without this, any figure is lost the
  moment content moves between environments. This is issue #749; summarized below.
- **Layer B — Skill-assisted figure design (the value).** The authoring dialogue actively designs
  figures (as SVG) integrated with the text, and localizes them. This is the new work this note
  motivates.

Layer A must land first — it is the pipe everything else flows through.

## Why SVG is the primary medium

| | LLM can author it | Text is translatable | Crisp/scalable | Sanitizable |
|---|---|---|---|---|
| **SVG** | ✅ (it is text) | ✅ (`<text>` per #657) | ✅ | ✅ (existing sanitizer) |
| Raster (PNG/JPEG) | ❌ | ❌ (baked pixels) | ❌ | n/a |

So **the skill designs figures as SVG.** Raster images remain **author-supplied only** — carried
through export/import faithfully, but never generated or "translated" by the agent. This is not a
limitation to apologize for: SVG diagrams (flows, trees, schematics, labelled boxes) are exactly
the figure types that supplement instructional text, and they are the ones that localize.

## Layer A — Asset transport (foundation, #749)

Section figures live as `SectionAsset` (blob in storage; markdown refs `![alt](asset:<id>)`;
localized SVG variants via `sourceLocale` + `localizedBlobPaths`, #657). Today export is
markdown-only, so the blobs are dropped and imported figures break.

Design (full detail in #749): extend `a2-content-export/v1` **additively** — the section payload
gains an optional `assets[]` with `sourceId`, `filename`, `mimeType`, `sizeBytes`,
`contentBase64`, and optional `sourceLocale` + `localizedVariants[]` (base64 per locale). Export
inlines the blobs (base64); import decodes → **sanitizes SVG** → `putAsset` → creates
`SectionAsset` rows → builds a `sourceId → newId` map → rewrites the section's `bodyMarkdown` refs
before saving. One self-contained JSON file (fits the existing import UI and the skill's fallback).
Guards: per-asset `MAX_ASSET_BYTES`, a total-envelope cap, an SVG sanitizer + mime allowlist, and a
**raised course-import body limit** (inline assets make bodies large). Old asset-less v1 files
import unchanged.

## Layer B — Skill-assisted figure design (integrated with text)

The figure work hooks into the skill's existing gated flow (Source → Objectives → Structure →
Per-element → External QA → Produce), not as a separate phase.

### Where figures are decided — Structure gate
When agreeing the structure, the skill flags sections/modules that would otherwise be dense prose
and **proposes where a figure earns its place — one simple figure per discrete visual point**
(a process → a flow diagram; a set of options → a decision tree; a relationship → a labelled
schematic). Several small figures across a section beat one crowded diagram. The author confirms
which figures to design. A figure is proposed only where it genuinely aids understanding of a
single point — not decoration, and never as a catch-all.

### Where figures are drawn — Per-element gate
The figure is designed **in the same turn as the element's text**, so they are reviewed as one
integrated unit, not sequentially. For each figure the skill:
- Drafts an **SVG** grounded in the source and the element's text — it diagrams what the text
  says; it does **not** invent data, numbers, or relationships the source doesn't support
  (core "never invent" principle extends to figures).
- Keeps labels short and in the course's **one confirmed primary language** (the one-language
  rule extends to figure text).
- Uses clean, translatable `<text>` elements (not text baked into paths) so #657 localization
  works.
- Presents the figure **with** the text in the preview so the author approves the integrated whole
  ("ser tekst + figur riktig ut sammen?").

### Localization — after primary approval
When the primary-language course is approved, localization (per #762) produces real translations
for `nb`/`nn`/`en-GB` — and this now includes **figure text**. Each SVG figure gets localized
variants (the `<text>` translated per locale) exactly as #657 already does for section assets. The
localization check extends to figures: every figure present in all three languages, structure
unchanged (no lost labels), identifiers/formulas/URLs in labels preserved, not a blind copy.

### Preservation — figures are part of the master
Approved figures are recorded in the course master (#762). "Remove redundancy" may trim repeated
prose but must **never drop an approved figure** or strip its labels — a figure is unique content,
not redundancy. The loss audit treats a missing/emptied approved figure as unexpectedly-missing
(blocks production).

## How a figure flows end-to-end

1. **Authoring package** (`a2-authoring-package/v1`): section payload carries optional `assets[]`
   (SVG source as base64/inline) + localized variants; markdown references them.
2. **Validate** (AA-1): every `asset:<ref>` in markdown has a matching `assets[]` entry and vice
   versa; SVG is sanitizable; sizes within caps.
3. **Create / import**: figures become `SectionAsset` rows + blobs (Layer A); refs remapped.
4. **Export / round-trip**: figures + localized variants travel with the course; re-import in
   another installation preserves them.

## Design decisions

- **SVG-first for agent-designed figures; raster author-supplied only.** (Rationale above.)
- **Figures designed with text, in the Per-element gate** — not a separate figure phase — so the
  integrated whole is what the author approves.
- **Figure text obeys the one-language + localization rules** and reuses the #657 SVG-localization
  mechanism rather than inventing a new one.
- **Additive transport** (`a2-content-export/v1` optional `assets[]`) — no breaking change.
- **Never invent figure content** — a figure diagrams the source/text; it does not fabricate data.

## Open questions

- **When does a figure earn its place?** A heuristic/checklist for the Structure gate (process,
  comparison, hierarchy, spatial/relational content → figure; a short definition → prose). Worth
  pinning so the skill neither under- nor over-produces figures.
- **Figure fidelity vs. LLM SVG quality.** LLM-authored SVG can be rough. **Decision (per the
  one-figure-one-point principle): constrain to a small set of simple templates** (flow, tree,
  boxes-and-arrows, labelled diagram) the skill fills in — this raises quality and localizability
  and keeps figures simple by construction. Open sub-question: the exact template set and whether
  authors can request a free-form figure as an explicit exception.
- **Total-envelope size cap** and behaviour on exceed (block vs. omit-with-warning) — from #749.
- **`v1.1` marker vs. purely additive `v1`** — from #749.
- **Raster localization gap:** author-supplied raster figures with baked-in text can't be
  localized. Flag them in the localization check as untranslatable, and advise authors to prefer
  SVG for anything with text.

## Phasing

1. **Phase 1 — Layer A (transport), #749.** Export/import/skill carry assets; SVG sanitized;
   round-trip preserves figures + localized variants. Foundation; unblocks everything.
2. **Phase 2 — Layer B (skill figure design).** The skill proposes and drafts SVG figures in the
   gated flow, integrated with text, localized per #657, preserved per #762. Depends on Phase 1.

## References
- #749 — asset transport (export/import/skill) — Layer A.
- #483 / F4 — section assets (blob storage, `asset:` refs).
- #657 — localized SVG variants (`sourceLocale`, `localizedBlobPaths`, `<text>` translation).
- #762 — skill content-preservation + localization checks (extend to figures).
- EPIC #647 — agent authoring skill; `doc/design/AGENT_AUTHORING_647.md`.
