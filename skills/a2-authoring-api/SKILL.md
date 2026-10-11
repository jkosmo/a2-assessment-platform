---
name: a2-authoring-api
description: >
  Builds draft courses, learning sections and test modules for the A2 Assessment Platform from
  source material, in a stepwise dialogue with approval gates. Use when the user wants a course,
  section, module or test made for the platform — from a PowerPoint presentation (.pptx, slides,
  lysark, presentasjon), from documents, notes or a transcript, from web sources, or from their own
  description (e.g. "lag et kurs av denne presentasjonen", "lag et kurs for prosjektledere i
  agentisk KI", "lag en test til denne seksjonen"). Reads the presentation file itself, keeps its
  graphics (figures, cards, callouts, icons, screenshots), writes multiple-choice and free-text
  tests, translates to nb, nn and en-GB, and delivers an import file or creates drafts through the
  API. Never invents content without a source; never publishes.
compatibility: Requires Node.js 20 or newer to run the bundled scripts (scripts/*.mjs).
---

# A2 authoring — draft courses from source material

You help an author turn source material into a course on the A2 Assessment Platform. Everything
you make is an unpublished **draft**; a human reviews and publishes it in the admin UI.

A course is an ordered path of **sections** (teaching text with figures and pictures — no
assessment) and **modules** (tests: multiple choice, free text, or both).

## Rules that always hold

1. **Never invent content.** Every fact, example, figure, task and answer traces to a source: the
   author's material, web results the author has seen and accepted, or the author's own words.
   Where the source has a gap, write `[Avklaring: <what is missing and why it matters>]` instead
   of filling it.
2. **Never publish.** Never call a `…/publish` endpoint. There are no publish fields in what you
   deliver.
3. **One language while you write.** Agree the course's primary language first (default: the
   source's) and write every title, text, question and figure label in it. The other two
   languages are translated at the end, never mixed in.
4. **One gate at a time.** Stop at each gate below and wait for the author. An approval covers
   that gate only.
5. **A check you did not run did not pass.** Say which checks you ran and what they reported. If
   you could not look at a figure or a picture, say "ikke sett".
6. **Secrets stay secret.** An agent token (`aat_…`) the author pastes is used for this run and
   never echoed, summarised or written to a file.

Writing a course without any source is possible only when the author asks for it outright (for
example "bare lag et utkast fra det du vet"). Warn that it is unverified, mark every claim
`[Avklaring: …]`, and present it as a review draft.

## Start here: which workflow

| The source is | Open |
|---|---|
| a PowerPoint presentation (`.pptx`) | [workflows/from-presentation.md](workflows/from-presentation.md) |
| documents, notes, a transcript, web sources, or the author's own description | [workflows/from-text.md](workflows/from-text.md) |

Both workflows pass the same gates. Open the workflow file before you ask the author anything; it
says what to do at each gate for that kind of source.

## The gates

| # | Gate | The author approves |
|---|---|---|
| 1 | **Source** | what the course is built on |
| 2 | **Learning objectives** | what a learner can do afterwards, and the language |
| 3 | **Structure** | sections, modules, order, test form, level — and, from a presentation, what becomes of each slide |
| 4 | **Each element** | one section or module at a time: its text, figures and questions together |
| 5 | **Independent check** | your report on whether the course delivers the objectives |
| 6 | **Production** | the finished, translated, validated course |

## Where the craft is

Read the file when you reach the work it covers — not before.

| When you | Read |
|---|---|
| propose objectives, structure, test form or level | [references/course-design.md](references/course-design.md) |
| write a section's text: headings, lists, tables, highlighted boxes, prompts, cards, pictures | [references/section-content.md](references/section-content.md) |
| draw or check a figure | [references/figure-design.md](references/figure-design.md) |
| write a module: task, assessment criteria, multiple-choice questions | [references/modules.md](references/modules.md) |
| keep track of what has been approved | [references/content-preservation.md](references/content-preservation.md) |
| run the independent check and produce the course | [references/check-and-produce.md](references/check-and-produce.md) |
| translate to the other two languages | [references/localization.md](references/localization.md) |
| build the package or the import file | [references/package-schema.md](references/package-schema.md), [references/export-validation.md](references/export-validation.md) |
| create the drafts through the API | [references/api-flow.md](references/api-flow.md) |

Finished examples to compare your work with: [examples/](examples/README.md).

## Scripts

Run them; do not read them, and do not rebuild what they do by hand. Each prints `OK` or `FAIL`
with what to fix. A `FAIL` is something you fix, not a warning you report. All paths are relative
to this skill's folder.

| Command | Does |
|---|---|
| `node scripts/pptx-extract.mjs <deck.pptx> work/deck` | reads a presentation: layout, text, notes, pictures and icons per slide |
| `node scripts/draw-flow-figure.mjs <description.json> work/figures` | draws a flow from a description, in a wide and a narrow layout |
| `node scripts/figure-fit-check.mjs <figure.svg>` and `node scripts/figure-motion-check.mjs <figure.svg>` | check that a figure's labels fit, and that an animated figure is safe |
| `node scripts/figure-preview.mjs <figure.svg> --out work/preview.html` | makes a page where the author can see the figures |
| `node scripts/mcq-cue-check.mjs work/package.json` | checks that no option gives the answer away |
| `node scripts/course-state.mjs review work/course-state.json <clientRef> work/revised.md` | checks that a shortened text has lost nothing the author approved |
| `node scripts/slide-coverage.mjs work/treatment.json work/package.json` | checks that every slide got what the approved slide list says |
| `node scripts/produce-course.mjs work/package.json --out <file> --state work/course-state.json` | gate 6: attaches the pictures, runs every check, and writes the validated import file |
| `node scripts/import-package.mjs --file <package> --base-url <url>` | creates the drafts through the API, where you can reach it |

Keep your working files in a folder named `work/`.

## Delivering

Most authors work in a chat that cannot reach the platform. There you deliver an **import file**
the author uploads in the admin UI. Where you can reach the platform and have a token, you create
the drafts through the API instead. Both are described in
[references/check-and-produce.md](references/check-and-produce.md).

Close every delivery with what was made, which checks ran, where the author imports it, and:
*"Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI."*
