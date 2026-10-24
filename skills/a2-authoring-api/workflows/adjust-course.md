# Workflow: adjust a course that is already on the platform

Contents: [Gate 1 — the export file](#gate-1--source-the-export-file) · [Gate 2 — the change list](#gate-2--the-change-list) ·
[Gate 3 — the changes, reviewed together](#gate-3--the-changes-reviewed-together) · [Gate 4 — independent check](#gate-4--independent-check) ·
[Gate 5 — production](#gate-5--production) · [Delivering](#delivering)

Use this when the author wants a course that **exists on the platform** changed — a section
rewritten, a test replaced, a figure redrawn, a new section added, something taken out — and
hands you the course's **export file** from the platform. It is a shorter path than the two
"make a course" workflows: the file is the approved course, and only what the author asks for
changes. When the source is a presentation or text and no course exists yet, use
[from-presentation.md](from-presentation.md) or [from-text.md](from-text.md).

The file the author gets back is imported as an **update** of the same course: every element you
changed gets a new, unpublished version laid ready for review, new elements come in as drafts,
and the course keeps its id, its publish state, its classes and the participants' progress.
Nothing is published by the import.

You stop **twice**: at the change list (gate 2), and at one review of everything you changed
(gate 3). The other gates run without waiting, unless something there needs the author's decision.
Do not ask for approval per element or per step after that — the author approved what changes at
gate 2.

## Gate 1 — Source: the export file

1. Ask for the course's export file: the author makes it at *Innholdsforvaltning → Kurs → «Eksporter»*
   on the course. Only that file will do — it carries the platform's ids (`origin`) that let the
   import update the course instead of creating a new one. A file from the «lag kurs» workflows
   has no ids; so does a file exported before version 2.88.0. Then ask for a fresh export.
2. Turn it into your working set:

   ```
   node scripts/adjust-from-export.mjs <export.json> work
   ```

   It writes `work/package.json` (every section as files, one per language; every picture as a
   file; every module inline; `origin` on everything), `work/course-state.json` with every element
   **approved as it stands**, `work/changes.json` with every element `unchanged`, and
   `work/baseline.json`, a copy of the export. It prints the elements with their `clientRef`s —
   show that list to the author, so you talk about the same things.
3. If the author also brings **new material** (an updated presentation, a new document), treat it
   as a source for the elements that change: read it the way the make-a-course workflow does
   (`pptx-extract.mjs` for a presentation), but only for what the change list names.

The export is the approved baseline. You do not re-read it for improvements, and you do not
"tidy" what nobody asked you to touch.

## Gate 2 — The change list

Ask what should change, then propose the change list — one line per element, in the course's
order, each marked **unchanged / changed / new / removed**, with one sentence on what the change
is. Add elements the author did not name only as *suggestions* ("jeg ser også at …"), marked as
such; they become changes only on a clear yes.

**This is the stop you never skip** — also when the author asks you to work fast. It is one
question, and everything after it follows from the answer; without it, you decide what the author's
course says.

**What a changed element keeps.** A line marked `changed` changes what that line says, nothing
more. The element's pictures, exercises, prompts and the method it teaches stay unless the line
names them:

- a picture, an exercise or a prompt taken out, or moved elsewhere (another section, outside the
  course), is said in the line ("tar ut de tre skjermbildene av …", "flytter promptene til Teams");
- advice the course gives that you would change — even where you think it is out of date — is a
  *suggestion* with your reason ("Kurset sier at deltakeren skal slette originalene; jeg foreslår å
  beholde dem fordi …"). The method is the author's;
- an update for currency (a product that changed, a feature that moved) names each claim that
  changes and the source for the new one. A claim no source the author has seen supports is not
  changed; mark it `[Avklaring: …]`.

When a change also touches the course's description, a module's questions or their rationale, the
line says so — the description and the test must still agree with the sections.

Every question keeps its type — one correct answer, or select all that apply — unless the author
asks to change it. When the author asks in general for select-all questions, or for a harder test,
choose which and how many yourself, at most half the set ([modules.md](../references/modules.md#select-all-that-apply)).

Rules the list must respect:

- The **title** of a section that is live, and the **title, description and level** of any
  module, are not changed by the import — they belong to the element, not to its version. They
  are set in the admin UI; say so rather than changing them in the file. (The title of a section
  that is still a draft does follow the file.)
- The **course's own title, description and level** are written straight onto the course at
  import, without a version to review. They have their own line in the change list, `course`,
  and stay `unchanged` unless the author asks.
- The **order** of the course is applied at import too. Moving an element does not make it
  `changed` (it is word for word the same); the order has its own line, `order`. Adding a new
  element or removing one does not change the order of the others — `order` stays `unchanged`
  unless existing elements swap places.
- A **changed test** that already had fewer questions than the rule asks for (one per section
  before it, at least three) is not asked to grow for a small fix; a **new** test is.
- A **new module** in a course that is published is not placed in the course by the import: it
  lands as a draft under *Moduler*, and the author publishes it and places it. Say so.
- A **removed** element is taken out of the course, not deleted; it stays in the library.
- An element the author does **not own** (made by another author) is replaced on import by the
  author's own copy when the file changes it. Mention it when you see a change on such an
  element — the author knows who made what; you do not.

When the author approves, write the decisions into `work/changes.json`:

```json
{ "baseline": "baseline.json", "course": "unchanged", "order": "unchanged", "elements": { "sec-01-innledning": "unchanged", "sec-02-metode": "changed", "mod-03-test": "unchanged", "sec-04-ny-del": "new" }, "refs": { … } }
```

A removed element keeps its `clientRef` in the list, marked `removed`, and is taken out of the
package and of the course's `items`. Leave `refs` as the script wrote it: it says which element of
the export each ref was, so a removal is matched to the right element.

## Gate 3 — The changes, reviewed together

Write every changed and new element on the approved list, with the craft of the make-a-course
workflows ([section-content.md](../references/section-content.md),
[figure-design.md](../references/figure-design.md), [modules.md](../references/modules.md),
[icons.md](../references/icons.md)) applied to **what changes only**. Everything else stays word
for word as it came from the file.

Then show the author all of it in **one review**, in the course's order: per element, the changed
passages before and after, a new element in full, and the checks you ran. The author approves it
all, or points at what to fix; fix that and show only that again. If the author asks to see the
elements one at a time, do that.

- A **changed section:** revise the primary-language file `work/sections/<ref>.<lang>.md` from the
  approved text, never from memory. When the author shortens, run
  `node scripts/course-state.mjs review work/course-state.json <ref> work/revised.md` as
  [content-preservation.md](../references/content-preservation.md) says. The other two language
  files of that section are rewritten at gate 5; until then they are stale, and that is expected.
- A **changed module:** the task, criteria or questions, in the primary language first.
- A **new element:** written as in the make-a-course workflows, from the author's source; added
  to `work/package.json` without an `origin`, and placed in the course's `items`.
- A **removed element:** its object and its `items` entry are taken out of the package, and in
  `work/course-state.json` it leaves `order` and gets `status: "removed"` — an approved element
  that is merely missing is a loss, and production stops.

After the approval, update the course state: each element's stored text, and what must survive.

## Gate 4 — Independent check

A fresh pass over the **changed and new** elements only ([check-and-produce.md](../references/check-and-produce.md#gate-5--independent-check)):
does the course still deliver its objectives with these changes, is nothing claimed that the
source does not support, is the language one throughout, does no exercise give away a test answer,
does the learner read nothing about the export or the course as it was, and do the course's
description and its tests still agree with the changed sections. Do not re-review unchanged
elements.

Do not wait for approval here. Fix what is plainly a slip and go on to production; stop only for
what needs the author's decision, and report the rest with the delivery.

## Gate 5 — Production

1. **Translate the changed and new elements** to the other two languages
   ([localization.md](../references/localization.md)). Unchanged elements keep their three
   languages from the file — do not touch them.
2. **Produce**, with the change list:

   ```
   node scripts/produce-course.mjs work/package.json --out work/kurs-<navn>-oppdatert.json --state work/course-state.json --changes work/changes.json
   ```

   The command runs the craft checks (figures, learner text, questions, languages) on the changed
   and new elements only — the unchanged ones are the author's course as it stands — and one more,
   **changes**: every element listed `unchanged` must be word for word as in the export — text,
   title and pictures — and so must the course's own fields when `course` is `unchanged`, and the
   order when `order` is `unchanged`; the questions rule (one per section before the test, at
   least three) counts the whole course and is reported for changed and new tests; a
   `changed` one must differ; a `new` one carries no `origin`; a `removed` one is gone. A `FAIL`
   there means you touched something nobody asked for, or forgot a change: fix it, do not relist it.
3. Fix every `FAIL` and run again. Deliver only the file named after `DELIVER`.

## Delivering

Give the author the file, the change list as approved, and say:

- **what changes:** each changed, new and removed element by name, and that everything else is
  word for word as before;
- **how to import it:** at *Innholdsforvaltning → Kurs → «Importer kurs»*, the platform
  recognises the course and asks — the author chooses **«Oppdater dette kurset»**. Changed
  elements get a new version laid ready, nothing is published; the author reviews each new
  version and publishes it. The course's order, its title and description, and the removals take
  effect at once;
- **which checks ran, by name**, including `changes`, and which did not, and what the independent
  check found and fixed;
- the title rule and the new-module rule from gate 2, where they apply;
- the closing line: *"Nye versjoner ligger klar — gjennomgå og publiser dem manuelt i admin-UI."*

If the platform answers that the file is **out of date** («utdatert», `origin_stale`), someone
changed an element after the export. Ask for a fresh export, run `adjust-from-export.mjs` again
into a new folder, and carry your changes over to the changed elements only.
