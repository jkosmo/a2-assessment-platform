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
