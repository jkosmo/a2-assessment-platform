# Course design — objectives, structure, test form, level

Contents: [Learning objectives](#learning-objectives) · [Structure](#structure) ·
[Test form](#test-form) · [Level and scope](#level-and-scope)

## Learning objectives

Objectives are the backbone: the structure and the tests follow from them.

- Propose 3–6 objectives, each as "Etter dette kan deltakeren …" with a verb that can be observed
  (identifisere, bruke, avgjøre, forklare). Each rests on something the source supports.
- Where the source states its own objectives, they are the proposal — all of them, also when
  there are more than six.
- An objective the source cannot support is flagged `[Avklaring: …]`, not given invented support.
- Confirm the course's language here (default: the language of the source).

## Structure

- **Map each objective** to a section that teaches it and a module that tests it. Plain recall may
  need only a module; background may need only a section.
- **Teaching comes before testing.** An introduction first; a summary last if the material needs one.
- **Few, well-formed modules** rather than many thin ones — roughly one per objective.
- **Practice inside the sections**, where the source gives the material for it: a step-by-step
  walk-through for a process, a case (a situation with «sjekk deg selv» and feedback per option) where
  a routine is applied, a «skriv selv» before a free-text module, flashcards or «finn parene» for the
  terms a section defines — none or one per section, two at most; which one follows from what the
  source gives ([section-content.md](section-content.md#choosing-the-practice)). Name them in the
  outline, per section, so the author approves them with the structure. None of it counts; the
  modules test.
- **At least one «finn feilene» per course** — a short piece of work with planted errors the
  learner finds, in the section that teaches the check
  ([section-content.md](section-content.md#find-the-errors)). It is in the outline by default; leave
  it out only when the author says so.
- Present the outline as a table: element, order, test form (for a section: its exercise, or none),
  the objective it serves, level.

## Test form

Choose it per module, deliberately. It is the most common design mistake.

| The objective asks the learner to | Use |
|---|---|
| recognise or recall; there is one clearly right answer | `MCQ_ONLY` |
| explain, analyse, decide and justify — the reasoning is the point | `FREETEXT_ONLY` |
| know something and then apply it | `FREETEXT_PLUS_MCQ` |

## Level and scope

Every module carries `certificationLevel`. The platform reads it. It sets two separate things;
agree both with the author at gate 3.

**Read the level in the source before you propose it.** Who the source addresses (an audience
slide, "for whom", prerequisites), what it assumes without explaining, and how far it goes decide
the level — not how much you know about the subject. An introduction for people who have never
used the tool is `basic`, even if the topic could fill an advanced course. Propose the level with
that evidence, in one sentence, and let the author confirm or move it.

**Complexity** — how tangled the material may be. It follows the level and governs sections as
well as modules: a basic section explains one situation plainly; an advanced one may hold
competing considerations.

| Level | Max actors | Max concepts | Max trade-offs |
|--------------|---|---|---|
| basic | 1 | 2 | 0 |
| intermediate | 2 | 3 | 1 |
| advanced | 3 | 4 | 2 |

**Scope** — how much the candidate is expected to write in a free-text task. This is the
platform's default per level; the author may choose otherwise.

| Level | Expected answer |
|--------------|------------------|
| basic | 100–200 words |
| intermediate | 250–450 words |
| advanced | 400–700 words |

Scope is not difficulty: a demanding question can deserve a short, precise answer. If the author
wants shorter answers at an advanced level, that is a legitimate choice. Ask; do not assume the
table.

Sections have no length number. How long a section should be is the author's call — they know
their readers. Ask, follow, and shorten on request.
