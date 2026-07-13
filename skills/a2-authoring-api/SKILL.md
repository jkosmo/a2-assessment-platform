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
Preserving approved content: **[references/content-preservation.md](references/content-preservation.md)**.
Validating the fallback export: **[references/export-validation.md](references/export-validation.md)**.
Translating to all three languages: **[references/localization.md](references/localization.md)**.
Designing figures (SVG, "one figure, one point"): **[references/figure-design.md](references/figure-design.md)**.
Deterministic checks live in `scripts/` (`course-state.mjs`, `export-validate.mjs`,
`localization-check.mjs`) — run them; they are repo-unit-tested.

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
5. **One language — never mix.** Establish the course's primary language (`locale`) early and
   write **every** element in it: course, section and module titles, task texts, rubric criteria,
   MCQ questions and options. Do not name sections in one language and modules in another, and do
   not fall back to English for module titles when the source and the rest of the course are in
   Norwegian (a real failure seen in testing). If the source or the conversation mixes languages,
   ask the author which language the course should be in, then produce all content in that one.

## Preserve · Validate · Localize (do-not-regress guarantees)

These three rules hold on **every** run and back specific gates. Depth + deterministic scripts in
the three references above.

6. **Preserve approved content.** Maintain an authoritative **course state + master** — a
   filesystem `workdir/course-state.json` + `course-master.md` where one exists, otherwise a
   single canonical "course master" block **rewritten in full after each approval**. Each element
   is stored in **full text** after each approval; a later "remove redundancy" request drops only
   repeated explanation and **keeps** every unique example, formula, operative step, caveat, task
   and assessment criterion (relocate long detail to an optional attachment, don't delete).
   Reductions >20 % need explicit approval; **any** loss of a mandatory
   example/formula/template/task/assessment-criterion blocks production regardless of %. Gate 6
   must not start without a complete master in final order; run the pre-export **loss audit**
   (preserved / moved / deliberately-removed / **unexpectedly-missing** — the last blocks) and
   re-compare the finished file to the master. Schema-valid-but-incomplete is an error.
   (content-preservation.md; `course-state.mjs`.)
7. **Validate the fallback export against the real import schema.** *A fallback export is not
   validated until the finished file has been read back and checked against the same schema as
   A2's import function.* Generate `exportedAt` (and normalise any date) with
   `Date.toISOString()` — Zod `.datetime()` rejects timezone offsets and microseconds; the same
   applies to every `audit.publishedAt`. The fallback file must be generated complete → written →
   read back → parsed → schema-validated → delivered only on pass; the validated file **is** the
   delivered file. Name the checks in the report (JSON parsing / export-schema / import-schema /
   content-integrity / encoding-integrity / API dry-run / actual import) — **never say "validated"
   generically**. **Write the JSON ASCII-safe:** escape every non-ASCII character as `\uXXXX` so the
   file is pure ASCII and `æ/ø/å` survive download/editor/transfer intact (raw UTF-8 re-encoded as
   Latin-1 becomes `Ã¦/Ã¸/Ã¥` — unreadable in the course). `buildFallbackEnvelope` +
   `roundTripFallbackExport` do this and fail delivery on any mojibake; if you hand-write the file,
   emit `\uXXXX` escapes yourself.
   (export-validation.md; `export-validate.mjs`.)
8. **Localize to all three languages before production.** Fix one primary language for the
   dialogue (principle 5), then after the primary is approved produce **real translations** for
   **nb, nn and en-GB** of every student-facing field the schema localizes — not the primary text
   copied into every locale. Preserve meaning, difficulty, the correct answer, option count+order,
   and all formulas/identifiers/URLs; verify MCQ correct answers map to the same option in every
   locale. **This extends to figure `<text>`:** each text-bearing SVG figure gets localizedVariants
   for the other two locales (translate the labels, geometry unchanged). Block production if a
   mandatory localized field — or a figure variant — is missing. (localization.md;
   `localization-check.mjs`.)

9. **Design figures with the text (Layer B).** Where a section would otherwise be a wall of text,
   propose **one simple figure per discrete visual point** and draw it as **SVG** integrated with
   the element's text, so text + figure are approved as one whole. Principle: **one figure, one
   point** — several simple figures beat one crowded diagram. SVG only (the agent never generates
   raster; raster is author-supplied, never "translated"); a figure **diagrams approved
   text/source and never invents data**; short labels in the one primary language as plain,
   translatable `<text>` (#657). Draw only from the template set (flow / tree-decision /
   boxes-and-arrows / labelled diagram) unless the author explicitly asks free-form. Figures are
   proposed at the **Structure gate** and drafted at the **Per-element gate**; an approved figure
   is **unique content** the preservation audit (#762) must never drop. (figure-design.md.)

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
| 6 | **Produce** | Only with a **complete course master in final order** (rule 6): run the loss audit + localization check, build the JSON, validate, and create the drafts (or emit the round-trip-validated fallback file). (Playbook §6 + api-flow.md; rules 6–8.) |

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
Fallback). No token or network needed. **The fallback file counts as validated only after the
finished file is read back and checked against the same schema as A2's import** (rule 7,
export-validation.md); there is **no import dry-run endpoint**, so report the named checks and do
not claim a live platform verdict.

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
