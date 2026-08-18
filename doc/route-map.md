# Pilot Route and Workspace Map

This map covers all admin-content entry points and their status for pilot. Use it for support, testing, and onboarding.

## Admin content workspaces

| Route | Workspace | HTML file | Status |
|---|---|---|---|
| `/admin-content` | Module library (the «Moduler» tab) | `admin-content-library.html` | **Canonical** |
| `/admin-content/courses` (nav entry) | «Innholdsforvaltning» lander her by default (#705-UX/E) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/module/:moduleId/conversation` | Module — conversational editor | `admin-content.html` | **Canonical** |
| `/admin-content/module/:moduleId/advanced` | **Retired (#896 S3c, v2.19.0)** — 301-redirects to `…/conversation`. The advanced editor is deleted; the workspace tabs replaced it | — | Legacy redirect |
| `/admin-content/courses` | Course list (incl. ADMINISTRATOR-only «Slett kurs og ubrukt innhold» cascade delete, #762) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/courses/new` | New course (conversational flow) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/courses/:courseId` | Course detail (builder: mixed modules + sections) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/sections` | Learning sections library + editor (#476) | `admin-content-sections.html` | **Canonical** |
| `/admin-content/sections?id=<id>` or `?new` | Section editor (open existing / new) | `admin-content-sections.html` | **Canonical** |
| `/admin-content/classes` | **Moved (#765)** — 301-redirects to `/deltakere/klasser` (now under the «Deltakere» area) | — | Legacy redirect |
| `/admin-content/calibration` | «Vurderingskvalitet» workspace (rebranded from Calibration, #836) | `admin-content-calibration.html` | **Canonical** |

### Legacy routes (present during pilot, not primary)

| Route | Notes |
|---|---|
| `/admin-content?moduleId=...` | Opens conversational editor. Retained for deep links from notifications. Canonical form is `/admin-content/module/:moduleId/conversation`. |
| `/admin-content/advanced` | **Retired (#896 S3c, v2.19.0)** — 301-redirects to `/admin-content` (the module library). It never had a module context to carry. |

### One authoring surface (#896 S3c, v2.19.0)

There is no longer a "mode relationship" to describe. The conversational and advanced editors used
to be two modes of the same workspace; **Avansert is deleted**, and everything it did lives in the
tabs: **Rediger** (content), **Innstillinger** (setup), **Forhåndsvisning** (the participant's view).
Both `/advanced` routes survive only as permanent redirects, because they sit in bookmarks.

The active tab is reflected in the URL as `?tab=preview` / `?tab=settings` — Rediger is the default
and stays out of the query, so the plain route is canonical. `replaceState` is used, so browser Back
still means previous page rather than previous tab.

**#926 (v2.19.1):** a generated result no longer overwrites unsaved field edits. When the edit form
holds typing, the conversation parks the result as a **proposal** with «Bruk»/«Forkast» instead of
writing it into the draft, and a tab that receives content while the author is looking elsewhere is
marked. See `doc/FEATURE_SURFACE_MAP.md` § 22.

**#896 S4 — publish gate.** Publishing from **Rediger** blocks when a participant-facing field is
missing one of the three locales, and the block carries an action («Oversett det som mangler») that
fills only the gaps. Same gate on the course cascade (`/admin-content/courses`) and on import
auto-publish. No new route; the behaviour is on
`POST .../module-versions/:id/publish`. See `doc/API_REFERENCE.md` → "Publish translation gate".

**#896 S5 — version history.** **Innstillinger** lists the module's saved versions with a
«Gjenopprett» action on each one that is not currently loaded. Restoring copies that version
forward as a new **draft** — history is append-only — and the workspace switches to **Rediger** so
the author sees the restored content. New route:
`POST /api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/restore`.

**#896 S6 — export/import.** Both live on **Rediger**, in the module-actions menu. Export
downloads the `a2-content-export/v1` envelope from `GET .../export-package`. Import takes a package
**into the module you are in**, as a new unpublished version — creating a new module is the module
list's job, and publishing stays an explicit act.

**#916 — a section can now travel on its own.** `/admin-content/sections` gains two deliberately
thin actions: **Eksporter** per row (owner/admin only — the button is hidden where `canManage` is
false, and the route enforces it regardless) and **Importer seksjons-pakke** in the page header.
No new page and no route change; both call the new
`GET|POST /api/admin/content/sections/:id/export-package | /sections/import`. Kept minimal on
purpose — #925 will rebuild this page, and the weight of the feature is in the API and the service
layer, which survive that. An imported section always lands as **Utkast**, and publishing it runs
the same translation gate as a module (see `doc/FEATURE_SURFACE_MAP.md` § 23).

## Participant, «Deltakere» and review workspaces

The **«Deltakere»** top-nav area (#765) groups the participant-/outcome-oriented surfaces —
`/deltakere/klasser`, `/deltakere/status`, `/review`, `/results` — behind one menu item, with a shared,
role-gated sub-navigation bar (`public/static/deltakere-subnav.js`). `/review` and `/results` keep their
URLs; only Klasser moved (from `/admin-content/classes`).

| Route | Workspace |
|---|---|
| `/participant` | «Mine kurs» → **Pågående**-fane: deltakerens kurs + innleveringsflyt (#767) |
| `/participant/completed` | «Mine kurs» → **Fullførte**-fane: kursbevis + fullførte moduler (#767) |
| `/certificate?id=<certificateId>` | Printable course certificate view (#550) |
| `/deltakere/klasser` | Classes (cohorts) admin — list, create, members, course assignment (#645/CL-3; moved here in #765) |
| `/deltakere/status` | Teacher/SMO cohort-status dashboard — enrollment status counts per course (#498) |
| `/review` | Manual review queue and workspace (a «Deltakere» sub-tab) |
| `/calibration` | **Retired (#836)** — 301-redirects to `/admin-content/calibration` |
| `/results` | Results / history view (a «Deltakere» sub-tab) |
| `/profile` | User profile |
| `/admin-platform` | Platform administration |

## API base paths

| Prefix | Auth | Purpose |
|---|---|---|
| `/api/submissions` | Participant | Submit work, view results, file appeals |
| `/api/assessments` | Participant | Trigger assessment, poll job status |
| `/api/modules` | Participant | Browse available modules, run MCQ |
| `/api/courses` | Participant | Browse courses; read learning sections + mark read (#476); discussion/Q&A threads + replies (#495) |
| `/api/me` | All | Current user identity and roles |
| `/api/reviews` | Reviewer / Admin | Manual review queue and override |
| `/api/cohort-status` | SMO / Admin / Report reader | Cohort enrollment-status aggregate per course (#498) |
| `/api/appeals` | Appeal Handler / Admin | Appeal queue and resolution |
| `/api/admin/content` | SMO / Admin | Module, course, and learning-section content management |
| `/api/admin/content-owners` | SMO / Admin (+ per-object owner check) | Manage the owner set of a content object — `GET/POST/DELETE /:contentType/:contentId[/:userId]` (#787) |
| `/api/admin/platform` | Admin | Platform administration |
| `/participant/config` | Public (rate-limited) | Participant console bootstrap config |
| `/healthz` | Public | Health check (no version info) |

### Agent Authoring (EPIC #647) — under `/api/admin/content`

Draft-only content authoring by AI agents. Full details: `doc/API_REFERENCE.md`,
`doc/AGENT_ACCESS_GUIDE.md` (SMO/user flow), `doc/design/AGENT_AUTHORING_647.md`.

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/admin/content/agent-authoring/validate` | SMO / Admin (or agent token) | Dry-run an `a2-authoring-package/v1` — no DB writes; returns report + execution plan (AA-1) |
| `POST /api/admin/content/agent-authoring/tokens` | SMO / Admin (user auth only) | Issue a short-lived `aat_` agent token; secret shown once (AA-3) |
| `GET /api/admin/content/agent-authoring/tokens` | SMO / Admin | List own tokens (never the secret) |
| `POST /api/admin/content/agent-authoring/tokens/:id/revoke` | SMO / Admin (owner or Admin) | Revoke a token immediately |

Agent tokens (`Authorization: Bearer aat_…`) are scope-limited to the five draft-authoring
operations (validate + `modules/import`, `sections`, `courses`, `courses/:id/items`) — every
other route returns `403 agent_token_scope`.

**User surface:** the **«Agent-tilgang»** section on `/profile` (issue/copy-once/list/revoke)
is role-gated to SUBJECT_MATTER_OWNER / ADMINISTRATOR (#731). No new page/route — it is a
section on the existing profile page.
