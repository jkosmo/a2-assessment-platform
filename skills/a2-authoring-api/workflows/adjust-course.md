# Workflow: adjust a course that is already on the platform

Contents: [Gate 1 — the export file](#gate-1--source-the-export-file) · [Gate 2 — the change list](#gate-2--the-change-list) ·
[Gate 3 — each changed element](#gate-3--each-changed-element) · [Gate 4 — independent check](#gate-4--independent-check) ·
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

Stop at every gate and wait for the author.

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

Rules the list must respect:

- The **title** of a section that is live, and of any module, is not changed by the import — the
  title belongs to the element, not to its version. A new title is set in the admin UI; say so
  rather than changing it in the file.
- A **new module** in a course that is published is not placed in the course by the import: it
  lands as a draft under *Moduler*, and the author publishes it and places it. Say so.
- A **removed** element is taken out of the course, not deleted; it stays in the library.
- An element the author does **not own** (made by another author) is replaced on import by the
  author's own copy when the file changes it. Mention it when you see a change on such an
  element — the author knows who made what; you do not.

When the author approves, write the decisions into `work/changes.json`:

```json
{ "baseline": "baseline.json", "elements": { "sec-01-innledning": "unchanged", "sec-02-metode": "changed", "mod-03-test": "unchanged", "sec-04-ny-del": "new" } }
```

A removed element keeps its `clientRef` in the list, marked `removed`, and is taken out of the
package and of the course's `items`.

## Gate 3 — Each changed element

One element per turn, approved before the next — as gate 4 of the make-a-course workflows, with
the same craft ([section-content.md](../references/section-content.md),
[figure-design.md](../references/figure-design.md), [modules.md](../references/modules.md),
[icons.md](../references/icons.md)) applied to **what changes only**. Everything else stays word
for word as it came from the file.

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

After each approval, update the course state: the element's stored text, and what must survive.

## Gate 4 — Independent check

A fresh pass over the **changed and new** elements only ([check-and-produce.md](../references/check-and-produce.md#gate-5--independent-check)):
does the course still deliver its objectives with these changes, is nothing claimed that the
source does not support, is the language one throughout. Do not re-review unchanged elements.

## Gate 5 — Production

1. **Translate the changed and new elements** to the other two languages
   ([localization.md](../references/localization.md)). Unchanged elements keep their three
   languages from the file — do not touch them.
2. **Produce**, with the change list:

   ```
   node scripts/produce-course.mjs work/package.json --out work/kurs-<navn>-oppdatert.json --state work/course-state.json --changes work/changes.json
   ```

   The command runs every check of the make-a-course workflows and one more, **changes**: every
   element listed `unchanged` must be word for word as in the export — text, title and pictures;
   a `changed` one must differ; a `new` one carries no `origin`; a `removed` one is gone. A `FAIL`
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
- **which checks ran, by name**, including `changes`, and which did not;
- the title rule and the new-module rule from gate 2, where they apply;
- the closing line: *"Nye versjoner ligger klar — gjennomgå og publiser dem manuelt i admin-UI."*

If the platform answers that the file is **out of date** («utdatert», `origin_stale`), someone
changed an element after the export. Ask for a fresh export, run `adjust-from-export.mjs` again
into a new folder, and carry your changes over to the changed elements only.
