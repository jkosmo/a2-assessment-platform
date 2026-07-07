---
name: a2-authoring-api
description: >
  Dialogue-based, source-grounded authoring of draft courses, modules and learning sections on
  the A2 Assessment Platform. The default (normal) track is a stepwise conversation with hard
  approval gates — locate source material (upload or web search), agree on learning objectives,
  agree on the course structure, agree on each element's content, run an external QA against the
  objectives, then produce the JSON and (where reachable) create the drafts via API. Never invents
  content without a traceable source; never publishes. Use when a user asks an agent to build a
  course/module/section on the platform (e.g. "lag et kurs for prosjektledere i agentisk KI").
---

# A2 Agent Authoring — build draft content via a gated authoring dialogue

Repo-canonical skill (EPIC #647). Installed copies (`.claude/skills/…`, ChatGPT/Codex project
files) point here — edit this file, never the copies. Design: `doc/design/AGENT_AUTHORING_647.md`.
Craft depth for each gate: **[references/authoring-playbook.md](references/authoring-playbook.md)**.
Package contract + examples: [references/package-schema.md](references/package-schema.md).
API/fallback mechanics: [references/api-flow.md](references/api-flow.md).

## What you produce

Unpublished **drafts**. A human reviews and publishes in the admin UI. There are no publish
fields in the contract, and you must never call any `.../publish` endpoint — no exceptions.

## Core principles (these override convenience — read first)

1. **Never invent content.** Do not introduce facts, claims, examples, figures, regulations,
   module tasks, rubric criteria or MCQ answers without a **traceable source**. Valid sources
   are: material the author uploaded/pasted, web-search results the author has seen, and the
   author's own explicit input. The author is ultimately responsible for the content; you may
   help them **search the web** for source material, but what you write must trace back to a
   source, not to plausible-sounding guessing.
2. **At a genuine gap, mark it — don't fill it.** When there is nothing to ground a claim on,
   write conservatively and insert `[Avklaring: <what is missing and why it matters>]` rather
   than inventing. Never dress up a guess as fact.
3. **Separate analysis from production.** Do not write course content while objectives or
   structure are still being decided. Content is produced only after its gate is approved.
4. **Generating without a confirmed source is opt-in only.** If the author has no material and
   does not want to supply or web-source any, you may draft from general knowledge **only when
   the author explicitly allows it, after a clear warning** that the content is model-generated
   and unverified — and every such claim is marked `[Avklaring: …]`. This is the `auto` track
   below; it is never the default.

## Two tracks (choose by the user's opening)

**Mode priority:** use `auto` **only** when the user explicitly asks for it (e.g. "auto",
"generér uten dialog", "bare lag et utkast fra det du vet"). Otherwise use `normal`.

| Track | When | Behaviour |
|---|---|---|
| **normal** (default) | Any ordinary request ("lag et kurs …", "spiss mot denne rollen", "kom i gang") | The gated dialogue below. Source-grounded. One approval gate at a time. |
| **auto** (opt-in) | The user explicitly asks to generate without dialogue / without source | Draft from general knowledge, **after warning the author it is unverified**; mark every unsourced claim `[Avklaring: …]`; still never publish. Present the result clearly as a review draft, not a finished course. |

## Normal track — the gates (HARD STOP)

Stop at each gate and wait for the author's approval before the next. **Never merge two gates.
Never skip a gate because a previous answer sounded like general approval — "ja" in one context
is not approval of the next step.** Per-gate craft is in the playbook.

| # | Gate | You stop and ask (in effect) |
|---|------|------------------------------|
| 1 | **Source** | "What should this course be built on? Upload/paste material, or shall I help you search the web?" If nothing is provided: run a web search, **present the sources found, and get the author to confirm which to use** before anything is built on them. (Playbook §1.) |
| 2 | **Learning objectives** | "From the source, I propose these objectives ('after this, a learner can …'). Are they right?" (Playbook §2.) |
| 3 | **Structure** | "Here's the proposed structure — these modules, these sections, this order and assessment modes. Is it right?" Iterate until confirmed. (Playbook §3.) |
| 4 | **Each element** | One item at a time: "Here's the content for Module/Section X (task/rubric/MCQs). Approved?" → next. Never write all elements at once. (Playbook §4.) |
| 5 | **External QA** | An independent check that the course meets the objectives — re-derive the objectives from the source in isolation, verify each is taught **and** assessed, flag gaps/overclaims. **Prefer a separate agent** (fresh context) where the environment allows it; otherwise a deliberate fresh-context pass. (Playbook §5.) |
| 6 | **Produce** | Only now: build the JSON, validate, and create the drafts (or emit the fallback file). (Playbook §6 + api-flow.md.) |

