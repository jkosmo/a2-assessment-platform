# Figure design — "one figure, one point" (Layer B)

How the skill proposes and draws figures inside the gated authoring dialogue. Companion to the
design note `doc/design/COURSE_FIGURES_AND_ASSETS.md` (Layer B). Transport (how a figure travels
through export/import and the authoring package) is Layer A — see `package-schema.md`
§"Section figures/images". This file is about *designing* the figure, grounded in approved text.

## The principle: one figure, one point

**Each figure makes exactly one point.** A figure illustrates a single idea — one process, one
comparison, one relationship — not a whole section compressed into a dense schematic. Prefer
**several simple figures** over one crowded one. This is deliberate:

- **Pedagogy:** one figure → one takeaway is easier to read and remember.
- **Quality:** simple figures are what an LLM can author cleanly as SVG; complex ones drift into
  messy, mislabelled output.
- **Localization & maintenance:** few, short labels translate reliably and survive edits.

A figure earns its place only where it genuinely aids understanding of a discrete visual point —
never decoration, never a catch-all. A short definition is prose, not a diagram.

## Hard rules

1. **SVG only — the agent never generates raster.** SVG is text (the LLM can author it), its
   `<text>` is translatable (#657), it is crisp at any size, and it is sanitisable. Raster
   (PNG/JPEG/GIF/WebP) is **author-supplied only** — carried faithfully through transport, but
   never generated and never "translated" by the agent (baked pixels can't be localized).
2. **Diagram approved text/source — never invent.** A figure diagrams what the confirmed source
   and the element's approved text already say. It introduces **no** data, numbers, steps, or
   relationships the source doesn't support. The "never invent" principle (SKILL.md core rule 1)
   extends to figures. At a genuine gap, leave it out or mark `[Avklaring: …]` — do not draw a
   guess.
3. **One primary language, short labels.** Figure `<text>` is written in the course's one
   confirmed primary language (core rule 5), with short labels (a few words). Translation to the
   other two locales happens after primary approval (see below and `localization.md`).
4. **Plain, translatable `<text>` — never text baked into paths.** Every label is a real `<text>`
   (optionally `<tspan>`) element so #657 SVG localization can extract and translate it. Text
   converted to `<path>`/outlines, or rasterised, is untranslatable and forbidden.
5. **Stay inside the template set.** Use only the four templates below, unless the author
   **explicitly** asks for a free-form figure (an explicit exception, warned as lower-quality and
   harder to localize). The templates keep figures simple by construction.
6. **Sanitiser-safe.** The stored SVG passes A2's `sanitizeSvg` (scripts, `on*` handlers,
   `<foreignObject>`, `<a>` are stripped). Author drawings with none of those — a figure that is
   empty after sanitisation is rejected at validate/import time (`asset_svg_unsanitizable`).

## The template set (the only shapes the skill draws)

| Template | Use it for | One point it makes |
|---|---|---|
| **flow** | a process / sequence of steps | "these steps, in this order" |
| **tree / decision** | branching choices, a hierarchy | "this choice leads here vs there" |
| **boxes-and-arrows** | relationships between a few entities | "A relates to B relates to C" |
| **labelled diagram** | parts of one thing | "this thing has these named parts" |

If the point doesn't fit one of these, it is probably prose — or two simpler figures.

## Ref + markdown

A figure is referenced from the section `bodyMarkdown` as `![alt](asset:<sourceId>)`, where
`<sourceId>` is a client-chosen token `[a-zA-Z0-9_-]{1,64}` that matches the figure's `assets[]`
entry. On create/import A2 remaps `asset:<sourceId>` to the real `SectionAsset` id — leave the ref
pointing at your `sourceId`; never pre-remap it. Every ref needs a matching asset and every asset
should be referenced (validate reports `missing_asset` / `unreferenced_asset`).

## Minimal sanitize-safe SVG skeletons

Fill these in — keep the geometry, replace the `<text>` labels (short, primary language). Always
include `xmlns` and a `viewBox`. No `<script>`, `on*`, `<foreignObject>`, `<a>`, no baked-in text.

### flow
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 80" role="img">
  <rect x="10" y="20" width="120" height="40" rx="6" fill="#eef" stroke="#333"/>
  <text x="70" y="45" text-anchor="middle" font-size="14">Steg 1</text>
  <line x1="130" y1="40" x2="180" y2="40" stroke="#333"/>
  <rect x="180" y="20" width="120" height="40" rx="6" fill="#eef" stroke="#333"/>
  <text x="240" y="45" text-anchor="middle" font-size="14">Steg 2</text>
  <line x1="300" y1="40" x2="350" y2="40" stroke="#333"/>
  <rect x="350" y="20" width="120" height="40" rx="6" fill="#eef" stroke="#333"/>
  <text x="410" y="45" text-anchor="middle" font-size="14">Steg 3</text>
</svg>
```

### tree / decision
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" role="img">
  <rect x="150" y="10" width="100" height="40" rx="6" fill="#eef" stroke="#333"/>
  <text x="200" y="35" text-anchor="middle" font-size="14">Spørsmål</text>
  <line x1="180" y1="50" x2="90" y2="140" stroke="#333"/>
  <line x1="220" y1="50" x2="310" y2="140" stroke="#333"/>
  <rect x="30" y="140" width="120" height="40" rx="6" fill="#efe" stroke="#333"/>
  <text x="90" y="165" text-anchor="middle" font-size="14">Ja → A</text>
  <rect x="250" y="140" width="120" height="40" rx="6" fill="#fee" stroke="#333"/>
  <text x="310" y="165" text-anchor="middle" font-size="14">Nei → B</text>
</svg>
```

### boxes-and-arrows
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 120" role="img">
  <rect x="10" y="40" width="110" height="40" rx="6" fill="#eef" stroke="#333"/>
  <text x="65" y="65" text-anchor="middle" font-size="14">A</text>
  <line x1="120" y1="60" x2="170" y2="60" stroke="#333" marker-end="url(#a)"/>
  <rect x="170" y="40" width="110" height="40" rx="6" fill="#eef" stroke="#333"/>
  <text x="225" y="65" text-anchor="middle" font-size="14">B</text>
  <line x1="280" y1="60" x2="330" y2="60" stroke="#333" marker-end="url(#a)"/>
  <rect x="330" y="40" width="80" height="40" rx="6" fill="#eef" stroke="#333"/>
  <text x="370" y="65" text-anchor="middle" font-size="14">C</text>
  <defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L6,3 L0,6 Z" fill="#333"/></marker></defs>
</svg>
```

### labelled diagram
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img">
  <circle cx="160" cy="100" r="70" fill="#eef" stroke="#333"/>
  <line x1="160" y1="30" x2="160" y2="10" stroke="#333"/>
  <text x="160" y="8" text-anchor="middle" font-size="13">Del 1</text>
  <line x1="228" y1="118" x2="250" y2="128" stroke="#333"/>
  <text x="252" y="132" font-size="13">Del 2</text>
  <line x1="92" y1="118" x2="70" y2="128" stroke="#333"/>
  <text x="10" y="132" font-size="13">Del 3</text>
</svg>
```

## Localization of figures (after primary approval)

Once the primary-language course is approved, each text-bearing SVG figure gets **localizedVariants**
for the other two locales: translate the `<text>` runs, keep the geometry identical (same number of
labels, same positions). The deterministic `checkLocalization` (`localization-check.mjs`,
`checkFigureLocalization`) verifies every text-bearing SVG has a variant for each other locale, the
variant's label count equals the original's, identifiers/formulas/URLs in labels are preserved, and
the variant is not a blind copy of the original labels. See `localization.md`.

## Preservation

An approved figure is **unique content, not redundancy**. "Remove redundancy" may trim repeated
prose but must never drop an approved figure or empty its labels. `course-state.mjs` treats a
missing figure ref (`asset:<sourceId>`) or an emptied label as a blocking mandatory loss. See
`content-preservation.md`.
