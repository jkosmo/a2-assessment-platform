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
   (`links.conversation`/`links.course`/`links.editor`), the run's `agentRunId` (audit
   trace), plus an explicit closing note:
   *"Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI."*
8. **On partial failure**: stop at the failed step. Report per plan step what happened
   (done / failed / skipped), what WAS created (IDs + links), the API error body, and the
   `agentRunId` (every completed write is audit-logged with it, so the run is
   reconstructable). Do NOT delete anything — drafts are harmless and may contain work
   worth keeping; cleanup is the human's decision.

## Security rules (hard)

- **Never call publish endpoints** (`.../publish` on modules, module-versions, sections,
  courses). The draft-only invariant is the whole point of this API.
- **Tokens are secrets — but a pasted `aat_` token is an accepted workflow**: the user may
  paste a short-lived agent authoring token (and the installation URL) directly into the
  conversation; use it for this run's API calls. You must NEVER echo the token back, quote
  it in summaries/plans, or write it into package files, logs, or `constraints`. Full
  bearer JWTs and any other credentials still belong in environment variables only.
- **Stop on validation errors** — never "push through" by dropping fields blindly; show the
  field paths to the user when you cannot fix them unambiguously.
- Do not use `mode: "replaceExisting"` unless the user explicitly asked to overwrite a
  specific existing module and gave you its ID.

## Environment resolution (multitenant)

The platform is installed **per tenant** — each customer/organization runs its own
installation with its own URL and its own identity provider. There is **no default or
hardcoded environment**. Resolve the target installation for every run, in this order:

1. A base URL the user gave you for this run ("kjør mot https://…").
2. The `A2_BASE_URL` env var (set per machine/workspace to that tenant's installation).
3. Otherwise: **ask the user** which installation to target. Never guess, never fall back
   to localhost or to any vendor environment.

Echo the resolved base URL back in the confirmation step (workflow step 5) so the user
sees WHERE the drafts will be created before any write happens. Content created in one
installation never references IDs from another — `moduleId`/`sectionId` references in a
package are only valid within the target installation.

### Auth (per installation)

| Installation type | Auth |
|---|---|
| Local dev (`npm run dev`, `AUTH_MODE=mock`) | Mock headers: `x-user-id`, `x-user-email`, `x-user-name`, `x-user-roles: SUBJECT_MATTER_OWNER` (or `ADMINISTRATOR`). Script env vars: `A2_USER_ID`, `A2_USER_EMAIL`, `A2_USER_NAME`, `A2_USER_ROLES`. |
| Any shared installation (a tenant's staging/prod) — **preferred: agent authoring token** | The logged-in SMO/admin issues a short-lived token from **that installation**: `POST /api/admin/content/agent-authoring/tokens` (body `{ "label": "...", "ttlMinutes": 60 }`) → an `aat_...` secret shown once. **End-user flow: the user simply pastes the token (and the installation URL) into the conversation** — use it as `Authorization: Bearer aat_...` for this run and never repeat it in output. CLI flow: env var `A2_AUTH_BEARER`. The token expires within the hour, can be revoked, and is scoped to draft authoring only — the API rejects any publish path, non-draft section create, `replaceExisting`/auto-publish import, and item changes on published courses. If it expires mid-run (401), report partial progress and ask the user for a fresh token; resume from the failed step. |
| Any shared installation — fallback | A full `Authorization: Bearer <Entra JWT>` from a user logged into that installation (same env var). Unscoped — prefer the agent token. |

Tokens are per installation and useless anywhere else — never reuse them across
installations, and never paste them into packages, chat output or files.

## Distribution

This folder is the deployable unit. `npm run skill:package` (in the platform repo) builds
`dist/skills/a2-authoring-api-v<version>.zip` — a zip with the `a2-authoring-api/` folder
at its root, which is the layout ChatGPT (institution-level skill deploy, per-user
install) and claude.ai (capabilities upload) expect. The repo copy remains the source of
truth; re-run the packaging after any skill change and redeploy the zip.
