# Workflow: a course from a PowerPoint presentation

Contents: [Gate 1 — read the file, look at the pictures](#gate-1--source-read-the-file-look-at-the-pictures) ·
[Gate 2 — objectives](#gate-2--learning-objectives) ·
[Gate 3 — structure and the slide list](#gate-3--structure-and-what-becomes-of-each-slide) ·
[Gate 4 — each element](#gate-4--each-element-beside-its-slides) ·
[Gate 5 — check](#gate-5--independent-check) · [Gate 6 — production](#gate-6--production)

A presentation is not a text. Its content is also in how each slide is laid out — four frames side
by side, a strip set apart at the bottom, an icon over each step — in its pictures, and in its
speaker notes. This workflow keeps all of it in view: you read the file with a script, you look at
the pictures yourself, and you agree with the author what becomes of **every slide** before you
write anything.

Stop at every gate and wait for the author.

## Gate 1 — Source: read the file, look at the pictures

1. **Ask for the `.pptx` file itself.** Ask also whether there is a transcript or a written summary
   of what was said; slides seldom carry the whole talk. If there is none, the slides and their
   speaker notes are the source.
2. **Run the reader:**

   ```
   node scripts/pptx-extract.mjs <deck.pptx> work/deck
   ```

   It writes `work/deck/slides.md` (every slide: title, layout in words, the text in each frame,
   a flow's steps and phases, tables, SmartArt, speaker notes), `work/deck/images/` (the pictures
   on the slides) and `work/deck/icons/` (the deck's own icons as SVG). Keep the package in
   `work/` too, so that it can point at these files as `deck/images/…` and `deck/icons/…`.
3. **Read `slides.md` in full.** The speaker notes are source material on a par with the slides —
   they often hold the main point and the exact wording of a prompt that is only a picture on the
   slide. The line that says how a slide is laid out is the reader's first guess: check it against
   the slide's text. A strip may be listed as a frame, and frames in a row as a flow.
4. **Open and look at every file in `images/`.** Text inside a picture is not in `slides.md`. For
   each picture, note what it is:
   - a **screenshot whose content is its text** (a prompt typed into a chat window, a filled-in
     form) — write the text down word for word;
   - a **screenshot that shows where to click** (a settings page with something circled) — note
     what it shows and what is marked;
   - an **infographic** (a whole diagram saved as one picture) — read all of it; you will rebuild
     its content, not reuse the picture;
   - a **photo or decoration** from the deck's template — it carries no content.

   Note also whether a picture shows a person's name, a face, or an internal page.
5. **Tell the author what you found**, in a few lines: how many slides, what kinds of content
   (text, flows, frames side by side, tables, screenshots, infographics), how many pictures you
   looked at, and anything you could not read. If you could not open the pictures, say so — do not
   go on as if you had seen them.

## Gate 2 — Learning objectives

As in [course-design.md](../references/course-design.md#learning-objectives). A slide that lists
what the participant will be able to do is the author's own objectives: propose those, all of
them, in the slide's wording.

## Gate 3 — Structure, and what becomes of each slide

Propose two things together.

**The outline:** sections and modules in order, test form, level
([course-design.md](../references/course-design.md#structure)). A slide that returns several
times with a different part marked (an agenda with "you are here") is the deck's own outline: use
it as the outline, do not turn it into content three times.

**The slide list:** one row per slide.

| Slide | What it is | Becomes | In | Why |
|---|---|---|---|---|
| 4 | flow: 8 steps in 3 phases, icon and explanation per step | **figure** (flow with phases) + the explanations as text under it | section 1 | the order is the point |
| 5 | 4 frames side by side with icon; a "Husk" strip | **cards** + **callout** | section 2 | a comparison of four alternatives |
| 6 | screenshot of a prompt; 6 numbered steps | **prompt** (as text) + numbered list | section 3 | the learner will copy the prompt |
| 10 | 2 screenshots of a settings page, marked 1 and 2 | **image** ×2 with a caption each | section 4 | shows where to click |
| 11 | table: 6 chapters × 5 columns | **table** | section 5 | — |
| 17 | two-week schedule | **omitted** | — | practical information for the live course, not subject matter |

What a slide can become — pick by what it **is**, and say it in the list:

| Becomes | Use for | How |
|---|---|---|
| **figure** | an order, a cycle, a hierarchy, a matrix, parts of a whole — anything whose point is how things relate | [figure-design.md](../references/figure-design.md) |
| **cards** | frames side by side: alternatives, roles, phases, each with a heading and points | [section-content.md](../references/section-content.md#cards) |
| **callout** | a strip or box set apart: "Husk", "Tips", "Viktig" | [section-content.md](../references/section-content.md#callout) |
| **prompt** | a prompt, template or example the learner will reuse — also when it is a screenshot on the slide | [section-content.md](../references/section-content.md#prompt) |
| **table** | a table, or frames that compare the same properties | [section-content.md](../references/section-content.md#table) |
| **image** | a screenshot that shows where to click, or a picture that is itself the content | [section-content.md](../references/section-content.md#pictures-from-the-source) |
| **text** | bullet points and running text | — |
| **objectives**, **task** | the slide with the learning objectives; the slide with the assignment | gate 2; [modules.md](../references/modules.md) |
| **omitted** | title and divider slides, practical information, decoration | always with a reason |

Rules for the list:

- **Every slide has a row.** Nothing is left out by not being mentioned.
- **A slide with several parts gets several entries** (cards + callout).
- **A slide that feeds two places gets two rows** (a table in a section, the assignment in a
  module).
- **Use the deck's own icons** where its frames or steps have them (`icons/`).
- **Account for every picture**, by file name, with what it shows. Pictures are included unless
  the author says no. Mark a picture where you saw a name, a face or an internal page with ⚠ so
  the author sees it — and go on; the choice is theirs.
- **A picture that is not included has a reason in the list:** a screenshot whose text you typed
  out, a photo from the template (no ⚠ needed, whatever it shows), a picture the author said no
  to, a picture that shows a password or an access code
  ([section-content.md](../references/section-content.md#pictures-from-the-source)).
- **A slide about something else than the course's subject** (an advertisement for other courses)
  is omitted with that reason, also when it is an infographic.
- **An infographic is rebuilt**, as cards, a table or a figure, from what you read in it. The
  picture itself is not included: its text cannot be translated or read aloud.

Save the approved list as `work/treatment.json`:

```json
{ "source": "deck.pptx",
  "slides": [
    { "slide": 5, "becomes": ["cards", "callout"], "in": "sec-arbeidsform", "phrases": ["Lerret", "Grundig tenkemodus", "kontekstvinduet"] },
    { "slide": 6, "becomes": ["prompt", "text"], "in": "sec-for-motet", "phrases": ["Hjelp meg å forberede et møte"] },
    { "slide": 10, "becomes": ["image"], "in": "sec-under-motet", "images": ["slide-10-1.png", "slide-10-2.png"],
      "imagesLeftOut": { "slide-10-3.png": "decoration from the template" } },
    { "slide": 17, "becomes": ["omitted"], "why": "practical information for the live course" } ] }
```

- `in` is the `clientRef` of the section (or, for a task, the module) the slide goes into. A
  slide that became only the objectives needs no `in`.
- `becomes` uses the words in the table above. `omitted` stands alone and needs `why`.
- `phrases` are two to four expressions from that slide that must be found in the finished
  element — for a prompt or an infographic, expressions that were only in the picture.
- `images` are the files from `images/` that are included; `imagesLeftOut` gives each of the
  slide's other pictures a reason.

A whole list: [examples/course-from-slides/treatment.json](../examples/course-from-slides/treatment.json).

The list is what the author approved. If you later need to change a row — another form, another
expression — say so to the author when you show the element it concerns.

## Gate 4 — Each element, beside its slides

One section or module per turn.

- Start each turn by naming the slides the element comes from ("Seksjon 2 bygger på lysark 5
  og 6").
- Write the element as the slide list says: the cards as cards, the prompt as a prompt, the figure
  as a figure. Keep the slide's own grouping, order and headings; write out in sentences what the
  slide only hints at, from the notes and the summary.
- Write each section to its own file, `work/sections/<clientRef>.nb.md`, and add it to
  `work/package.json` as you go ([package-schema.md](../references/package-schema.md)). Until gate
  6 the package holds the course's one language only.
- Show the result as the learner will see it ([figure-preview](../references/figure-design.md#seeing-the-figure)
  for figures), and say what you changed from the slide and why.
- Text, figures, boxes and pictures are approved together.

Modules: [modules.md](../references/modules.md). A slide's assignment that is not a text to hand in
(upload a file, present to a colleague) becomes a written task about the same work; say so, and
mark what you had to assume `[Avklaring: …]`. After each approval, store the element in full:
[content-preservation.md](../references/content-preservation.md).

## Gate 5 — Independent check

First the slide check, on the assembled package:

```
node scripts/slide-coverage.mjs work/treatment.json work/package.json
```

It reports every slide that did not get what the list says: a missing section, a figure that was
planned and is not there, phrases that are not in the text, a picture that was listed and is not
included (or the other way round) — and, read against `work/deck/slides.json`, every slide and
every picture the list does not mention at all. Fix every `FAIL`, or change the list with the
author's consent.

Then the check against the objectives: [check-and-produce.md](../references/check-and-produce.md).

## Gate 6 — Production

[check-and-produce.md](../references/check-and-produce.md). Run production with
`--slides work/treatment.json`. Put the presentation's file name and "speaker notes" (and the
transcript or summary, if used) among the sources.
