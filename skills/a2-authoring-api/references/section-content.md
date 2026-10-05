# Section content — text, boxes, prompts, cards, pictures

Contents: [Writing the text](#writing-the-text) · [Headings and lists](#headings-and-lists) ·
[Table](#table) · [Callout](#callout) · [Prompt](#prompt) · [Cards](#cards) · [Icons](#icons) ·
[Pictures from the source](#pictures-from-the-source) · [Figures](#figures) ·
[A finished section](#a-finished-section)

A section teaches. Its body is markdown (`bodyMarkdown`); the platform renders it and shows
pictures and figures where the text places them.

## Writing the text

- **Write from the source.** Keep to what it supports; mark a gap `[Avklaring: …]`.
- **Write it out.** Slides and notes hint; a learner reading alone needs the sentence. Say in full
  what a bullet point only names, using the speaker notes and any summary.
- **Keep the source's own shape.** What the source sets side by side stays side by side; what it
  sets apart stays set apart; what it numbers stays numbered. The forms below are how.
- **Summarise long source text**; do not copy pages of it.
- **Level** governs how tangled a section may be
  ([course-design.md](course-design.md#level-and-scope)). Length is the author's call.

## Headings and lists

- The section's name is its `title`. Do not repeat it as a heading in the body.
- `##` starts a part of the section. `###` is a card (below) or a sub-part.
- A numbered list for steps in an order; a bulleted list for points without one.
- **Bold** for the term a paragraph is about — not for whole sentences.

## Table

Use a table when the source has one, or when several things are compared on the **same**
properties (each row a thing, each column a property).

```markdown
| Del | Innhold | Hentes fra |
|---|---|---|
| Vedtak | Hva som ble bestemt | Egne notater |
| Oppfølging | Hvem som gjør hva, og når | Egne notater og sakliste |
```

Keep it to four columns where you can: a phone shows a wider table with a scroll bar. A table
with five columns or more from the source is kept whole all the same — do not drop a column to
make it fit.

## Callout

A strip or box the source sets apart — "Husk", "Tips", "Viktig" — becomes a quote that opens with
its label in bold:

```markdown
> **Husk:** Du står ansvarlig for referatet. KI lager bare utkastet.
```

- The label is one word, in the course's language, and is translated with the rest (`Hugs`,
  `Remember`).
- One point per box, in the source's own words where they are short.
- Only what the source sets apart, or what the author asks to have stressed. Ordinary text in a
  box stresses nothing.

## Prompt

A prompt, a template or an example the learner is meant to copy and reuse stands in a fenced
block marked `prompt`:

````markdown
```prompt
Du skal skrive et møtereferat.
Lesere: [hvem som skal lese det]
Form: vedtak først, deretter oppfølgingspunkter med ansvarlig og frist.
Bruk bare det som står i notatene under. Skriv «uklart» der notatene ikke sier noe.

[lim inn notatene]
```
````

- **Word for word from the source.** When the prompt is a screenshot on a slide, type out what
  the picture says — a prompt inside a picture cannot be copied, translated or read aloud.
- What the learner fills in stands in `[square brackets]`.
- A line before the block says what the prompt is for.
- The prompt is translated like the rest of the section. Names of menus and buttons in a product
  stay as the product shows them.

## Cards

Frames side by side on a slide — alternatives, roles, tools, phases, each with a heading and its
own points — become cards: one `###` heading per card, all in a row, each with the same parts in
the same order.

```markdown
### ![](asset:ikon-sakliste) Sakliste

**Bruk når** møtet fulgte en fast plan.

- Gir rekkefølgen i referatet
- Viser hvilke saker som skulle avgjøres

### ![](asset:ikon-notater) Egne notater

**Bruk når** du noterte underveis.

- Fanger vedtak og frister
- Må ryddes før de limes inn
```

- Two to six cards. Keep every frame of the slide, with the slide's own headings.
- Keep the parts inside each frame ("Når bruke", "Fordeler", "Begrensninger") as bold lead-ins or
  short lists, the same in every card.
- A sentence before the first card says what is being set side by side.
- When the frames compare the same few properties in a word or two each, a [table](#table) reads
  better than cards. When each frame holds sentences or lists, use cards.

## Icons

Where the source gives a card an icon, the card keeps it: first in the heading, with empty alt
text (`![](asset:…)`), because the icon repeats the heading and says nothing more.

- **Only the source's own icons** — the files `pptx-extract` puts in `icons/`, named per slide in
  `slides.md`. Never draw an icon, and never fetch one.
- Each icon is an entry in the section's `assets[]`: `{ "sourceId": "ikon-sakliste", "file":
  "deck/icons/image7.svg" }`.
- A flow's steps often carry icons too. They do not go in the figure. Where the slide explains
  each step, put the icon first in that step's row of a table under the figure:

  ```markdown
  | | Steg | Hva du gjør |
  |---|---|---|
  | ![](asset:ikon-oppdrag) | **Forstå oppdraget** | Mandat, målgruppe, krav og rapportmal. |
  ```
- Nowhere else. An icon in running text is noise.

## Pictures from the source

A screenshot that shows **where to click** or what something looks like, and a picture that is
itself the content, are included as they are.

```markdown
Språket i utkastet velger du på innstillingssiden, i feltet som er markert med rødt:

![Innstillingssiden med feltet for språk markert med rød ramme](asset:img-innstillinger)
```

- The **alt text** says what the picture shows and what is marked in it, for a reader who cannot
  see it.
- A **sentence before** the picture says what to look at.
- The entry in `assets[]` points at the file: `{ "sourceId": "img-innstillinger", "file":
  "deck/images/slide-10-1.png" }`. Keep the file name the reader gave it; the slide list names
  pictures by it.
- A picture is the same in all three languages. Where its text is in another language than the
  reader's, the sentence before it says what the marked field is called.
- The platform takes 5 MB per picture. A larger one is reported at production; ask the author for
  a smaller file.

What is **not** included as a picture:

| The picture is | Do this instead |
|---|---|
| a screenshot whose content is its text (a prompt, a filled-in form) | type the text out — as a [prompt](#prompt) when it is one |
| an infographic: a whole diagram saved as one picture | rebuild it from what you read in it, as a figure, cards or a table |
| a photo or pattern from the presentation's template | leave it out; it carries no content |

From a presentation, pictures are included unless the author says no, and the slide list shows
each one ([from-presentation.md](../workflows/from-presentation.md)).

## Figures

A figure is drawn, checked and shown as [figure-design.md](figure-design.md) says, and placed in
the text like a picture: `![what the figure shows](asset:fig-…)`. Under a flow, give each step a
line of explanation — the figure shows the order, the text says what each step is.

## A finished section

[examples/course-from-slides/section-sec-kilder.nb.md](../examples/course-from-slides/section-sec-kilder.nb.md)
is a whole section with cards and icons, a prompt, a picture and a table, as it stands in the
example package.
