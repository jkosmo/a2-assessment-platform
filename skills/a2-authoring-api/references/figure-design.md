# Figures — which form, how to draw it, how to check it

Contents: [When a figure](#when-a-figure) · [Which form](#which-form) · [Rules for every figure](#rules-for-every-figure) ·
[Flows — drawn by a script](#flows--drawn-by-a-script) · [Still figures — drawn by you](#still-figures--drawn-by-you) ·
[The animated template](#the-animated-template) · [Measure and look](#measure-and-look) ·
[Seeing the figure](#seeing-the-figure) · [In the package](#in-the-package) · [The other languages](#the-other-languages)

## When a figure

A figure is for content whose point is **how things relate**: an order, a hierarchy, a choice, a
matrix, the parts of a whole, events on a line of time. Draw one

- where the source has one — a diagram on a slide, a drawing in a document. It is carried over
  whole: a flow with eight steps in three phases is one figure with eight steps and three phases;
- where the source describes such a relation in words and a drawing shows it better.

There is no number to aim for. A course may need none or ten; the source decides. From a
presentation, the approved slide list says which slides become figures.

What is **not** a figure: frames side by side with text in them (cards), a strip set apart (a
highlighted box), a prompt, a table. Those are written as text —
[section-content.md](section-content.md). A screenshot is included as a picture, not redrawn.

## Which form

| The point is | Form | Drawn by | Moves |
|---|---|---|---|
| steps in an order | **flow** | `scripts/draw-flow-figure.mjs` | yes — the steps light up in turn |
| steps in an order, grouped | **flow with phases** | `scripts/draw-flow-figure.mjs` | yes |
| a choice that leads to different outcomes; a hierarchy | **tree** | you | no |
| who or what stands in which relation to whom | **boxes and arrows** | you | no |
| two dimensions that give four fields | **matrix** | you | no |
| the parts of one thing | **labelled diagram** | you | no |
| events placed in time, with dates or periods | **timeline** | you | no |

A point that fits none of these is drawn freely as a still figure, by the same rules. If the same
thing can be shown as a flow or a timeline, choose by what the source stresses: the order of the
work (flow), or when things happen (timeline).

Say in the gate-3 proposal, per figure, which form it gets and whether it moves.

## Rules for every figure

1. **It shows what the source and the approved text say.** No step, number, arrow or relation the
   source does not support. A gap is left out or marked `[Avklaring: …]`, not drawn as a guess.
2. **SVG, with every label as real text.** `<text>` (and `<tspan>` for a second line) — never
   letters turned into outlines, never a picture of text. Labels are what is translated.
3. **Labels are short, in the course's one language.** A few words. The explanation stands in the
   text under the figure.
4. **Take the colours from the source** where it has them (a presentation's phase colours are
   listed per slide in `slides.md`). Otherwise use the light tones in the skeletons below.
5. **Sans-serif**, set once on the root: `font-family="system-ui, -apple-system, 'Segoe UI',
   Roboto, sans-serif"`.
6. **Nothing the platform removes:** no `<script>`, no `on…` attributes, no `<foreignObject>`, no
   `<a>`. A figure that is empty after cleaning is refused at import.
7. **Always `xmlns` and a `viewBox`.**

## Flows — drawn by a script

Do not write a flow by hand. Describe it, and let the script draw it:

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

```
node scripts/draw-flow-figure.mjs work/figures/saksgang.json work/figures
```

writes `saksgang.svg` (wide: every step on one row) and `saksgang.narrow.svg` (two steps per row,
for a phone). A figure shown as an image cannot re-break itself in a narrow column, so a flow
exists in two layouts; drawn from one description, they cannot disagree. The script runs both
figure checks on each before it writes anything.

- **`name`:** lower-case letters, digits and hyphens. It becomes the file name.
- **Steps:** two to eight, each label one or two short lines. A longer flow is two figures.
- **Phases:** each has a resting colour (`grunn`) and the colour its steps light up in (`lys`),
  both opaque hex. `label` puts a line and a name over the phase's steps; leave it out for a phase
  without a name (a lone first or last step). `tekst` is the colour of that name. A flow without
  groups is one phase without a `label`.
- **When it refuses**, the message names what is wrong — a label too long for the space between
  two steps (`labels_overlap`), a step in a phase that is not listed. Shorten the label or break
  it differently. Do not edit the drawn SVG to make it fit.
- **A step's icon and explanation** from the source do not go in the figure. Put them in the text
  under it, one line per step ([section-content.md](section-content.md#icons)).
- Keep the description file: it is the figure's source, and the other languages are drawn from
  copies of it.

A flow that should stand still is an explicit choice agreed with the author; say so, and draw it
as a still figure with `data-motion="static"` on the root.

## Still figures — drawn by you

A still figure has **one drawing for every screen**. On a phone the column is about 220 px wide,
and a label must be 9 px there to be read. So:

- keep the `viewBox` at most **340 wide**, with labels at `font-size="14"` (13 for a secondary
  label). Stack downwards instead of spreading sideways;
- state the figure's size on the root — `width` and `height` equal to the `viewBox` — so that it
  is shown at that size on a wide screen and not stretched to fill the column.

Start from the skeleton that fits. Keep its geometry where you can; replace the labels; add boxes
by the same pattern.

### tree

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 190" width="340" height="190" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <rect x="110" y="10" width="120" height="44" rx="6" fill="#eef" stroke="#333"/>
  <text x="170" y="37" text-anchor="middle" font-size="14">Spørsmål</text>
  <line x1="150" y1="54" x2="85" y2="130" stroke="#333"/>
  <line x1="190" y1="54" x2="255" y2="130" stroke="#333"/>
  <text x="96" y="96" text-anchor="end" font-size="13">Ja</text>
  <text x="244" y="96" font-size="13">Nei</text>
  <rect x="20" y="130" width="130" height="44" rx="6" fill="#efe" stroke="#333"/>
  <text x="85" y="157" text-anchor="middle" font-size="14">Utfall A</text>
  <rect x="190" y="130" width="130" height="44" rx="6" fill="#fee" stroke="#333"/>
  <text x="255" y="157" text-anchor="middle" font-size="14">Utfall B</text>
</svg>
```

### boxes and arrows

Boxes in a row or column joined by lines look like a flow to the motion check. This figure is not
one — the point is the relation, written on each arrow — so it carries `data-motion="static"`.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 250" width="340" height="250" role="img" data-motion="static"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <defs><marker id="pil" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L6,3 L0,6 Z" fill="#333"/></marker></defs>
  <rect x="20" y="10" width="160" height="44" rx="6" fill="#eef" stroke="#333"/>
  <text x="100" y="37" text-anchor="middle" font-size="14">Enhet A</text>
  <line x1="100" y1="54" x2="100" y2="100" stroke="#333" marker-end="url(#pil)"/>
  <text x="114" y="82" font-size="13">gir oppdrag til</text>
  <rect x="20" y="103" width="160" height="44" rx="6" fill="#eef" stroke="#333"/>
  <text x="100" y="130" text-anchor="middle" font-size="14">Enhet B</text>
  <line x1="100" y1="147" x2="100" y2="193" stroke="#333" marker-end="url(#pil)"/>
  <text x="114" y="175" font-size="13">fordeler arbeid til</text>
  <rect x="20" y="196" width="160" height="44" rx="6" fill="#eef" stroke="#333"/>
  <text x="100" y="223" text-anchor="middle" font-size="14">Enhet C</text>
</svg>
```

### matrix

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 310" width="340" height="310" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <text x="8" y="16" font-size="13" font-weight="600">Verdi</text>
  <text x="44" y="84" text-anchor="end" font-size="13">Høy</text>
  <text x="44" y="204" text-anchor="end" font-size="13">Lav</text>
  <rect x="52" y="24" width="135" height="110" fill="#efe" stroke="#333"/>
  <text x="119.5" y="84" text-anchor="middle" font-size="14">Gjør først</text>
  <rect x="195" y="24" width="135" height="110" fill="#eef" stroke="#333"/>
  <text x="262.5" y="84" text-anchor="middle" font-size="14">Planlegg</text>
  <rect x="52" y="144" width="135" height="110" fill="#eef" stroke="#333"/>
  <text x="119.5" y="204" text-anchor="middle" font-size="14">Ta ved ledig tid</text>
  <rect x="195" y="144" width="135" height="110" fill="#fee" stroke="#333"/>
  <text x="262.5" y="204" text-anchor="middle" font-size="14">La være</text>
  <text x="119.5" y="274" text-anchor="middle" font-size="13">Liten</text>
  <text x="262.5" y="274" text-anchor="middle" font-size="13">Stor</text>
  <text x="191" y="298" text-anchor="middle" font-size="13" font-weight="600">Innsats</text>
</svg>
```

### labelled diagram

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" role="img"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <circle cx="160" cy="105" r="66" fill="#eef" stroke="#333"/>
  <line x1="160" y1="39" x2="160" y2="24" stroke="#333"/>
  <text x="160" y="18" text-anchor="middle" font-size="14">Del 1</text>
  <line x1="224" y1="122" x2="246" y2="132" stroke="#333"/>
  <text x="250" y="137" font-size="14">Del 2</text>
  <line x1="96" y1="122" x2="74" y2="132" stroke="#333"/>
  <text x="70" y="137" text-anchor="end" font-size="14">Del 3</text>
</svg>
```

### timeline

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 200" width="340" height="200" role="img" data-motion="static"
     font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
  <line x1="30" y1="20" x2="30" y2="180" stroke="#333" stroke-width="2"/>
  <circle cx="30" cy="34" r="7" fill="#eef" stroke="#333"/>
  <text x="52" y="30" font-size="13" font-weight="600">Uke 1</text>
  <text x="52" y="48" font-size="14">Oppstart og avklaring</text>
  <circle cx="30" cy="100" r="7" fill="#eef" stroke="#333"/>
  <text x="52" y="96" font-size="13" font-weight="600">Uke 2–3</text>
  <text x="52" y="114" font-size="14">Arbeid med eget case</text>
  <circle cx="30" cy="166" r="7" fill="#eef" stroke="#333"/>
  <text x="52" y="162" font-size="13" font-weight="600">Uke 4</text>
  <text x="52" y="180" font-size="14">Innlevering</text>
</svg>
```

## The animated template

You do not write these two by hand — `draw-flow-figure.mjs` does. They are printed here because
`scripts/figure-motion-check.mjs` compares every animated figure with them: an animated figure
**is** this template, or it is refused (`unsupported_animation_form`), also when its CSS is valid.
A check that lists unsafe forms always misses the next one; the template is the one form that has
been measured on the platform.

### flow (animated)

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

Each step is a circle with its number in it and its label under it. A step rests in its phase's
light tone (`--grunn`) and lights up in the strong one (`--lys`), the colour of the phase line
above it.

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

### What the check holds an animated figure to

| May differ | Must stay |
|---|---|
| the colours — base fill, stroke, highlight — as **opaque hex**, `#rgb` or `#rrggbb` | the class names `steg`, `s1`, `s2`, … and the keyframes name `lys` |
| the duration in `.steg { animation: lys <n>s ease-in-out 1; }` — at least 0.3 s | `ease-in-out`, the count `1`, the shorthand form |
| the delays, and the number of `.sN` delay rules (one per step after the first), each larger than the one before | the order of the rules, and the reduced-motion rule as the last one |
| line breaks and spacing | one `<style>` block with no attributes, nothing else in it, and no comments in it |
| a colour per phase: the four colours as `var(--grunn)`, `var(--lys)`, `var(--lys)`, `var(--grunn)`, then one rule per phase, `.<name> { --grunn: <hex>; --lys: <hex>; }`, after the delay rules | all four colours as variables, or all four as hex — never a mix. Every step carries exactly one phase class, and every phase rule is used |

The markup is the template too: one `<svg>`; one `<style>`; every `<rect>` and `<circle>` is a
step with `class="steg sN"`; `<line>`, `<polyline>` and `<path>` are open connectors
(`fill="none"`); `<text>` and `<tspan>` are labels and never carry `class="steg"`; `<title>` and
`<desc>` name the figure. No `<g>`, no `<defs>`, no other shapes, no `transform`, no `style=""`
attributes.

- **Runs once, done within 5 seconds** (largest delay + duration). An image has no pause button.
- **The still picture is the whole figure.** Before the animation, after it, and with reduced
  motion, every step and label is visible. Nothing is hidden with `display`, `visibility` or
  `opacity`.
- **No backslash and no character reference** (`&#97;`) in a `<style>` block or a `style`
  attribute, in a still figure too (`css_escape`). `&gt;`, `&lt;`, `&amp;`, `&quot;` and `&apos;`
  are fine.
- **No `<animate>`, `<set>`, `<animateTransform>` or `<animateMotion>`** (`not_css_only`).
- **Translations keep the motion:** a language variant changes only the labels.

## Measure and look

Valid SVG is not a finished figure: a label longer than its box, text on an arrow, a label cut
off at the edge. Every figure — **and every language variant**, because the Nynorsk or English
label is often longer — goes through both steps before the author sees it and before it goes
into the package.

1. **Measure.**

   ```
   node scripts/figure-fit-check.mjs work/figures/figure.svg
   node scripts/figure-motion-check.mjs work/figures/figure.svg
   ```

   The fit check estimates every label against its box and the `viewBox`, and labels that stand
   free against each other (`labels_overlap`) and against lines drawn through them
   (`stroke_through_label`). The motion check fails a figure that looks like a flow (three
   labelled boxes or circles in a row or column, joined by lines) and is neither animated nor
   marked `data-motion="static"`, and any animated figure that is not the template. Both are a
   little strict on purpose. A `FAIL` is a figure you fix.
2. **Look.** Render it and inspect the image — the estimate does not see a curved path through a
   label, a label on top of a shape, an ugly break. Check: every label inside its shape with air
   around it; nothing crossing a line or arrow; no two labels touching; nothing cut off.

If either step fails: widen the box, shorten the label, break it with `<tspan>` lines, or enlarge
the `viewBox` — then run both again.

## Seeing the figure

**Never show a figure by pasting its SVG source into the chat.** Most chats print it as tags, and
the author is then asked to approve a figure nobody has seen.

**For the author — always the same step:**

```
node scripts/figure-preview.mjs work/figures/figure.svg work/figures/figure.narrow.svg --out work/preview.html
```

It writes one page that shows each figure the way the platform shows it — as an image — in a wide
column and in the column a phone gives (220 px), with a button that plays the animation again.
Put the page in front of the author with what the host offers, in this order:

| The host has | Do this |
|---|---|
| a preview pane that renders HTML | show `preview.html` there |
| file download or attachment | give the author `preview.html` and say: "åpne den i nettleseren" |
| neither | say so plainly, and describe the figure in words — do not print the source and call it shown |

Describe the figure in words as well, every time ("flyt: Motta saken → Sjekk vedlegg → Skriv
vedtaket → Arkiver; stegene lyser opp etter tur, én gang, ca. 4 sekunder"): a picture shows one
frame, and the words are how the author approves the motion.

**For you — the look step.** You need an image you can open.

| Where you run | Render with |
|---|---|
| a sandbox with a rasteriser (cairosvg, `rsvg-convert`, ImageMagick, Inkscape) | render **`figure.still.svg`**, which `figure-preview.mjs` writes next to the figure — for example `python3 -c "import cairosvg; cairosvg.svg2png(url='figure.still.svg', write_to='figure.png', output_width=1200)"` |
| an environment with Playwright installed | `npx playwright screenshot --viewport-size=800,700 file:///<abs-path>/figure.svg figure.png`. The window is 700 high because the narrow layout is up to 590 px tall and is shown at its own size. Do not use `--full-page`: on an SVG file the command never finishes |
| nowhere that can render | you cannot do the look step. **Say so** — "målt, men ikke sett: jeg har ingen måte å rendre figuren på her" — and ask the author to look at the preview with the checklist above |

Why the still file: renderers that are not browsers do not read CSS variables or animations, and
draw a flow with phases with **black steps**. `figure.still.svg` is the same figure at rest, with
the colours written straight on the steps and no `<style>` block. It is for looking at; the
package carries the figure itself.

## In the package

A figure is an entry in its section's `assets[]`, shown in the text as
`![what the figure shows](asset:<sourceId>)`. Point at the files; `produce-course.mjs` attaches
them:

```json
{ "sourceId": "fig-saksgang", "file": "figures/saksgang.svg", "sourceLocale": "nb",
  "localizedVariants": [
    { "locale": "nn", "file": "figures/saksgang-nn.svg" },
    { "locale": "en-GB", "file": "figures/saksgang-en.svg" } ],
  "layoutVariants": [
    { "layout": "narrow", "file": "figures/saksgang.narrow.svg",
      "localizedVariants": [
        { "locale": "nn", "file": "figures/saksgang-nn.narrow.svg" },
        { "locale": "en-GB", "file": "figures/saksgang-en.narrow.svg" } ] } ] }
```

A still figure has no `layoutVariants`. The alt text says what the figure shows, in one sentence,
for a reader who cannot see it. Full field list: [package-schema.md](package-schema.md#pictures-and-figures--assets).

An approved figure is approved content: record it in the course state with its labels
([content-preservation.md](content-preservation.md)), so that a later shortening cannot drop it.

## The other languages

After the primary language is approved, every figure with labels is drawn again for the other two
languages, with **identical geometry**:

- **A flow:** copy the description file, translate `title`, `desc`, the phase labels and the step
  labels — the same number of lines per label — give it a new `name` (`saksgang-nn`), and run the
  script. Each language gives a wide and a narrow file.
- **A still figure:** copy the SVG and translate the text inside each `<text>` and `<tspan>`. Do
  not move anything. If a translated label no longer fits, widen the box in **all** languages.

Run measure-and-look on every variant. `produce-course.mjs` reports a figure that lacks a
language, has a different number of labels, has lost a formula or an identifier, or whose labels
were copied instead of translated ([localization.md](localization.md)).
