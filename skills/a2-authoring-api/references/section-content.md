# Section content — text, boxes, prompts, cards, pictures

Contents: [Writing the text](#writing-the-text) · [Headings and lists](#headings-and-lists) ·
[Table](#table) · [Callout](#callout) · [Prompt](#prompt) · [Cards](#cards) · [Think first](#think-first) ·
[Check yourself](#check-yourself) · [A case](#a-case) · [Step by step](#step-by-step) ·
[Write it yourself](#write-it-yourself) · [Flashcards](#flashcards) · [Match the pairs](#match-the-pairs) ·
[Icons](#icons) ·
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
- **One file per section and language:** `work/sections/<clientRef>.nb.md`. The package points at
  the files ([package-schema.md](package-schema.md#a-section)); do not type markdown into JSON.

## Headings and lists

- The section's name is its `title`. Do not repeat it as a heading in the body.
- `##` starts a part of the section. `###` is a card, a step or a flashcard inside a frame (below),
  or a sub-part.
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

- The label is the source's own where it has one ("Husk", "Tips", "Viktig", "NB", "Best
  praksis") — a word or two, in the course's language, translated with the rest (`Hugs`,
  `Remember`).
- One strip on the slide is one box. A strip with several points keeps them as a list inside it:

  ```markdown
  > **Gode vaner:**
  > - Lagre kildene i prosjektet før du begynner.
  > - Start en ny samtale når tråden blir lang.
  ```
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
- Correct an obvious typing error, and tell the author that you did. Where the speaker notes hold
  the same prompt in a cleaner form, use the notes' wording and say so.
- What the learner fills in stands in `[square brackets]`.
- A line before the block says what the prompt is for.
- The prompt is translated like the rest of the section. Names of menus and buttons in a product
  stay as the product shows them.

## Cards

Frames side by side on a slide — alternatives, roles, tools, phases, each with a heading and its
own points — become cards: a frame `:::kort` … `:::` around one `###` heading per card, each with
the same parts in the same order.

```markdown
:::kort
### ![](icon:list-checks) Sakliste

**Bruk når** møtet fulgte en fast plan.

- Gir rekkefølgen i referatet
- Viser hvilke saker som skulle avgjøres

### ![](icon:notebook-pen) Egne notater

**Bruk når** du noterte underveis.

- Fanger vedtak og frister
- Må ryddes før de limes inn
:::
```

- **The frame is what makes them cards.** `:::kort` on its own line before the first heading,
  `:::` on its own line after the last card. Without the frame the platform shows plain
  sub-headings; a frame that is not closed is shown as text. `produce-course.mjs` fails on one.
- Two to six cards. Keep every frame of the slide, with the slide's own headings.
- Keep the parts inside each frame ("Når bruke", "Fordeler", "Begrensninger") as bold lead-ins or
  short lists. Where the frames share parts, keep them in the same order; a frame with a part of
  its own keeps it.
- What stands inside a frame stays inside its card: a strip becomes a callout under the card's
  points, a prompt a prompt box.
- A sentence before the first card says what is being set side by side.
- When the frames compare the same few properties in a word or two each, a [table](#table) reads
  better than cards. When each frame holds sentences or lists, use cards.

## Think first

A question in the middle of the text, with the answer hidden until the learner opens it — guessing
before being told is what makes the explanation stick. A frame `:::tenk` with the question on the
same line, the answer inside, `:::` to close:

```markdown
:::tenk Hva tror du skjer hvis du laster opp hele konkurransegrunnlaget og ber om et sammendrag?
KI leser alt, men sammendraget blir **generelt**. Spør heller etter det du trenger:

- kravene til leveransen
- tildelingskriteriene og vektingen
:::
```

- **Where:** after a problem or a situation has been set out, before the text explains it. One or
  two per section at most; a section that only asks is a quiz, and the quiz is the module's job.
- **From the source only.** The question is one the source raises, and the answer is what the source
  says. Never a question the source does not answer.
- The answer is ordinary markdown — sentences, a short list, bold. Keep it short; the explanation
  that follows in the text can go further.
- The platform shows it as a box labelled «Tenk først» / «Think first» with «Vis svaret» to open.
  Without the question on the opening line it is not a box. `produce-course.mjs` fails on a frame
  that is not closed.
- In the other languages the marker word stays `:::tenk`; translate the question and the answer.
- **Never inside a card frame, and no frame inside it.** Frames cannot be nested: the first `:::`
  closes both, and the learner sees the markers as text. `produce-course.mjs` fails on it.

## Check yourself

A short multiple-choice question right after something has been explained. The learner picks an
answer and sees at once whether it was right, with the explanation. It does not count and is not
stored — it is there for the learning:

```markdown
:::sjekk Hvilken kilde er viktigst når du skal skrive referatet?
- [ ] E-posten med innkallingen
- [x] Notatene fra møtet
- [ ] Fjorårets referat

Notatene viser hva som faktisk ble bestemt. Innkallingen sier bare hva som skulle skje.
:::
```

- **Where:** right after the core of an explanation, one to three per section. Use it where
  applying what was just read is the point («anvend, ikke husk») — not to repeat a fact.
- **From the source only.** The question, the options and the explanation rest on what the source
  says. The module's test is still the test; this is practice.
- **Options:** two to four, straight after the question line, each `- [ ]`; exactly one `- [x]`.
  The wrong options are plausible mistakes, not jokes. Same rules as the module's questions: no
  option gives the answer away ([modules.md](modules.md#multiple-choice-questions)).
- **Explanation:** after the options, in ordinary markdown; say why the right one is right. It can
  be left out, but rarely should be.
- **Feedback per option (optional):** an indented line (two spaces) right under an option is shown
  when the learner picks that option — what happens, or why it is not the best. Use it in a case
  (below). Without feedback lines the question looks as before.
- In the other languages the marker word stays `:::sjekk` and `- [x]` stays where it is; translate
  the question, the options, the feedback (still indented under its option) and the explanation.
- **A blank line above every frame** (`:::kort`, `:::tenk`, `:::sjekk`, `:::steg`, `:::skriv`,
  `:::repetisjon`, `:::par`). Right under a list, a quote or a table, the platform reads the frame as part of
  it — for `:::sjekk` the learner then sees the answer as a ticked list. `produce-course.mjs` fails on
  a frame with text right above it.
- **Never inside a card frame, and no frame inside it** — as for «think first».
  `produce-course.mjs` fails on a nested frame, fewer than two options, or not exactly one `- [x]`.

## A case

A situation from the learner's work, and one to three «check yourself» questions about what they do
— each option with its consequence. This is the strongest practice for routines and casework: the
learner applies the rule in a situation, and sees what each choice leads to. No new frame: a short
paragraph with the situation, then `:::sjekk` questions with feedback lines:

```markdown
En innbygger ringer og vil se dokumentene i saken om naboens byggesøknad. Hun vil ha dem i dag.

:::sjekk Søknaden inneholder naboens personnummer. Hva gjør du?
- [ ] Avslår hele innsynet
  For mye. Bare opplysningen som skal unntas, kan holdes tilbake.
- [x] Sladder personnummeret og gir innsyn i resten
  Riktig. Du unntar det som må unntas og gir innsyn i resten.

Innsyn er hovedregelen; unntak gjelder bare det som må unntas.
:::
```

- **From the source:** the situation and the right choice rest on the source's rules or examples.
- **The story does not branch.** Every choice leads to the next question; a worse choice is shown
  with its consequence, and the learner goes on. One to three questions per case.
- **Every option gets a feedback line** in a case: the consequence of that choice, in one or two
  sentences.

## Step by step

**Step by step, write it yourself, flashcards and match the pairs work only in a section.** In a module's task
text or guidance — what the learner answers — the platform shows the markers as plain text, and
`produce-course.mjs` fails on one there. Put the exercise in the section before the module.

A process the learner pages through one step at a time, with «Neste» and «Forrige» — case handling,
a routine, a rule applied in order («først sjekker du …, så …»). Each step says what happens in it.
A frame `:::steg` with a title on the same line, one `###` heading per step, `:::` to close:

```markdown
:::steg Slik behandler du en innsynsbegjæring
### Registrer begjæringen
Før den inn i saksarkivet samme dag, med dato for mottak. Fristen regnes fra den dagen.

![Arbeidsgangen med «Registrer» uthevet](asset:fig-innsyn-1)

### Finn dokumentene
Søk i arkivet etter alt begjæringen gjelder, også journalført e-post.

![Arbeidsgangen med «Finn dokumentene» uthevet](asset:fig-innsyn-2)

### Vurder unntak
Gå gjennom dokumentene ett for ett. Et unntak skal ha hjemmel.
:::
```

- **When:** the source walks through a process in an order, and each step changes something — a
  document is registered, a decision is taken, a form is sent. Use it instead of a long paragraph
  or a numbered list when the steps each need a few sentences; a numbered list is enough when each
  step is a line. Use it instead of a single figure when the learner should stop at each step.
- **Three to seven steps.** The platform needs at least two; fewer than three is not a walk-through,
  more than seven is a chapter.
- **Each step says what changes** — what the learner does, and what is different afterwards. The
  heading is the action («Registrer begjæringen»), not a number; the platform numbers the steps.
- **From the source only**, in its order. A step the source does not have is `[Avklaring: …]`.
- **A figure per step, if the source has one:** the same figure each time, with that step
  highlighted ([figure-design.md](figure-design.md#same-figure-one-step-highlighted)). Not a new
  figure per step.
- The learner without a script, and a screen reader without one, gets all the steps as a numbered
  list; nothing is lost.
- In the other languages the marker word stays `:::steg` and every `###` heading stays; translate
  the title, the headings and the text. `produce-course.mjs` fails on fewer than two steps.

## Write it yourself

A short writing task in the section: the learner writes an answer, then opens an **example answer**
and a **checklist** («Fikk du med …») and ticks off what they got. It practises what a free-text
module assesses — formulating it — but nothing is assessed, sent or counted. A frame `:::skriv` with
the task on the same line, the example answer inside, and the checklist as `- [ ]` lines at the end:

```markdown
:::skriv Skriv vedtakspunktet for at styremøtene flyttes fra tirsdag til torsdag.
**Vedtak:** Styremøtene flyttes fra tirsdag til torsdag kl. 09.00, gjeldende fra 1. november.
Sekretariatet oppdaterer møteplanen og sender ny innkalling innen 25. oktober.

- [ ] hva som ble bestemt, med dag og klokkeslett?
- [ ] fra når det gjelder?
- [ ] hvem som følger opp, og innen når?
:::
```

- **When:** as a warm-up before a free-text module, in the section that comes before it — the same
  kind of situation as the module's task, smaller. One per section at most.
- **The checklist mirrors the module's assessment criteria** ([modules.md](modules.md#free-text-modules)):
  one point per thing an assessor would look for, phrased as a question to the learner. Two to five
  points. It can be left out; then the example answer stands alone.
- **The example answer comes from the source** — a model the source gives, or the source's own
  wording put together. Never an answer you invented; mark a gap `[Avklaring: …]`. Keep it as long
  as an answer the learner could write in a few minutes.
- The task is written to the learner, as a task: «Skriv …», «Formuler …». It is required.
- The checklist is the run of `- [ ]` lines **at the very end**. The example answer may itself have a
  list, as long as something else stands after it.
- What the learner writes stays in their browser tab until it is closed, and is not sent; the box says so.
- In the other languages the marker word stays `:::skriv` and every `- [ ]` line stays; translate the
  task, the example answer and the points. `produce-course.mjs` fails on a frame without an example
  answer.

## Flashcards

Cards the learner pages through: a term on the front, the explanation on the back. The learner turns
each card, marks «Kunne det» or «Øv mer», and the cards marked «Øv mer» come back after the round.
Nothing is stored. A frame `:::repetisjon` (not `:::kort` — that is cards side by side), one `###`
heading per card with the explanation below:

```markdown
:::repetisjon Fagord i møtearbeid
### Vedtak
Det møtet bestemte, med ansvarlig og frist.

### Referent
Den som skriver referatet.

### Habil
Uten personlig interesse i saken, så du kan delta i behandlingen.
:::
```

- **When:** at the end of the section that defined the terms — for technical words and short facts,
  not for reasoning. The terms are the ones **this section** defines.
- **Four to ten cards.** The platform needs at least two.
- **The text comes from the source:** the term as the source writes it, the explanation in the
  source's words, shortened to a sentence or two. Never a definition the source does not give.
- The front is the term alone; the back explains it. A card with nothing on its back is not a card.
- A screen reader, and a learner without a script, gets the cards as a list of terms with their
  explanations.
- In the other languages the marker word stays `:::repetisjon` and every `###` heading stays;
  translate the terms and the explanations. `produce-course.mjs` fails on fewer than two cards or a
  card without a back.

## Match the pairs

The learner matches terms with their explanations: picks a term, then the explanation that belongs to
it. A right pair turns green and stays; a wrong pair flashes red. The explanations are shuffled every
time. No timer, nothing is stored. Works only in a section, like step by step. A frame `:::par` (an
instruction after it is optional), one line per pair, `- term = explanation`:

```markdown
:::par Koble begrepet med forklaringen
- Hjemmel = Lovbestemmelsen et vedtak bygger på
- Merinnsyn = Innsyn selv om dokumentet kunne vært unntatt
- Klagefrist = Tiden parten har til å klage på vedtaket
- Journalføring = Registrering av et dokument i arkivet
:::
```

- **When:** for three to six terms this section defines — to tell similar terms apart. Not the same
  terms as the flashcards in the same section; choose one of the two.
- **Every line is a pair**, split at the first « = »; no other lines in the frame. At least three
  pairs; no term or explanation twice.
- **The text comes from the source**, shortened to a phrase — the explanations are read side by side,
  so keep them about the same length (a much longer one gives itself away).
- A screen reader, and a learner without a script, gets the pairs as a list.
- In the other languages the marker word stays `:::par`, and every line keeps `- ` and ` = `;
  translate the terms and the explanations. `produce-course.mjs` fails on a line that is not a pair,
  fewer than three pairs, or a repeated term or explanation.

## Icons

Icons come from the platform's own library, written `![](icon:<name>)` — the same icons in every
course, whether the source was a presentation, a document or the author's words. How to choose
one, and the catalogue by meaning: [icons.md](icons.md).

- **Cards get an icon**, first in the heading, with empty alt text: `### ![](icon:lightbulb) Idé`.
  The icon repeats the heading and says nothing more.
- **A flow's steps, or a row of points, often carry an icon each.** They do not go in a figure.
  Put the icon first in that step's or point's row of a table, in a first column with no name:

  ```markdown
  | | Steg | Hva du gjør |
  |---|---|---|
  | ![](icon:target) | **Forstå oppdraget** | Mandat, målgruppe, krav og rapportmal. |
  ```
- **The source's own icons are not copied in.** They tell you what each card or step stands for;
  pick the library's icon for that meaning. Never draw an icon, and never fetch one.
- A strip's own icon is left out; the label says the same.
- Nowhere else. An icon in running text is noise.

## The source stays behind the text

The learner reads the course, never the source. Write the point itself, not where it came from.

- Never "som vist på lysark 4", "i denne presentasjonen", "som foredragsholderen sa", "on this
  slide". The slide is yours to read; the learner has a section.
- A figure or a picture is introduced by what it shows ("Arbeidsgangen har åtte steg"), not by its
  origin.
- The exception is a source the learner is meant to go to — a law, a standard, a handbook. Name it
  as a reference, with a link where there is one.

`produce-course.mjs` fails on the phrases above, in every language.

## Pictures from the source

A screenshot that shows **where to click** or what something looks like, and a picture that is
itself the content, are included as they are. A screenshot of **text** — a prompt, a list, a
slide of bullet points — is not a picture: write the text out ([prompt](#prompt), text, a table).

**Size:** a picture over 600 kB fails the production check; one over 300 kB is listed as worth
cropping. Crop a screenshot to the part that matters (the dialog, not the whole desktop), or ask
the author for a smaller file. The platform takes up to 5 MB, but a phone on a slow connection
loads every picture in the section before the learner can read on.

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
- **A picture that shows a password, an access code, a key or a token is the exception.** Propose
  leaving it out, say why, and ask whether the author has a version without it. It is included
  only when the author says so in as many words.

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

[examples/course-from-slides/sections/sec-kilder.nb.md](../examples/course-from-slides/sections/sec-kilder.nb.md)
is a whole section with cards and icons, a prompt, a picture and a table.
