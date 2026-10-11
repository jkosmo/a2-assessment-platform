# Modules — task, assessment criteria, multiple-choice questions

Contents: [Free-text modules](#free-text-modules) · [Multiple-choice questions](#multiple-choice-questions) ·
[The cue check](#the-cue-check)

A module tests. Write it from the source, in the course's one language, at the level agreed at
gate 3 ([course-design.md](course-design.md#level-and-scope)).

## Free-text modules

- **Task text:** a concrete situation tied to the source that gives the learner something to do or
  decide. Not "Drøft X".
- **Assessment criteria (rubric):** each one named, tied to an objective, with a described scale,
  for example `"identifisering": "0–4: identifiserer korrekt grunnlag og avgrenser mot
  alternativene"`. Every criterion is something an assessor can observe in an answer; no lone
  "kvalitet".
- **Expected content:** what a strong answer contains. It guides the automatic assessment.

## Multiple-choice questions

- The stem tests **one** idea.
- 3–4 options. Exactly one is unambiguously right. Never "alle de over".
- **Distractors are real misconceptions** — the wrong judgements a real learner would make.
- A short `rationale` says why the right answer is right.
- **At least half the questions ask for a judgement in a situation** ("En entreprenør skal grave
  nær en strømførende kabel — hva kommer først?"), not for a definition.

**The right answer must not give itself away.** A learner who picks "the longest option" must not
pass.

- **Same shape, same length.** Write every option as a complete, specific statement about as long
  as the right one. If the right option needs a qualifier, the wrong ones get qualifiers too.
- **Spread the position.** Place the right option so that, across the set, every position is used
  about equally. The platform shuffles the options for the learner, so length is the cue that
  reaches them — but a set with the answer always first is a set nobody checked.

## The cue check

Run it before a module's questions are shown at gate 4, and again before production:

```
node scripts/mcq-cue-check.mjs work/package.json
```

It measures the length of the right option against the others per question, and the spread of
position and length across the set. A line that starts with `OK` has passed; the numbers after it
are for your information. Fix every finding on a `FAIL` line. A clean report does not say the
questions are good; it removes the mechanical cues so the author's reading is about the content.

To add questions to a module that already exists on the platform, read its question bank first and
write questions that test other points ([api-flow.md](api-flow.md)).
