# Course design — objectives, structure, test form, level

Contents: [Learning objectives](#learning-objectives) · [Structure](#structure) ·
[A revision course](#a-revision-course) · [Test form](#test-form) · [Level and scope](#level-and-scope)

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
  A revision course is the exception: it starts with questions ([below](#a-revision-course)).
- **A reference is an appendix, not a section to read.** A catalogue of features, a set of template
  prompts or a prompt pack goes in a section of its own at the end, «Vedlegg: …», that no module
  tests; the section that teaches keeps the few the objective needs
  ([section-content.md](section-content.md#teach-not-catalogue)). Show it in the outline.
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
- **Terms before the process:** where a process or a method is built of several new terms, the
  terms are explained briefly before it — in the same section or one before
  ([section-content.md](section-content.md#choosing-the-practice)). Show it in the outline.
- **A procedure or a calculation is learnt in three stages:** a worked example, then an example the
  learner completes, then a whole task in another situation
  ([section-content.md](section-content.md#complete-the-example)). Plan the three in the outline.
- Present the outline as a table: element, order, test form (for a section: its exercise, or none),
  the objective it serves, level.

## A revision course

A course that repeats one the learners have taken («Repetisjon …», a refresher before a hand-in)
starts with questions, not with the material again. Reading the same text again is the weakest way
to repeat; trying to remember first, and then reading what you missed, is what makes it stick.

1. **Questions first.** The first section is 5–6 «sjekk deg selv» questions
   ([section-content.md](section-content.md#check-yourself)) on what the course taught — the terms
   first, then the process and the judgements built on them
   ([terms before the process](section-content.md#choosing-the-practice)). A sentence before them
   says why: try first, read after. This section is the exception to «none or one exercise».
2. **Each explanation points to the section that explains it**, by its title: «Les mer i «Etter
   møtet».» Never by a number; the order can change.
3. **The sections after are shorter** than in the course they repeat: each opens with what learners
   most often get wrong — the misconceptions behind the questions' wrong options — and leaves out
   what the questions show is easy. Not the whole material again.
4. **The test at the end uses new situations** — not the opening questions, and not the sections'
   examples ([modules.md](modules.md#multiple-choice-questions)).

The platform has no test that lets a learner skip a section; everyone reads every section, which is
one more reason to keep them short.

An outline for «Repetisjon: møtereferat med KI»:

| # | Element | What it holds | Exercise |
|---|---|---|---|
| 1 | Section «Hva husker du?» | six questions: two on terms (vedtak, oppfølgingspunkt), four on situations; each explanation names the section below | the six questions |
| 2 | Section «Før møtet» | what is most often missed: the purpose of the minutes and who reads them | none |
| 3 | Section «Etter møtet» | the checks against the notes — dates, names, decisions | find the errors |
| 4 | Module «Test: møtereferat» | new meetings and new notes, other than the questions in 1 | multiple choice |

One of the opening questions:

```markdown
:::sjekk Du har rånotater fra et styremøte og ber KI om et utkast til referat. Hva sjekker du først?
- [ ] At språket er formelt nok
- [x] At vedtak og frister stemmer med notatene
- [ ] At utkastet er kortere enn notatene

Vedtak og frister er det leserne handler på; en feil der får følger. Les mer i «Etter møtet».
:::
```

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
