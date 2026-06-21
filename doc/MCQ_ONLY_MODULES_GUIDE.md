# MCQ-only modules — author guide

A module can be **MCQ-only**: the participant answers multiple-choice questions only, with **no
free-text answer and no LLM evaluation**. Pass/fail is decided purely by the MCQ score against a
threshold. Use this for knowledge checks where a written deliverable isn't needed — it is faster
and cheaper (deterministic grading, no LLM call).

The alternative (and default) mode is **free-text + MCQ**, where the participant submits a written
answer that is graded by the LLM in addition to the MCQ.

## Create an MCQ-only module (advanced editor)

1. Open the module in the **advanced editor** (`/admin-content/module/<id>/advanced`).
2. Author the **MCQ set** as usual (step 7).
3. In **step 8 — "Module version shown to participant"**, tick **“MCQ-only module (no free-text
   answer or LLM assessment)”**.
   - The free-text fields (assignment text, scoring rules, evaluation instruction) disappear —
     you don't need them.
   - A **“MCQ pass threshold (%)”** field appears (default **70**). Set the minimum percentage of
     correct answers required to pass.
4. Save the draft version (steps 5–8) and **publish** it. Rubric and evaluation instruction are
   skipped automatically for MCQ-only modules.

## Create an MCQ-only module (conversation)

You can also create an MCQ-only module in the **conversational workspace** (`/admin-content`).
Since v1.3.36 (#555) the conversation follows the same order as the advanced editor —
**source → module type → content → publish**:

1. Choose **“Create new module”** and enter a title.
2. Paste or upload the **source material** (this is now the first question).
3. At **“What kind of module is this?”**, pick **“MCQ only”**.
4. Choose the certification level, number of questions, and options per question.
5. The questions are generated — there is **no scenario or assessment-plan step** for MCQ-only.
6. Review in the preview and **save**. The version is saved with a default **70 %** pass mark;
   change it later in the advanced editor if you need a different threshold.

Picking **“Free-text + MCQ”** instead keeps the full flow (scenario → certification level →
assessment plan → questions).

> Since v1.3.41 (#579) the **“Generate new content from source material”** flow (used when you
> create a module from the library and land in the conversation, or reopen an existing module) also
> asks the module-type question after the source step — so you can pick or switch to **“MCQ only”**
> there too. Saving then writes a new MCQ-only version.

## What the participant sees

- Selecting an MCQ-only module goes **straight to the questions** — there is no “create
  submission” / free-text step.
- On submit, the result is shown **immediately** (deterministic scoring, no waiting for LLM):
  *Automatic pass* if the MCQ score ≥ threshold, otherwise *Automatic fail*.

## Certification

Course completion and certificates require the participant to **pass all modules** in the course
**and read all learning sections**. An MCQ-only module counts as a module that must be passed,
exactly like a free-text module.

## Export / import

MCQ-only modules export and import as normal module packages. The package records the
`assessmentMode` and the MCQ pass threshold; rubric, evaluation instruction and assignment text are
omitted for MCQ-only modules and restored as such on import.

## Notes

- Existing modules are unaffected — they remain free-text + MCQ unless you explicitly switch.
- The MCQ pass threshold is stored per module version (in the assessment policy), so different
  modules can use different thresholds.
