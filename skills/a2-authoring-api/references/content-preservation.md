# Keeping what the author has approved

Contents: [The course state](#the-course-state) · [After each approval](#after-each-approval) ·
[When the author asks for a shorter text](#when-the-author-asks-for-a-shorter-text) ·
[Before production](#before-production)

A long dialogue produces approved content. A later request — "fjern gjentakelser", "kort ned",
"gjør det mer konsist" — can then quietly rewrite an element as a summary and drop an approved
example, formula, step, caveat, task or criterion. The result still imports. It is no longer the
course the author approved. The course state is what makes that loss visible.

## The course state

One file, `work/course-state.json`, separate from the chat:

```json
{
  "primaryLanguage": "nb",
  "order": ["sec-arbeidsgang", "sec-kilder", "mod-referat"],
  "elements": [
    {
      "clientRef": "sec-kilder",
      "type": "section",
      "title": "Hva du gir KI",
      "status": "approved",
      "content": "Utkastet blir aldri bedre enn det du legger inn. Tre kilder er vanlige.\n\n### …",
      "mandatory": {
        "examples": [],
        "formulas": [],
        "templates": ["Bruk bare det som står i notatene under. Skriv «uklart» der notatene ikke sier noe."],
        "tasks": [],
        "assessmentCriteria": [],
        "terms": ["Sakliste", "Egne notater", "Opptak"]
      },
      "figures": [],
      "deliberatelyRemoved": []
    }
  ]
}
```

| Field | Holds |
|---|---|
| `order` | the elements' `clientRef`s in the course's final order |
| `clientRef` | the element's id (`a–z`, `0–9`, `-`), the same as in the package; never reused |
| `status` | `draft` until the author has approved the element, then `approved` |
| `content` | the **full text as last approved**, word for word — never a summary |
| `mandatory` | the exact strings that must survive: `examples`, `formulas`, `templates` (prompts, forms, attachments), `tasks`, `assessmentCriteria`. `terms` and any other list you add are tracked too |
| `figures` | per approved figure: `{ "sourceId": "fig-…", "labels": ["…", "…"] }` |
| `deliberatelyRemoved` | strings the author has agreed to drop — only possible for `terms` and your own lists; a mandatory item cannot be removed, only moved to an attachment |

A whole state file: [examples/course-from-slides/course-state.json](../examples/course-from-slides/course-state.json).

## After each approval

Write the element to the state **in full**, set `status` to `approved`, and record what must
survive:

- every worked example, in a phrase that identifies it;
- every formula, prompt and template, word for word;
- every task and every assessment criterion;
- every figure, with its labels.

Choosing what is mandatory is your judgement. Once a string is recorded, losing it is caught
mechanically. A revision is always made from `content` — never from what you remember of the
chat.

## When the author asks for a shorter text

"Remove repetition" means: drop repeated explanations, duplicated definitions and filler. It does
not mean: drop an example, a formula, a step, a caveat, a task or a criterion. Useful detail that
is too long moves to an optional attachment; it is not deleted.

Write the revised text to a file and review it before you show it:

```
node scripts/course-state.mjs review work/course-state.json sec-kilder work/revised.md
```

It fails when

- a mandatory item is gone — whatever the size of the cut;
- a tracked item is gone and is not in `deliberatelyRemoved`;
- the text is more than 20 % shorter and the author has not approved the shortening. Show the
  author what goes, get a yes, and run again with `--reduction-approved`.

When it passes and the author approves the revision, it replaces `content` in the state.

## Before production

Production starts only when every approved element is placed in `order` and has its full text
stored. `produce-course.mjs --state work/course-state.json` checks this, compares the state with
the package, and compares it once more with the finished import file: an approved element that is
absent, a mandatory item that is lost and a tracked item that is unexpectedly missing each stop
the delivery ([check-and-produce.md](check-and-produce.md#reading-the-report)).

An import file that is valid and incomplete is an error, not a delivery.
