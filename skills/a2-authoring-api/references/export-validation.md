# The import file — what "validated" means

The import file is an `a2-content-export/v1` envelope. `scripts/produce-course.mjs` builds it from
the package; you do not write it by hand. This file says what the command guarantees, so that you
report it correctly.

## The rule

> An import file is validated only when the **finished file** has been read back from disk and
> checked against the same rules as the platform's import.

`produce-course.mjs` does exactly that, in this order: build the complete envelope → write it →
read the written file back → parse it → validate it → name it after `DELIVER` only if everything
passed. A file that fails is removed, so it cannot be handed over by mistake. Never validate one
copy and deliver another.

## The checks, by name

| Check in the report | Means |
|---|---|
| **JSON parsing** | the written file parses |
| **export-schema validation** | its structure is `a2-content-export/v1`: scope and payload agree, every item has its place, titles are there, every multiple-choice answer equals one of its options in every language |
| **import-schema validation** | it passes what the import itself requires, including the date format |
| **content-integrity** | nothing recorded in the course state is missing from the file (run when `--state` is given) |
| **encoding-integrity** | no garbled characters (`Ã¦`, `Ã¸`, `Ã¥`) |

Two things are never checked here, and you say so:

- **There is no trial import.** The platform's import writes; it cannot be asked for a verdict
  without creating the drafts.
- **The import itself** is done by the author in the admin UI.

So the report names the checks that ran. It never says "validert" on its own, and it never claims
that the platform has accepted the file.

## What the command takes care of

You do not do these by hand; they are listed so that you recognise them in a file.

- **Dates** are written as `2026-07-10T21:05:15.364Z` — three decimals and `Z`. The import
  refuses a timezone offset (`+00:00`) and microseconds.
- **Every character outside ASCII is written as `\uXXXX`.** `æ`, `ø` and `å` then survive any
  download or editor that re-encodes the file. A source that already contains garbled characters
  cannot be repaired by the command: it fails, and you fix the text in the package.
- **Every section and module carries an empty `audit`.** No publish history means the import can
  only create drafts.
- **`provenance`** says the file was made by this skill and which version. Never remove it, and
  never change it to say a human wrote the content.

If the command cannot run where you are, you cannot produce a validated import file. Say so, and
hand over the package (`work/package.json`) for someone to run production on — do not write the
envelope by hand.
