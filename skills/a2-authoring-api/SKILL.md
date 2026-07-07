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

This skill is a **course-authoring conversation**, not just a JSON emitter. The craft —
interviewing the user, designing a pedagogically sound course, and previewing it before
building — is in **[references/authoring-playbook.md](references/authoring-playbook.md)**;
read it. The four phases:

### Phase 1 — Discover
Interview the user for the few things that drive the design: goal, audience, **learning
objectives** ("after this, a learner can ___"), source material to ground the content in,
the assessment intent per objective, scope, language. When the user is vague, propose a
concrete straw-man and let them correct it. (Playbook §1.)

### Phase 2 — Design
Turn objectives into structure: sections *teach*, modules *assess*. Choose the assessment
mode per module deliberately — `MCQ_ONLY` for recall, `FREETEXT_ONLY` for applied
judgment/reasoning, `FREETEXT_PLUS_MCQ` for both. Write **real** content grounded in the
source material: concrete task texts, rubric criteria tied to each objective, MCQs with
plausible distractors — never lorem ipsum. Order so teaching precedes assessment. (Playbook §2.)

### Phase 3 — Preview & approve  (before building anything)
**Render the whole course back to the user in the conversation and get explicit approval
before you build the package, validate, or write anything.** Show the ordered outline plus,
per item, the section content / task text / MCQs / rubric, then ask "ser dette riktig ut,
vil du endre noe før jeg oppretter utkastene?" Iterate here — it is far cheaper than fixing
created drafts. Use the preview template in the playbook (§3).

### Phase 4 — Export
Only after approval:
1. **Build** the `a2-authoring-package/v1`. Contract + per-mode examples:
   [references/package-schema.md](references/package-schema.md); working example:
   [fixtures/example-package.json](fixtures/example-package.json). Record the user's stated
   requirements verbatim in `constraints`.
2. **Validate (dry-run)**: `POST /api/admin/content/agent-authoring/validate` with
   `{ "package": <package> }`, or the script with `--validate-only`. Never writes; 200 with
   `valid: false` is a report. Fix errors (`issues[].path`/`code` are stable); if a fix
   changes what the learner sees, **re-preview** (Phase 3).
3. **Create the drafts** in the plan's order. Call sequence, bodies, auth:
   [references/api-flow.md](references/api-flow.md). In a shell environment prefer the script
   (implements the whole flow):
   `node skills/a2-authoring-api/scripts/import-package.mjs --file pkg.json --base-url <url>`.
4. **Report**: one line per created object with its admin link, plus the run's `agentRunId`,
   and the closing note *"Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI."*

**On partial failure:** stop at the failed step; report per step what happened
(done/failed/skipped), what WAS created (IDs + links), the API error body, and the
`agentRunId`. Never delete anything — cleanup is the human's decision.

**If you can't reach the API at all** (sandboxed conversation with no outbound calls): don't
lose the work — emit an `a2-content-export/v1` **course envelope** to a file and tell the
user to import it via the admin-UI course import. This needs no token and no network from the
agent. See the playbook (§4, Fallback).

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
