---
name: a2-authoring-api
description: >
  Build draft courses, modules and learning sections on the A2 Assessment Platform from
  conversation/project context. Structures requirements into an a2-authoring-package/v1,
  dry-runs it against the validate endpoint, orchestrates the create/import API calls, and
  returns admin-UI links to the unpublished drafts. Never publishes. Use when the user asks
  an agent to "create a course/module/section" on the platform (e.g. "lag et kurs fra denne
  samtalen med 6 fritekstmoduler og 2 læringsseksjoner").
---

# A2 Agent Authoring — build draft content via API

This is the **repo-canonical** skill (EPIC #647, AA-4 #652). Installed copies
(`.claude/skills/a2-authoring-api/`, ChatGPT/Codex project instructions) are pointers to
this file — edit here, never in the copies. Design contract:
`doc/design/AGENT_AUTHORING_647.md`.

## What you produce

Everything you create is an **unpublished draft**. A human reviews and publishes in the
admin UI. There are no publish fields in the package contract, and you must never call any
`.../publish` endpoint. That rule has no exceptions, including when the user asks for it —
point them to the admin UI links instead.

## Workflow

1. **Collect requirements** from the user and the conversation/project context: number of
   modules and sections, assessment mode(s) (`FREETEXT_PLUS_MCQ`, `MCQ_ONLY`,
   `FREETEXT_ONLY`), primary language (`locale`), certification level, ordering, and the
   actual subject matter the content should teach/assess.
2. **Author the package**: an `a2-authoring-package/v1` JSON document. Full contract with
   per-mode examples: [references/package-schema.md](references/package-schema.md). A
   complete working example: [fixtures/example-package.json](fixtures/example-package.json).
   Write real content — concrete task texts, rubric criteria tied to each module's topic,
   plausible MCQ distractors — not lorem ipsum. Record the user's requirements verbatim in
   `constraints` (audit trail).
3. **Validate (dry-run)**: `POST /api/admin/content/agent-authoring/validate` with
   `{ "package": <package> }` — or run
   `node skills/a2-authoring-api/scripts/import-package.mjs --file pkg.json --base-url <url> --validate-only`.
   The endpoint never writes; 200 with `valid: false` is a report, not an error.
4. **Fix and re-validate**: `issues[].path` is a JSON path into your package and
   `issues[].code` is stable — fix mechanically unambiguous errors (`required_for_mode`,
   `unknown_client_ref`, `unknown_field`, …) and re-validate. If an issue requires a
   judgment call (e.g. `possible_duplicate_title` — reuse the existing module instead?),
   ask the user instead of guessing.
5. **Confirm before writing** when the package is large (> ~5 objects), touches existing
   content (`moduleId`/`sectionId` references), or the requirements were ambiguous. Show a
   one-line-per-object summary of what will be created.
6. **Execute the plan** returned by validate, in order. Call sequence, exact bodies, and
   auth headers: [references/api-flow.md](references/api-flow.md). In a shell-capable
   environment, prefer the reference script (it implements the whole flow):
   `node skills/a2-authoring-api/scripts/import-package.mjs --file pkg.json --base-url <url>`.
7. **Report the result**: one line per created object with its admin link
   (`links.conversation`/`links.course`/`links.editor`), plus an explicit closing note:
   *"Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI."*
8. **On partial failure**: stop at the failed step. Report what WAS created (IDs + links),
   what failed (the API error body), and what remains. Do NOT delete anything — drafts are
   harmless and may contain work worth keeping; cleanup is the human's decision.

## Security rules (hard)

- **Never call publish endpoints** (`.../publish` on modules, module-versions, sections,
  courses). The draft-only invariant is the whole point of this API.
- **Tokens are secrets**: never write auth tokens/headers into package files, logs, chat
  output, or `constraints`. Pass them via environment variables only.
- **Stop on validation errors** — never "push through" by dropping fields blindly; show the
  field paths to the user when you cannot fix them unambiguously.
- Do not use `mode: "replaceExisting"` unless the user explicitly asked to overwrite a
  specific existing module and gave you its ID.

## Environment / auth

| Environment | Auth |
|---|---|
| Local dev (`npm run dev`, `AUTH_MODE=mock`) | Mock headers: `x-user-id`, `x-user-email`, `x-user-name`, `x-user-roles: SUBJECT_MATTER_OWNER` (or `ADMINISTRATOR`). Script env vars: `A2_USER_ID`, `A2_USER_EMAIL`, `A2_USER_NAME`, `A2_USER_ROLES`. |
| Staging/prod | `Authorization: Bearer <Entra JWT>` from a logged-in user (script env var: `A2_AUTH_BEARER`). Direct external-agent access is NOT available until AA-3 (#651) lands a short-lived agent token. |
