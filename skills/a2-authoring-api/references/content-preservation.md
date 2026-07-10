# Content preservation — the authoritative course state + master

Why this exists: a long dialogue produces **approved** content, then a later request ("fjern
gjentakelser", "kort ned", "gjør det mer konsist") silently rewrites elements as short
summaries and drops approved examples, formulas, work-steps, caveats, tasks,
assessment-criteria or attachments. The export is still schema-valid — but pedagogically
gutted. This file is the discipline that makes that failure impossible to ship.

Deterministic helpers: [scripts/course-state.mjs](../scripts/course-state.mjs)
(`reviewRevision`, `auditExport`, `checkGate6Readiness`, `reductionRatio`). Unit-tested in
`test/unit/agent-authoring-course-state.test.ts`.

## The authoritative course state + master

The skill keeps ONE source of truth for the course, separate from the running chat:

- **With a filesystem** (Claude Code, a workdir): `workdir/course-state.json` (the structured
  state) + `workdir/course-master.md` (the human-readable full course). Optionally one file
  per element (`workdir/elements/<clientRef>.md`).
- **In a plain chat** (no filesystem): a single canonical **"course master" block** kept in the
  conversation and **rewritten in full after every approval** — never a running diff the reader
  has to reassemble.

State must hold, **per element**:

| Field | Meaning |
|---|---|
| `clientRef` | stable id (`[a-z0-9-]{1,64}`), never reused |
| `type`, `title` | `module` / `section` / `course`; element title |
| `content` | the **full last-approved text** (markdown / payload), verbatim |
| `status` | `draft` / `approved` / … |
| `learningObjectives` | which objectives this element teaches/assesses |
| `mandatory` | `{ examples, formulas, templates, tasks, assessmentCriteria, terms }` — the strings that MUST survive |
| `sources` | the confirmed sources this element traces to |
| `primaryLanguage` | the one language the element is authored in (see localization.md) |
| `deliberatelyRemoved` | items the author explicitly approved dropping (audit trail) |
| `revisionHistory` | `[{ at, note, length }]` — one entry per approved revision |

**Full text, always.** After each approval the element is stored in **full** in the master. A
revision is a diff **against the last approved full version** — never reconstruct an element
from a conversation summary when the full version exists. The chat may scroll away; the master
does not.

## What "remove redundancy" is allowed to mean

- **Drop:** repeated explanations, duplicated definitions, filler.
- **Keep:** every unique piece of subject content — examples, formulas, operative steps,
  caveats, tasks, assessment criteria.
- **Relocate, don't delete:** useful-but-long detail moves to an **optional attachment**, it is
  not removed. Content in an attachment still counts as preserved.

## Gate-4 revision review (`reviewRevision`)

Run when the author asks to shorten/revise an approved element. Compares the proposed revision
to `element.content` and returns `{ reductionRatio, requiresApproval, lostMandatory, lostUnique,
movedCount, blocks, reasons }`.

It **blocks** when:

1. **Any** mandatory item (`examples` / `formulas` / `templates` / `tasks` /
   `assessmentCriteria`) is lost — neither present in the new text nor moved to an attachment.
   This blocks **regardless of the reduction percentage**.
2. Any unique tracked item is **unexpectedly missing** (gone, and not on the author-approved
   `deliberatelyRemoved` list).
3. The reduction is **> 20 %** of the approved length **and** the author has not explicitly
   approved that reduction (`reductionApproved`).

A >20 % reduction with every mandatory item kept still requires explicit approval before it can
be produced.

## Pre-export loss audit (`auditExport`)

Before Gate 6 produces the file, classify every approved master element against what actually
made it into the export — each item is **preserved** / **moved** / **deliberately removed** /
**unexpectedly missing**:

- an **approved element entirely absent** from the export → blocks (a schema-valid export that
  is missing an approved element is an error, not a pass);
- any **unexpectedly-missing** item → blocks;
- any **lost mandatory** item → blocks.

`extractPackageElements(pkg)` / `extractEnvelopeElements(envelope, order)` turn the produced
artifact into the `{ ref, text, attachmentsText }` rows the audit consumes.

## Gate 6 must not start early (`checkGate6Readiness`)

Production must not begin without a **complete course master in final order**: every approved
element is placed in `order`, `order` references only known approved elements, and no element
has empty stored content. If readiness fails, fix the master first — do not produce.

## After export

Re-read the finished file and compare it to the master (`auditExport` again, over
`extractEnvelopeElements`). **Schema-valid-but-incomplete is an error** — report it and do not
deliver the file as final.

## What is deterministic vs behavioral

The scripts enforce the rules deterministically **given the mandatory-item strings the skill
records in the master**. Choosing what is "mandatory" and keeping the master faithful to the
dialogue is the skill's (behavioral) responsibility; the moment an item is recorded, its loss is
caught mechanically.
