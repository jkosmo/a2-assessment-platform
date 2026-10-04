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
7. **Sans-serif font.** SVG `<text>` defaults to the browser's serif font, which looks out of place
   against the platform UI. Set `font-family="system-ui, -apple-system, 'Segoe UI', Roboto,
   sans-serif"` **once on the root `<svg>`** (inherited by all labels). `font-family` is a
   presentation attribute the sanitiser keeps — verified.
8. **Animate what happens over time — and only that (#1073).** A figure whose point is an order
   or a change over time (a process, steps in sequence, something travelling from A to B) is drawn
   **animated by default**; everything else stays still. Animation uses CSS only and follows the
   safety rules in [Animation](#animation--where-it-makes-sense-1073). A flow drawn still is an
   explicit choice, marked `data-motion="static"` on the root `<svg>` and agreed with the author.

## The template set (the only shapes the skill draws)

| Template | Use it for | One point it makes | Motion |
|---|---|---|---|
| **flow** | a process / sequence of steps — as boxes, or as numbered circles with a colour per phase | "these steps, in this order" | **animated** (steps light up in turn) |
| **tree / decision** | branching choices, a hierarchy | "this choice leads here vs there" | still |
| **boxes-and-arrows** | relationships between a few entities | "A relates to B relates to C" | still (`data-motion="static"`) — there is no animated template for arrows; if the point is the order, draw it as a **flow** |
| **labelled diagram** | parts of one thing | "this thing has these named parts" | still |

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

### flow (animated)

The steps light up one after another, once, then the figure rests as the plain flow. Keep the
`<style>` block as it is. Change the boxes and labels; in the style block only the colours, the
duration and — if there are more or fewer steps — the delay rules (see
[Animation](#animation--where-it-makes-sense-1073) for exactly what may differ and the timing
budget). `figure-motion-check.mjs` rejects any other change.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 80" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <style>
    .steg { fill: #eef; stroke: #333; }
    @keyframes lys { 0%, 70% { fill: #ffd166; } 100% { fill: #eef; } }
    .steg { animation: lys 1.4s ease-in-out 1; }
    .s2 { animation-delay: 1.2s; }
    .s3 { animation-delay: 2.4s; }
    @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
  </style>
  <rect class="steg s1" x="10" y="20" width="120" height="40" rx="6"/>
  <text x="70" y="45" text-anchor="middle" font-size="14">Steg 1</text>
  <line x1="130" y1="40" x2="180" y2="40" stroke="#333"/>
  <rect class="steg s2" x="180" y="20" width="120" height="40" rx="6"/>
  <text x="240" y="45" text-anchor="middle" font-size="14">Steg 2</text>
  <line x1="300" y1="40" x2="350" y2="40" stroke="#333"/>
  <rect class="steg s3" x="350" y="20" width="120" height="40" rx="6"/>
  <text x="410" y="45" text-anchor="middle" font-size="14">Steg 3</text>
</svg>
```

### flow with phases (animated)

The same flow when the steps belong to **phases** (#1079): each step is a circle with its number
in it and its label under it, and each phase has its own colour. A step rests in the phase's light
tone (`--grunn`) and lights up in the phase's strong tone (`--lys`) — the colour of the phase line
above it. Use it when the source groups the steps (a slide with "Data → Analyse → Bygg" over the
steps); without phases, use the plain flow above.

The style block is the plain flow's with two differences, and both are required together: the
colours are `var(--grunn)` and `var(--lys)`, and one rule per phase gives them their values. Every
step carries exactly one phase class.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432 100" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <style>
    .steg { fill: var(--grunn); stroke: var(--lys); }
    @keyframes lys { 0%, 70% { fill: var(--lys); } 100% { fill: var(--grunn); } }
    .steg { animation: lys 1.2s ease-in-out 1; }
    .s2 { animation-delay: 0.9s; }
    .s3 { animation-delay: 1.8s; }
    .s4 { animation-delay: 2.7s; }
    .fase1 { --grunn: #d9e8dd; --lys: #6fae87; }
    .fase2 { --grunn: #e7e2f0; --lys: #a99bc9; }
    @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
  </style>
  <line x1="12" y1="16" x2="212" y2="16" stroke="#6fae87" stroke-width="3"/>
  <text x="112" y="11" text-anchor="middle" font-size="11" fill="#3f7a57">Fase 1</text>
  <line x1="220" y1="16" x2="420" y2="16" stroke="#a99bc9" stroke-width="3"/>
  <text x="320" y="11" text-anchor="middle" font-size="11" fill="#6b5a94">Fase 2</text>
  <circle class="steg s1 fase1" cx="60" cy="48" r="22"/>
  <text x="60" y="53" text-anchor="middle" font-size="15" font-weight="600">1</text>
  <text x="60" y="88" text-anchor="middle" font-size="12">Steg 1</text>
  <line x1="82" y1="48" x2="142" y2="48" stroke="#8090a9" stroke-width="1.5"/>
  <circle class="steg s2 fase1" cx="164" cy="48" r="22"/>
  <text x="164" y="53" text-anchor="middle" font-size="15" font-weight="600">2</text>
  <text x="164" y="88" text-anchor="middle" font-size="12">Steg 2</text>
  <line x1="186" y1="48" x2="246" y2="48" stroke="#8090a9" stroke-width="1.5"/>
  <circle class="steg s3 fase2" cx="268" cy="48" r="22"/>
  <text x="268" y="53" text-anchor="middle" font-size="15" font-weight="600">3</text>
  <text x="268" y="88" text-anchor="middle" font-size="12">Steg 3</text>
  <line x1="290" y1="48" x2="350" y2="48" stroke="#8090a9" stroke-width="1.5"/>
  <circle class="steg s4 fase2" cx="372" cy="48" r="22"/>
  <text x="372" y="53" text-anchor="middle" font-size="15" font-weight="600">4</text>
  <text x="372" y="88" text-anchor="middle" font-size="12">Steg 4</text>
</svg>
```

**Do not write this figure by hand — describe it and let the script draw it (#1079).** A figure
shown as an image cannot re-break itself when the column is narrow, so a flow with phases exists in
**two layouts**: wide (every step on one row) and narrow (four per row, for a phone). Two
hand-written SVGs drift apart. `draw-flow-figure.mjs` takes one description and draws both, so
they cannot disagree, and it runs both figure checks on each before it returns anything.

```json
{
  "name": "saksgang",
  "title": "Saksgang fra mottak til arkiv",
  "desc": "Fire steg i rekkefølge, fordelt på fasene Forbered og Avslutt.",
  "phases": {
    "forbered": { "label": "Forbered", "grunn": "#d9e8dd", "lys": "#6fae87", "tekst": "#3f7a57" },
    "avslutt": { "label": "Avslutt", "grunn": "#e7e2f0", "lys": "#a99bc9", "tekst": "#6b5a94" }
  },
  "steps": [
    { "label": ["Motta", "saken"], "phase": "forbered" },
    { "label": ["Sjekk", "vedlegg"], "phase": "forbered" },
    { "label": ["Skriv", "vedtaket"], "phase": "avslutt" },
    { "label": ["Arkiver"], "phase": "avslutt" }
  ]
}
```

`node skills/a2-authoring-api/scripts/draw-flow-figure.mjs saksgang.json out/` writes
`out/saksgang.svg` (wide) and `out/saksgang.narrow.svg`.

- **Steps:** two to eight, each label one or two short lines. Eight is where the wide layout's
  labels are still readable in the narrowest column it is shown in; a longer flow is two figures.
- **Phases:** each has a resting colour (`grunn`) and the colour it lights up in (`lys`), both
  opaque hex — take them from the source when it has them. `label` puts a line and a name over the
  phase's steps; leave it out for a phase without one (a lone first or last step). `tekst` is the
  colour of that name.
- **When it refuses:** the message names what is wrong — a label too long for the space between
  two steps (`labels_overlap`), a step in a phase that is not listed. Shorten the label or break it
  differently; do not edit the drawn SVG to make it fit.
- **Both files go in the package.** The **wide** one is the section asset (`contentBase64`); the
  **narrow** one goes in the same asset's `layoutVariants` as `{ "layout": "narrow", … }`
  (package-schema.md). The platform shows the narrow layout when the column the figure stands in is
  under 640 px wide, and the wide one otherwise. Keep the description: it is the figure's source.
- **Locale variants:** copy the description, translate `title`, `desc`, the phase labels and the
  step labels — **same number of lines per label** — and draw again. The geometry is then identical
  by construction, which is what `localizedVariants` requires. Each language gives two files: the
  wide one goes in the asset's `localizedVariants`, the narrow one in the narrow layout's own
  `localizedVariants`. `localization-check.mjs` reports a layout that lacks a language.
- You still **look** at both drawings (see below). The script guarantees the form, not that the
  figure says the right thing.

### tree / decision
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
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
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 120" role="img" data-motion="static"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
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
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <circle cx="160" cy="100" r="70" fill="#eef" stroke="#333"/>
  <line x1="160" y1="30" x2="160" y2="18" stroke="#333"/>
  <text x="160" y="14" text-anchor="middle" font-size="13">Del 1</text>
  <line x1="228" y1="118" x2="250" y2="128" stroke="#333"/>
  <text x="252" y="132" font-size="13">Del 2</text>
  <line x1="92" y1="118" x2="70" y2="128" stroke="#333"/>
  <text x="10" y="132" font-size="13">Del 3</text>
</svg>
```

## Animation — where it makes sense (#1073)

**When.** Animate when the figure's one point is *an order or a change over time*: a process, steps
in sequence, a case moving through a system, a value building up. Motion then carries the point —
the learner sees the order instead of reading it. Do **not** animate a hierarchy, a set of parts, a
comparison or a definition: motion there is decoration, and decoration is noise. When in doubt, ask
the author at the Structure gate; the proposal says, per figure, "animert: ja/nei — fordi …".

**How — CSS only.** A `<style>` block inside the SVG with `@keyframes` and `animation`. Measured on
A2 2026-10-03: the sanitizer keeps CSS and `<animateMotion>`, but strips `<animate>` and `<set>` and
disables `<animateTransform>` — those would silently stop working, so don't use them.
`<animateMotion>` survives the sanitizer, but it is not CSS: the reduced-motion rule below cannot
switch it off, so it is not allowed either (`not_css_only`).

**The figure IS the template (product owner's decisions, 2026-10-04).** An animated figure is the
[flow template](#flow-animated): its `<style>` block **unchanged**, and its markup made of the
template's elements only. The check compares
the block with the template; it does not try to work out what your CSS would do. Anything that is
not the template is `unsupported_animation_form` — including CSS that is perfectly valid.

**Write every character itself — in a still figure too.** No backslash and no character reference
(`&#97;`, `&bsol;`) in a `<style>` block or a `style` attribute: `anim\61tion` and `&#97;nimation`
both run as `animation` once the platform and the browser have read them, and the check cannot see
it. The check refuses them as `css_escape`. `&gt;`, `&lt;`, `&amp;`, `&quot;` and `&apos;` are fine —
that is how those characters are written in XML, and how the platform writes them back. A font name
with a space goes in quotes: `font-family: "Segoe UI"`.

What you may change:

| May differ | Must stay |
|---|---|
| the colours — base fill, stroke, highlight — as **opaque hex**, `#rgb` or `#rrggbb` (no alpha: a transparent base fill makes the boxes vanish from the still picture) | the class names `steg`, `s1`, `s2`, … and the keyframes name `lys` |
| the duration in `.steg { animation: lys <n>s ease-in-out 1; }` — at least 0.3 s, or nobody sees the step light up | `ease-in-out`, the count `1`, the shorthand form |
| the delays, and the number of `.sN` delay rules (one per step after the first) — **each delay larger than the one before**, so the steps light up in order | the order of the rules, and the reduced-motion rule as the last one |
| line breaks and spacing | one `<style>` block, nothing else in it, and **no comments** in it (comment in the markup instead: `<!-- … -->`) |
| **a colour per phase** (the [flow with phases](#flow-with-phases-animated)): the four colours are `var(--grunn)`, `var(--lys)`, `var(--lys)`, `var(--grunn)` exactly as in that template, followed by one rule per phase, `.<name> { --grunn: <hex>; --lys: <hex>; }`, placed after the delay rules. The phase names (lower-case letters, digits, hyphen) and their two colours are yours | all four colours as variables, or all four as hex — never a mix. Every step carries **exactly one** phase class, every phase rule is used by a step, and a phase class sits on a step only. A step without one has a fill nobody set, and is drawn **black** |

**The markup is the template too.** An animated figure is made of these elements and no others:

| Element | Role | Rule |
|---|---|---|
| `<svg>` | the root | exactly one; none nested |
| `<style>` | the template's block | exactly one, **with no attributes** (`media="print"` or `type="…"` would switch the whole block off) |
| `<rect>`, `<circle>` | a step | **every** `<rect>` and `<circle>` is `class="steg sN"` — one per step, `s1` to the last, matching the delay rules. A shape without the class is a step that never lights up |
| `<line>`, `<polyline>`, `<path>` | connectors | open strokes: `<polyline>` and `<path>` carry `fill="none"` and do not end where they began (with or without `Z`). A filled or closed one is a box drawn another way |
| `<text>`, `<tspan>` | labels | never `class="steg"` — it would animate the text and leave the boxes still |
| `<title>`, `<desc>` | accessible name | — |

So: no `<g>`, no `<defs>`/markers, no `<polygon>`/`<ellipse>`, no background panel, no
legend box, and **no `transform` attributes** — place elements with x/y. A step is a rectangle or
a circle. If the figure needs anything else, it is not an animated flow: draw it still
(`data-motion="static"`), where none of this applies. The figure has **no `style=""` attributes**. Colours and sizes
on other elements go in presentation attributes (`fill="…"`, `stroke="…"`), which do what you
expect; a `style` attribute could override the animation.

The last keyframe returns to the base fill (so the figure rests as the plain flow), and the
highlight colour differs from it (otherwise nothing is seen to move). The check verifies both.

Why so strict: this check first read the CSS and tried to predict the browser. Three review rounds
each found six to eight ways round it — a later rule that switches the animation off, a count of 0,
`!important`, a selector that matches no box. A check that lists the unsafe forms always misses the
next one. The template is the one form that has been measured on the platform.

**Safety — the animation must be safe on its own.** The participant view shows figures as `<img>`,
and Chromium does **not** pass the reader's "reduce motion" setting into an SVG shown as an image.
So the template's `@media (prefers-reduced-motion: reduce)` rule is required (it is honoured when
the figure is opened by itself) but it is not enough. In addition:

1. **Run once, finish within 5 seconds** in total (largest delay + duration). Moving content that
   lasts longer needs a pause button (WCAG 2.2.2), and an image has none. With more steps, shorten
   the duration and the gaps between delays so the last step still ends within 5 seconds.
2. **The still picture is the complete figure.** Without the animation — before it starts, after it
   ends, with reduced motion — every box and label is visible. No element is switched off with
   `display="none"`, `visibility="hidden"` or `opacity="0"`. The check catches those attributes; it
   cannot see a box drawn outside the `viewBox` or white on white. **Looking at the rendered still
   picture (below) is the guard for completeness** — the check is not.
3. **Motion carries the point, never the content.** Everything the figure says must be readable in
   the still picture; the animation only shows the order.
4. **Translations keep the motion.** Locale variants change only the `<text>`; the `<style>` block
   is copied as is.

**Check it.** `node skills/a2-authoring-api/scripts/figure-motion-check.mjs figure.svg` — fails on a
flow-shaped figure (three labelled boxes or circles in a row or column, each joined to the next by
a line, polyline or path) that is neither animated
nor marked `data-motion="static"`, and on any animated figure whose style block is not the
template's, whose step classes do not match its delay rules, that runs over 5 s, hides an element
at rest, or uses SMIL. The message says where the block leaves the template. Run it with the fit
check, on
every figure and every locale variant. To *see* the motion, open the SVG directly in a browser —
a single screenshot only shows one frame.

## Mandatory: look at the figure before you show it (#1060)

Valid SVG is not a finished figure. The failure the eyes catch and the schema never will: a label
longer than its box, text sitting on an arrow, a label clipped by the `viewBox`. Every drawn
figure — and later **every locale variant**, because the Nynorsk or English label is often longer
than the Bokmål one the box was sized for — goes through these two steps before it is presented
at the per-element gate or written into the package:

1. **Measure.** `node skills/a2-authoring-api/scripts/figure-fit-check.mjs figure.svg` (and
   `figure-motion-check.mjs` — see [Animation](#animation--where-it-makes-sense-1073)) estimates
   every `<text>` against its enclosing box and the `viewBox` and reports overflows in pixels.
   A label that stands free (under a circle, beside a line) is checked against its neighbours
   instead: two labels that run into each other (`labels_overlap`), and a `<line>` or `<polyline>`
   drawn through a label (`stroke_through_label`).
   It is deliberately a little strict. A `FAIL` is a figure you fix, not a warning you read.
2. **Look.** Render it and inspect the image — the estimate does not see everything (a curved
   `<path>` through a label, a label on top of a shape, an ugly wrap). How you render depends on
   where you are running; see [Seeing the figure](#seeing-the-figure--you-and-the-author) below.
   Check: every label inside its shape with air around it; nothing crossing a line or arrow; no
   two labels touching; nothing cut off at the edge.

If either step fails: widen the box, shorten the label, break it with `<tspan>` lines, or enlarge
the `viewBox` — then run both steps again. Do this per variant, not once per figure.

### Seeing the figure — you and the author

**Never show a figure by pasting its SVG source into the chat.** Most chats print it as tags, and
the author is then asked to approve a figure nobody has seen. This holds in every environment —
it was first reported from a ChatGPT chat.

**For the author — always the same step.** Write the figure(s) to files and run

`node skills/a2-authoring-api/scripts/figure-preview.mjs figure.svg [figure.narrow.svg …] --out preview.html`

It writes one self-contained page that shows each figure the way the platform shows it — as an
image — in a wide column and in a phone-width column, with a button that plays the animation
again. Then put the page in front of the author with what the host offers, in this order:

| The host has | Do this |
|---|---|
| a preview pane that renders HTML (a Claude artifact, a ChatGPT canvas) | show `preview.html` there |
| file download or attachment | give the author `preview.html` (or the `.svg` itself) and say: "open it in your browser" |
| neither | say so plainly, and describe the figure in words — do not print the source and call it shown |

Describe the figure in words as well, every time (see the playbook): a picture shows one frame.

**For you — the look step.** You need an image you can actually inspect.

| Where you run | Render with |
|---|---|
| in this repository (Claude Code, Codex) | `npx playwright screenshot --viewport-size=800,400 file:///<abs-path>/figure.svg figure.png`, then open `figure.png` |
| a sandbox with a rasteriser but no browser (cairosvg, `rsvg-convert`, ImageMagick, Inkscape) | render **`figure.still.svg`**, which `figure-preview.mjs` writes next to the figure — e.g. `python3 -c "import cairosvg; cairosvg.svg2png(url='figure.still.svg', write_to='figure.png', output_width=1200)"` |
| nowhere that can render | you cannot do the look step. **Say so** — "målt, men ikke sett: jeg har ingen måte å rendre figuren på her" — and ask the author to look at the preview with the checklist above |

Why the still file: renderers that are not browsers do not read CSS variables or animations. They
draw the flow with phases with **black steps**, which looks like a broken figure and is not one.
`figure.still.svg` is the same figure at rest, with the colours written straight on the steps and
no `<style>` block. It is for looking at; the package carries the figure itself.

A check you did not run is not a check that passed. If you could not render, the gate message
says "ikke sett", not "ser bra ut".

## Localization of figures (after primary approval)

Once the primary-language course is approved, each text-bearing SVG figure gets **localizedVariants**
for the other two locales: translate the `<text>` runs, keep the geometry identical (same number of
labels, same positions) — and run the measure-and-look step above on **each variant** (#1060); a
longer translation that no longer fits means a wider box in *all* variants, so the geometry stays
identical. The deterministic `checkLocalization` (`localization-check.mjs`,
`checkFigureLocalization`) verifies every text-bearing SVG has a variant for each other locale, the
variant's label count equals the original's, identifiers/formulas/URLs in labels are preserved, and
the variant is not a blind copy of the original labels. See `localization.md`.

## Preservation

An approved figure — including its animation — is **unique content, not redundancy**. "Remove redundancy" may trim repeated
prose but must never drop an approved figure or empty its labels. `course-state.mjs` treats a
missing figure ref (`asset:<sourceId>`) or an emptied label as a blocking mandatory loss. See
`content-preservation.md`.
