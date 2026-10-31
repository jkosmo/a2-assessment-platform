# Modules — task, assessment criteria, multiple-choice questions

Contents: [Free-text modules](#free-text-modules) · [Example answer](#example-answer) · [Multiple-choice questions](#multiple-choice-questions) ·
[Select all that apply](#select-all-that-apply) · [Put in the right order](#put-in-the-right-order) · [Fill in the missing word](#fill-in-the-missing-word) · [The cue check](#the-cue-check)

A module tests. Write it from the source, in the course's one language, at the level agreed at
gate 3 ([course-design.md](course-design.md#level-and-scope)).

## Free-text modules

- **Task text:** a concrete situation tied to the source that gives the learner something to do or
  decide. Not "Drøft X".
- **Not what the sections already did.** The task takes another situation than the cases and
  examples the sections worked through — and does not ask for the one thing a section showed
  finished (the prompt it gave, the order it rewrote). A learner who can copy from the sections is
  not assessed on understanding them.
- **Assessment criteria (rubric):** each one named, tied to an objective, with **each step of its
  scale described** — at least the lowest, the highest and one between:

  ```json
  "kontroll": "0–2: 0 = ingen kontroll; 1 = sier generelt at resultatet må sjekkes; 2 = sier at notatet må kontrolleres mot kildene, og hvordan"
  ```

  One line for the whole scale («0–4: Reglene er konkrete og relevante») leaves the assessor to
  guess what separates 1 from 3, and the feedback goes vague. Every step is something an assessor
  can observe in an answer; no lone "kvalitet". `produce-course.mjs` fails on a criterion without
  its steps.
- **Every criterion assesses something the task text asks for.** A learner who answers what was
  asked must not lose points for what was not asked. If a criterion needs the learner to do
  something, the task says so; if the task cannot say it, drop the criterion. Read the criteria and
  the task side by side before gate 4.
- **Expected content:** what a strong answer contains. It guides the automatic assessment.
- **An example answer** (`modelAnswer`) for every free-text module — see [below](#example-answer).

## Example answer

`activeVersion.modelAnswer` is a strong answer to the task, **written as a learner would write it**
— not notes about one. After the answer is assessed, the platform can show it next to the learner's
own answer and the feedback per criterion, so she sees what a strong answer looks like in the same
situation. The expected content stays hidden; the example answer is the one the learner may see.

- **Top of every criterion.** Read it against each criterion's steps: it reaches the top step of
  every one, and nothing in it is outside what the task asks.
- **One of several good answers, not the only one.** Plausible length for the scope, the learner's
  own voice (no «Kandidaten bør …»), the facts of the task's situation — not a template.
- **Not a copy of an exercise.** The «skriv selv» before the module has its own example answer for a
  smaller situation; this one answers the module's task.
- **All three languages**, like the task. Plain text: paragraphs and simple lists, line breaks kept.
- The platform shows it only when the module turns it on (`assessmentPolicy.practical.
  modelAnswerAfterAssessment: true`). **Off by default** — in a test the next learner could get it from
  the previous one. Turn it on for practice and revision modules, and ask the author for tests.

`produce-course.mjs` fails on a free-text module without one (a NOTE when adjusting a course).
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
- The stem tests **one** idea — one objective, taught in a section before the test. Link each
  question to both in the course state
  ([course-design.md](course-design.md#linking-questions-to-objectives)); a question you cannot link
  is the wrong question.
- **Not answered in a section already.** A question does not repeat a section's exercise — the same
  situation or the same numbers ([section-content.md](section-content.md#choosing-the-practice)).
- 3–4 options. Exactly one is unambiguously right — unless the question is a
  [select all that apply](#select-all-that-apply). Never "alle de over".
- **Distractors are real misconceptions** — the wrong judgements a real learner would make.
- A short `rationale` says why the right answer is right, **and why the most tempting wrong option
  is wrong** — the learner who chose it learns what was wrong with her own reasoning, not only what
  the answer was. The wrong option is a real misconception, so the rationale names it: «Notatene
  viser hva som ble bestemt. Innkallingen sier bare hva som skulle skje — derfor er den ikke
  kilden.»
- **At least half the questions ask for a judgement in a situation** ("En entreprenør skal grave
  nær en strømførende kabel — hva kommer først?"), not for a definition.
- **Never a product detail.** A price, a licence plan, a file or usage limit, a menu path or a date
  changes with the product, and the right answer goes stale: two versions of one course already
  give different right answers to «Hva er riktig om bruksgrensene for …?». Ask what the learner does
  with the tool — when to use it, what to check afterwards. The details stand in the section's dated
  box ([section-content.md](section-content.md#teach-not-catalogue)).

**The right answer must not give itself away.** A learner who picks "the longest option" must not
pass.

- **Same shape, same length.** Write every option as a complete, specific statement about as long
  as the right one. If the right option needs a qualifier, the wrong ones get qualifiers too.
- **No absolute words that only the wrong options have.** "aldri", "alltid", "kun", "automatisk",
  "uansett" make an option easy to rule out. A wrong option is what a sensible person would
  believe: "Leser gjennom før det sendes, men bare stikkprøver tallene", not "Lar KI sende det
  automatisk".
- **Ask about the work, not about the course.** Not "Hva anbefaler kurset …?" but "Hva gjør du …?"
  or "Hva bør prosjektlederen …?" The learner meets the situation, not the course.
- **The right option in your own words.** A right option that repeats a sentence from the section
  is found by recognition. Say it the way it would come up in the work.

The platform shuffles the options for the learner, so their position does not matter.

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

## Put in the right order

A question can be `"questionType": "order"`: the learner puts 3–6 items in the right order
([package-schema.md](package-schema.md#a-module)). There is no plan for this one.

- **At most one per test, and only where the source states an order** — the steps of a procedure,
  the phases of a process, events in time. Never make up an order the source does not give, and
  never use it for items whose order is a matter of preference. When writing a test from a source
  with such an order, include one; when the source has none, write none, and say so at gate 4
  («ingen rekkefølge-spørsmål: kilden beskriver prinsipper, ikke steg»). It takes a place the plan
  has not given to «select all that apply», within the number of questions the test has.
- **Write the items in the right order.** That order is the answer key; the platform shuffles the
  items for the learner, never into the right order.
- **3–6 items**, each a short step distinct from the others. No item gives away its own position
  ("først", "til slutt", "steg 3").
- **When adjusting questions that stay**, an order question keeps its type and its order — reword
  the items if asked, but never reorder them unless the author says the order is wrong.
- The `rationale` explains the order.

The learner gets it right only with the whole order right; there are no part marks.

## Fill in the missing word

A question can be `"questionType": "fill"`: the stem has one blank (`___`), and the learner writes the
missing word ([package-schema.md](package-schema.md#a-module)).

- **Only for a word the learner should be able to recall** — a term, a number, a deadline the
  sections teach («Fristen for å klage er ___ uker»). Not for a judgement: that is a question with
  options. **At most one per test**, as the platform's own generation makes it, and none when the
  sections teach no such word. Like «put in the right order», it takes a place the plan has not
  given to «select all that apply».
- **One blank, in every language**, where the missing word belongs in that language.
- **`options` are the accepted answers** — every common way to write the same answer: the number in
  words and in digits («tre», «3»), an abbreviation and the full name; 1–6. Never a word with another
  meaning. Not alternatives to choose between: the learner never sees them. Upper and lower case,
  spaces and punctuation at the end do not count, and one wrong letter is accepted in an answer of 7+
  letters — do not list such spellings.
- **The stem gives enough to know which word** — one answer, not «a word that fits».
- **When adjusting questions that stay**, a fill question keeps its type and its blank.
- The `rationale` says why that is the word.

## The cue check

Run it before a module's questions are shown at gate 4, and again before production:

```
node scripts/mcq-cue-check.mjs work/package.json
```

It measures the length of the right option against the others, absolute words that only the wrong
options have, stems that ask what the course says, and right options that repeat the sections word
for word. A line that starts with `OK` has passed; the numbers after it are for your information.
**Fix every finding on a `FAIL` line before the author sees the questions** — `produce-course.mjs`
writes no import file while one remains. A clean report does not say the questions are good; it
removes the mechanical cues so the author's reading is about the content.

The platform runs the same check on every test and shows the findings to the author as warnings.

To add questions to a module that already exists on the platform, read its question bank first and
write questions that test other points ([api-flow.md](api-flow.md)).
