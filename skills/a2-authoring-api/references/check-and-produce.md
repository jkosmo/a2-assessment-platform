# Gates 5 and 6 — the independent check, and production

Contents: [Gate 5 — independent check](#gate-5--independent-check) ·
[Gate 6 — production](#gate-6--production) · [Reading the report](#reading-the-report) ·
[Delivering](#delivering) · [A lone section or module](#a-lone-section-or-module) ·
[Through the API](#through-the-api) · [Rules that hold in production](#rules-that-hold-in-production)

## Gate 5 — independent check

A second opinion on whether the course delivers the objectives. It reads the source again; it
does not take the course's word for it.

**Who does it.** Where you can start a separate agent, do: give it only the confirmed sources,
the objectives and the finished course. It has not seen the dialogue, so it is not anchored on
your choices. In a single chat, do the same as a deliberate fresh pass: derive from the source
what a learner should be able to do, without looking at the objectives, then compare.

**What it checks.**

- Each objective is **taught** (a section covers it) and **tested** (a module asks for it).
- **Nothing is claimed that the source does not support.** A claim without support is softened to
  what the source says or marked `[Avklaring: …]` — never given invented support.
- **One language throughout:** every title, text, task, criterion, question and figure label.
- **The figures:** each shows what the approved text says and nothing more; labels are short.
- **From a presentation:** the slide check is clean
  (`node scripts/slide-coverage.mjs work/treatment.json work/package.json`), and for each slide
  that became something, the section says what the slide and its notes meant — the script checks
  that the form and the expressions are there, not that the meaning is.

**Report to the author** what was checked, what was found, and what you propose to change. Fix
what the author agrees to, then ask for approval to produce.

## Gate 6 — production

Start only when every element is approved and stored in full in the course state
([content-preservation.md](content-preservation.md)).

1. **Translate** to the other two languages — text, questions, figure labels:
   [localization.md](localization.md). Each section gets a file per language beside the first
   (`sections/<clientRef>.nn.md`, `sections/<clientRef>.en-GB.md`).
2. **Complete the package**, `work/package.json`: every section and module in three languages, and
   the course that orders them ([package-schema.md](package-schema.md)). Texts, pictures and
   figures point at their files. Put the confirmed sources and the author's stated requirements
   in `constraints`.
3. **Run production:**

   ```
   node scripts/produce-course.mjs work/package.json --out work/kurs-<navn>.json --state work/course-state.json
   ```

   From a presentation, add `--slides work/treatment.json`.

   The command attaches the pictures, runs every check, and — only when all pass — builds the
   import file, writes it, reads it back and validates it against the import's own rules. The
   file it names after `DELIVER` is the file that was validated.
4. **Fix every `FAIL`** where the report points, and run again. Do not work round a failing
   check, and do not build the import file another way.

## Reading the report

```
OK   package        2 section(s), 1 module(s), one course
OK   pictures       5 picture(s) and figure(s), 18 kB with every layout and language
OK   figures        9 drawing(s) measured
OK   questions      4 question(s) in 1 set(s)
OK   languages      nb, nn, en-GB — written in nb
OK   approved text  20 item(s) in place, 0 moved to an attachment, 0 removed with the author's consent
OK   slides         7 row(s) in the slide list
OK   import file    1 file(s) written, read back and validated

DELIVER work/kurs-motereferat.json  —  the author imports it at Innholdsforvaltning → Kurs → «Importer kurs»
```

| Check | A `FAIL` means | Fix it in |
|---|---|---|
| **package** | an item of the course is not in the package, something in the package is not in the course, a `clientRef` is wrong or used twice | [package-schema.md](package-schema.md) |
| **pictures** | a file is not found; the text shows a picture the section does not have, or the section has one the text does not show (in some language); a file is too large | [section-content.md](section-content.md#pictures-from-the-source) |
| **figures** | a label does not fit, or an animated figure is not the template — in the figure, a layout or a language variant | [figure-design.md](figure-design.md#measure-and-look) |
| **questions** | an option gives the answer away | [modules.md](modules.md#multiple-choice-questions) |
| **languages** | a language is missing, a text was copied instead of translated, the right answer differs between languages, a formula or address was lost | [localization.md](localization.md) |
| **approved text** | something the author approved is gone | [content-preservation.md](content-preservation.md) |
| **slides** | a slide did not get what the slide list says | [from-presentation.md](../workflows/from-presentation.md) |
| **import file** | the written file did not pass when read back | the line under it names the field |

A line that starts with `--` was **not run**. Without `--state`, nobody has checked that the
approved text is all there: say so in your report, in those words.

## Delivering

Give the author the file named after `DELIVER`, and say:

- **what was made:** the course's name, its sections and modules in order;
- **which checks ran, by name,** and which did not. Never "validert" on its own — say what was
  checked. The checks run here cannot stand in for the platform's own: the import is the last
  check, and the author does it;
- **where to import it:** the place the report names — *Innholdsforvaltning → Kurs → «Importer
  kurs»*. Each kind of file has its own page; a course file uploaded on the modules page is
  refused;
- anything marked `[Avklaring: …]` that the author must settle before publishing;
- the closing line: *"Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI."*

## A lone section or module

When the author asked for one section, one module or one test — not a course — the package has no
course object. The same command then writes one import file per object into the folder given by
`--out`, and names where each is imported: sections at *Seksjoner → «Importer seksjon»*, modules
at *Moduler → «Importer modul»*.

## Through the API

Where you can reach the author's installation and have an agent token, create the drafts directly
instead of handing over a file. Run production with `--package-out work/package.complete.json`
(the package with every picture attached), then follow [api-flow.md](api-flow.md).

## Rules that hold in production

- **Never publish.** No `…/publish` endpoint, no publish fields.
- **Stop on an error.** Show the field path and fix the content. Never drop a field to get
  through.
- **Never overwrite existing content.** No `mode: "replaceExisting"`. To add questions to a module
  that exists, use the endpoint made for it ([api-flow.md](api-flow.md#adding-questions-to-an-existing-module)).
- **On a partial failure through the API:** stop at the failed step. Report per step — done,
  failed, skipped — with ids and links of what was created, the error, and the run id. Delete
  nothing.
- **A token is never written down:** not in the package, not in `constraints`, not in a file, not
  in your report.