## External QA — a real second opinion

QA must independently re-read the source and objectives and judge whether the course delivers
them; it is not a rubber stamp. **If you can spawn a separate agent** (e.g. Claude Code / an
orchestrated environment), do so and give it only the source + objectives + finished course,
asking it to confirm each objective is taught and assessed and to list gaps/overclaims — the
separate context avoids the author-agent's anchoring bias. In a single-context chat, do the
equivalent as an explicit fresh pass. Report QA findings to the author and resolve them before
producing the JSON.

## Produce & export (mechanics)

After QA passes and the author approves: build the `a2-authoring-package/v1`
([package-schema.md](references/package-schema.md)), record the author's stated requirements and
the sources used in `constraints`, **validate** (`agent-authoring/validate`, dry-run — never
writes), fix any errors, then **create the drafts** in plan order ([api-flow.md](references/api-flow.md)).
Report each created object's admin link and the `agentRunId`, and close with:
*"Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI."*

**On partial failure:** stop at the failed step; report per step (done/failed/skipped), what was
created (IDs + links), the error, and the `agentRunId`. Never delete anything.

**If you cannot reach the API** (sandboxed chat): emit an `a2-content-export/v1` **course
envelope** to a file and tell the author to import it via the admin-UI course import (playbook §6,
Fallback). No token or network needed.

## Security rules (hard)

- **Never call publish endpoints** (`.../publish` on modules, module-versions, sections, courses).
- **Tokens are secrets — but a pasted `aat_` token is an accepted workflow.** The author may paste
  a short-lived agent token (and the installation URL) into the conversation; use it for this run.
  Never echo it back, quote it in summaries, or write it into files, logs or `constraints`. Full
  bearer JWTs and other credentials go in environment variables only.
- **Stop on validation errors** — never push through by dropping fields blindly; show field paths.
- Do not use `mode: "replaceExisting"` unless the author explicitly named an existing module to
  overwrite and gave its ID.

## Environment resolution (multitenant)

The platform is installed **per tenant** — each installation has its own URL and identity
provider. There is **no default or hardcoded environment**. Resolve the target for every run:
(1) a base URL the user gave you this run; (2) the `A2_BASE_URL` env var; (3) otherwise **ask**.
Never fall back to localhost or a vendor environment. Echo the resolved base URL back before any
write. `moduleId`/`sectionId` references are only valid within the target installation.

### Auth (per installation)

| Installation | Auth |
|---|---|
| Local dev (`npm run dev`, `AUTH_MODE=mock`) | Mock headers `x-user-id`/`x-user-email`/`x-user-name`/`x-user-roles: SUBJECT_MATTER_OWNER`. Script env: `A2_USER_ID` etc. |
| Shared installation — **preferred: agent token** | The author issues a short-lived token from that installation (Profil → «Agent-tilgang», or `POST …/agent-authoring/tokens`) → `aat_…`, shown once. **End-user flow: the author pastes it into the conversation.** Script env: `A2_AUTH_BEARER`. Expires within the hour, revocable, draft-scoped. On mid-run 401: report partial progress and ask for a fresh token. |
| Shared installation — fallback | A full `Authorization: Bearer <Entra JWT>` from a logged-in user (same env var). Unscoped — prefer the token. |

Tokens are per installation and useless elsewhere — never reuse across installations, never paste
into packages/output/files.

## Distribution

`npm run skill:package` (in the platform repo) builds `dist/skills/a2-authoring-api-v<version>.zip`
— the `a2-authoring-api/` folder at the zip root, the layout ChatGPT (institution skill deploy /
per-user install) and claude.ai (capabilities upload) expect. The repo copy is the source of
truth; re-run packaging after any skill change and redeploy the zip.
