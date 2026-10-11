# Translation — one language while writing, three in the delivery

Contents: [The rule](#the-rule) · [What is translated](#what-is-translated) ·
[What a translation must keep](#what-a-translation-must-keep) · [Figures](#figures) ·
[Pictures](#pictures) · [What the check catches](#what-the-check-catches)

## The rule

The course is written and approved in **one** language. After that, and before production, every
text a learner sees is translated to the other two. The platform's languages are **nb** (bokmål),
**nn** (nynorsk) and **en-GB** (British English).

A delivered course is complete in all three — **sections included**. The import accepts a section
written in one language only, so nothing on the platform will stop you; the check here does. What
you leave untranslated, a person must later have translated on the platform, one text at a time.

## What is translated

| In | Fields |
|---|---|
| the course | `title`, `description` |
| a section | `title`, `bodyMarkdown` |
| a module | `title`, `description`, `taskText`, `assessorExpectedContent`, `candidateTaskConstraints`, the labels and placeholders of `submissionSchema.fields[]`, `promptTemplate.systemPrompt` and `userPromptTemplate` |
| a multiple-choice set | `title`, and per question `stem`, every entry in `options`, `correctAnswer`, `rationale` |
| a figure | every label (below) |

Each of these is written as `{ "nb": "…", "nn": "…", "en-GB": "…" }`. A plain string is only for
a value that is the same in every language — a product name, a number.

**Not translated by the format:** `rubric.criteria` and `rubric.scalingRule` are plain data with
one value each. Write them in the course's primary language, and tell the author that the
criteria exist in one language.

## What a translation must keep

- **The meaning and the level.** A translation makes no new claim and is neither easier nor
  harder than the original.
- **The right answer.** `correctAnswer` equals one of the `options` in every language — the same
  option, in the same position. After translating a question, check again which option is right.
- **The number and order of options**, questions and criteria.
- **Every formula, code, identifier, file name and address**, unchanged.
- **The markdown:** the same headings, lists, tables, boxes and `![…](asset:…)` references in
  every language. Alt texts are translated; the `asset:` reference is not.
- **A prompt** is translated, so that the learner can use it in their language. Names of menus
  and buttons in a product stay as the product shows them.

Write natural Nynorsk and natural British English, not Bokmål with the words swapped.

## Figures

A figure with labels in one language breaks the promise as surely as untranslated text. Every
figure with labels gets a drawing per language, with identical geometry: the same number of
labels in the same places, only the words changed. How to draw them:
[figure-design.md](figure-design.md#the-other-languages).

A figure's narrow layout needs the same languages as the wide one.

## Pictures

A screenshot or photo is the same file in all three languages; text inside it cannot be
translated. Where that text matters and is in another language than the reader's, the sentence
before the picture says what it shows ([section-content.md](section-content.md#pictures-from-the-source)).

## What the check catches

`produce-course.mjs` runs the check under **languages**. It fails on

- a field that lacks one of the three languages;
- a text that is identical in all three — copied, not translated. Short words, names and numbers
  that are rightly the same ("GDPR", "72") are not counted;
- a right answer that sits in a different position, or matches no option, in some language;
- a formula, address, identifier or file name that is in the primary language and missing from a
  translation;
- a figure that lacks a language, has a different number of pieces of label text in one, or whose
  English labels are the Norwegian ones (or the other way round); a narrow layout whose labels
  differ from the wide figure's. Labels that are the same in Bokmål and Nynorsk are accepted:
  between those two, a short label is often rightly the same word.

It cannot judge whether a translation is good. That is your reading, and part of the independent
check where the reviewer reads all three languages.
