# Pilot Route and Workspace Map

This map covers all admin-content entry points and their status for pilot. Use it for support, testing, and onboarding.

## Admin content workspaces

| Route | Workspace | HTML file | Status |
|---|---|---|---|
| `/admin-content` | Module library (the «Moduler» tab) | `admin-content-library.html` | **Canonical** |
| `/admin-content/courses` (nav entry) | «Innholdsforvaltning» lander her by default (#705-UX/E) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/module/:moduleId/conversation` | Module — conversational editor | `admin-content.html` | **Canonical** |
| `/admin-content/module/:moduleId/advanced` | Module — advanced editor | `admin-content-advanced.html` | **Canonical** |
| `/admin-content/courses` | Course list (incl. ADMINISTRATOR-only «Slett kurs og ubrukt innhold» cascade delete, #762) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/courses/new` | New course (conversational flow) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/courses/:courseId` | Course detail (builder: mixed modules + sections) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/sections` | Learning sections library + editor (#476) | `admin-content-sections.html` | **Canonical** |
| `/admin-content/sections?id=<id>` or `?new` | Section editor (open existing / new) | `admin-content-sections.html` | **Canonical** |
| `/admin-content/classes` | Classes (cohorts) admin — list, create, members, course assignment (#645/CL-3) | `admin-content-classes.html` | **Canonical** |
| `/admin-content/calibration` | Calibration workspace | `admin-content-calibration.html` | **Canonical** |

### Legacy routes (present during pilot, not primary)

| Route | Notes |
|---|---|
| `/admin-content?moduleId=...` | Opens conversational editor. Retained for deep links from notifications. Canonical form is `/admin-content/module/:moduleId/conversation`. |
| `/admin-content/advanced` | Opens advanced editor without a module context — no module is pre-loaded. Canonical form is `/admin-content/module/:moduleId/advanced`. Removal planned post-pilot (V2-05). |

### Mode relationship

The conversational and advanced editors are two modes of the same module workspace, not independent surfaces. Switching between them via the mode rail preserves working draft state. `/admin-content/advanced` as a standalone top-level route has no module context and is a legacy artifact.

## Participant and review workspaces

| Route | Workspace |
|---|---|
| `/participant` | Participant submission workspace |
| `/participant/completed` | Completed assessment result view (incl. course certificates list) |
| `/certificate?id=<certificateId>` | Printable course certificate view (#550) |
| `/review` | Manual review queue and workspace |
| `/calibration` | Calibration reviewer workspace |
| `/results` | Results / history view |
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
| `/api/appeals` | Appeal Handler / Admin | Appeal queue and resolution |
| `/api/admin/content` | SMO / Admin | Module, course, and learning-section content management |
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
