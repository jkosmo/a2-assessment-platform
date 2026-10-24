# Modules — task, assessment criteria, multiple-choice questions

Contents: [Free-text modules](#free-text-modules) · [Multiple-choice questions](#multiple-choice-questions) ·
[Select all that apply](#select-all-that-apply) · [The cue check](#the-cue-check)

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
- **A warm-up in the section before it — never in the task text.** A free-text module gets a «skriv selv» frame (one of that section's
  one or two exercises — [section-content.md](section-content.md#choosing-the-practice)) in the
  section it follows: the same kind of situation, smaller, with an example answer from the source
  and a checklist that mirrors these criteria — so the learner has practised formulating it before
  it is assessed ([section-content.md](section-content.md#write-it-yourself)). The frames `:::steg`,
  `:::skriv`, `:::repetisjon` and `:::par` are not drawn in a module's text: there they show as markers, and
  `produce-course.mjs` fails on them. «Think first» and «check yourself» work in both.

## Multiple-choice questions

- **The set covers what the module tests.** A module follows one or more sections; write at least
  one question per section it follows, and at least three in all. Few whole tests, not many thin
  ones: a four-question quiz after six sections leaves four of them untested. `produce-course.mjs`
  counts this.
- The stem tests **one** idea.
- **Not answered in a section already.** A question does not repeat a section's exercise — the same
  situation or the same numbers ([section-content.md](section-content.md#choosing-the-practice)).
- 3–4 options. Exactly one is unambiguously right — unless the question is a
  [select all that apply](#select-all-that-apply). Never "alle de over".
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

## Select all that apply

**Whenever a test's questions are written** — a new test, or a test written again while adjusting
a course ("lag testene på nytt", "regenerer testen", "skriv nye spørsmål") — some questions are
`"questionType": "multiple"`
([package-schema.md](package-schema.md#a-module)) — how many, which, and how many options in each are
right is drawn at random, not chosen by you. Before writing a module's questions, run

```
node scripts/mcq-plan.mjs <number of questions> [options per question, default 4]
```

It prints the plan, for example «Question 4: select all that apply — 3 of 4 correct». Between 10 %
and 50 % of the questions are planned, and each has from one to all options right. Follow it
exactly: a fixed share or a fixed number of right options would be a pattern the learner learns.

**Construct each planned question for its purpose.** Search the source for facts where several
statements hold for the same question — the required contents of something, the principles or
conditions that all apply, the steps or roles that all belong — and build the question so that
exactly the planned number of options are statements the source supports. The wrong options are
plausible statements the source contradicts or does not support. Take each planned question from a
different part of the source. Never make up a fact to reach the number; if the source cannot carry
the plan, say so at gate 4 and ask the author.

- **When adjusting questions that stay** — rewording one, fixing a rationale, changing something
  else in the course — every question keeps its type unless the author asks to change it. When the
  author asks in general for more of them ("gjør noen av spørsmålene til velg alle") or for a harder
  test, choose yourself which questions and how many — at most half the set. A test that is written
  again is not "questions that stay": it follows the plan above.
- **Every option is a statement that is true or false on its own** under the stem. No option
  contains or depends on another.
- **The stem does not say how many are right** — not "hvilke to", not "nevn tre". The platform tells
  the learner to select all that apply. Every option may be right.
- **The stem is plural whatever the number** — "Hvilke av disse …", "Kva for nokre …", "Which of
  these …" — also when one option is right. "Hvilket …", "Hvilken …" or "Which one …" says that
  exactly one is.
- **The right options look like the wrong ones**: the same length and detail.
- The `rationale` says, for each option, why it is or is not right.

The learner gets the question right only by choosing exactly the right options; there are no part
marks.

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
