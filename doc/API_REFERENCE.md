# API Reference

All `/api/*` routes require authentication. In local/test `AUTH_MODE=mock`, use the `x-user-roles` header to set roles. Shared Azure environments must use `AUTH_MODE=entra`, where a valid JWT is required and mock identity headers are ignored.

## Source of truth

Route-group role requirements are defined in `API_ROUTE_CAPABILITIES` in `src/config/capabilities.ts`.
`app.ts` enforces them via `rolesFor(id)`. The per-route-group role columns in this document are derived
from that catalog — if the code and this doc disagree, the code wins.

**Exception:** `/api/calibration` is the only route whose access roles are not in `API_ROUTE_CAPABILITIES`.
They are runtime-configurable via `calibrationWorkspace.accessRoles` in `config/participant-console.json`.
See the calibration section below and the documented exception in `src/config/capabilities.ts`.

Workspace navigation follows the same contract; roles are exposed to the frontend through `/participant/config`.
See [DOMAIN_LIFECYCLE.md](DOMAIN_LIFECYCLE.md) for the full ownership model.

---

## System

| Method | Route | Description |
|---|---|---|
| `GET` | `/healthz` | Health check - returns 200 when the server process is up |
| `GET` | `/version` | Returns the current application version |
| `GET` | `/participant/config` | Public runtime config for workspace navigation, auth mode, debug flags, and workspace tuning |

---

## Participant And Shared User Flows

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/me` | any authenticated |
| `GET` | `/api/modules` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |
| `GET` | `/api/modules/completed?limit=<n>` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |
| `GET` | `/api/modules/:moduleId` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |
| `GET` | `/api/modules/:moduleId/active-version` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |
| `GET` | `/api/modules/:moduleId/mcq/start?submissionId=<id>` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |
| `POST` | `/api/modules/:moduleId/mcq/submit` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |
| `POST` | `/api/submissions` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `GET` | `/api/submissions/history?limit=<n>` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `GET` | `/api/submissions/:submissionId` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `GET` | `/api/submissions/:submissionId/result` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `POST` | `/api/submissions/:submissionId/appeals` | PARTICIPANT, ADMINISTRATOR |
| `GET` | `/api/assessments/:submissionId` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `POST` | `/api/assessments/:submissionId/run` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `GET` | `/api/audit/submissions/:submissionId` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |

---

## Courses (participant)

All routes use the `courses` capability: PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER.

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/courses` | Published courses with progress. `progress.total` counts **all elements** (modules + learning sections); `completed` = passed modules + read sections. |
| `GET` | `/api/courses/completions` | The user's course completions / certificates |
| `GET` | `/api/courses/completions/:certificateId` | A single completion by certificate ID, for the printable certificate view (#550). Owner-scoped — `404` for another user's certificate. Returns `certificateId`, `courseId`, `courseTitle` (localized), `certificationLevel`, `completedAt`, `participantName`, `moduleCount`. |
| `GET` | `/api/courses/:courseId` | Course detail. Returns `modules[]` (legacy) and `items[]` — the ordered mixed module/section sequence; SECTION items carry a `read` flag (#491/#492). |
| `GET` | `/api/courses/:courseId/sections/:sectionId` | Sanitised HTML + title of a learning section in the participant's locale. Validates the section belongs to the published course (#491). |
| `POST` | `/api/courses/:courseId/sections/:sectionId/read` | Mark a section as read (idempotent). `204` on success (#492). |

---

## Manual Review

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/reviews` | ADMINISTRATOR, REVIEWER |
| `GET` | `/api/reviews/:reviewId` | ADMINISTRATOR, REVIEWER |
| `POST` | `/api/reviews/:reviewId/claim` | ADMINISTRATOR, REVIEWER |
| `POST` | `/api/reviews/:reviewId/override` | ADMINISTRATOR, REVIEWER |

---

## Appeals

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/appeals` | ADMINISTRATOR, APPEAL_HANDLER |
| `GET` | `/api/appeals/:appealId` | ADMINISTRATOR, APPEAL_HANDLER |
| `POST` | `/api/appeals/:appealId/claim` | ADMINISTRATOR, APPEAL_HANDLER |
| `POST` | `/api/appeals/:appealId/resolve` | ADMINISTRATOR, APPEAL_HANDLER |

---

## Calibration

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/calibration/workspace?moduleId=<id>&status=<csv>&moduleVersionId=<id>&dateFrom=<ISO>&dateTo=<ISO>&limit=<n>` | Runtime-configurable via `calibrationWorkspace.accessRoles` in `/participant/config` (default SUBJECT_MATTER_OWNER, ADMINISTRATOR) |
| `POST` | `/api/calibration/workspace/publish-thresholds` | SUBJECT_MATTER_OWNER, ADMINISTRATOR |

---

## Reporting

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/reports/completion` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/pass-rates` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/manual-review-queue` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/appeals` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/mcq-quality` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/recertification` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `POST` | `/api/reports/recertification/reminders/run?asOf=<ISO-date>` | ADMINISTRATOR |
| `GET` | `/api/reports/analytics/semantic-model` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/analytics/trends?granularity=<day\|week\|month>` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/analytics/cohorts?cohortBy=<month\|department>` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/analytics/data-quality` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/export?type=<report>&format=csv` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |

---

## Admin Content

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/admin/content/modules` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/modules` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/modules/:moduleId/rubric-versions` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/modules/:moduleId/prompt-template-versions` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/modules/:moduleId/benchmark-example-versions` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/modules/:moduleId/mcq-set-versions` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/modules/:moduleId/module-versions` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/publish` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |

#### Module assessment mode (`assessmentMode`) — #525

`POST .../module-versions` accepts an optional `assessmentMode`:

- `FREETEXT_PLUS_MCQ` (default when omitted) — requires `taskText`, `rubricVersionId` and
  `promptTemplateVersionId` (free-text submission graded by the LLM) plus `mcqSetVersionId`.
- `MCQ_ONLY` — no free-text/LLM evaluation. `taskText`, `rubricVersionId` and
  `promptTemplateVersionId` are omitted; only `mcqSetVersionId` is required. Pass/fail is decided
  purely by the MCQ score against a threshold (`assessmentPolicy.passRules.mcqMinPercent`,
  default **70%**).

**Certification invariant (#476/#525):** a course completion / certificate is issued only when a
participant has **passed all modules** in the course **and read all learning sections**. This is
re-checked both when a module is passed and when a section is marked read.
| `GET` | `/api/admin/content/modules/:moduleId/export` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `DELETE` | `/api/admin/content/modules/:moduleId` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/generate/module-draft` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/generate/mcq` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |

---

## Admin - Courses & Learning Sections

All routes use the `admin_content` capability: ADMINISTRATOR, SUBJECT_MATTER_OWNER. Localized
fields (`title`, `bodyMarkdown`) accept a string or a partial `{en-GB,nb,nn}` object.

### Courses

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/admin/content/courses` | List courses (with module count) |
| `POST` | `/api/admin/content/courses` | Create a course |
| `GET` | `/api/admin/content/courses/:courseId` | Course detail (modules) |
| `PUT` | `/api/admin/content/courses/:courseId` | Update course metadata |
| `PUT` | `/api/admin/content/courses/:courseId/modules` | Set module list (legacy; dual-writes CourseItem) |
| `GET` | `/api/admin/content/courses/:courseId/items` | Read the ordered mixed module/section sequence (#486/B2) |
| `PUT` | `/api/admin/content/courses/:courseId/items` | Set the ordered sequence — body `{ items: [{type:"MODULE",moduleId} \| {type:"SECTION",sectionId}] }`. Re-syncs CourseModule (#486). |
| `POST` | `/api/admin/content/courses/:courseId/publish` | Publish course |
| `POST` | `/api/admin/content/courses/:courseId/archive` | Archive course |
| `POST` | `/api/admin/content/courses/:courseId/localize-copy` | LLM-translate course title/description |
| `GET` | `/api/admin/content/courses/:courseId/export-package` | Export envelope (inlines modules **and** sections in order, #512) |
| `POST` | `/api/admin/content/courses/import` | Import a course envelope (recreates sections via `items`, falls back to modules-only v1) |
| `DELETE` | `/api/admin/content/courses/:courseId` | Delete course |

### Learning sections (#476)

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/admin/content/sections` | Create a section (`title` + `bodyMarkdown`) → section + version 1 |
| `GET` | `/api/admin/content/sections` | List sections |
| `GET` | `/api/admin/content/sections/:sectionId` | Section detail (active version's `bodyMarkdown`) |
| `PATCH` | `/api/admin/content/sections/:sectionId/title` | Update title |
| `PUT` | `/api/admin/content/sections/:sectionId/content` | Publish a new immutable content version (latest-wins) |
| `DELETE` | `/api/admin/content/sections/:sectionId` | Delete (blocked `400` if the section is used in a course) |
| `POST` | `/api/admin/content/sections/preview` | Render markdown → sanitised HTML (same F3/X1 policy as participant view) |
| `POST` | `/api/admin/content/sections/localize` | LLM-translate title + bodyMarkdown to another locale (markdown-preserving). Rate-limited. |

---

## Admin - Modules

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/admin/modules` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |

---

## Admin - Platform

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/admin/platform` | ADMINISTRATOR |
| `PUT` | `/api/admin/platform` | ADMINISTRATOR |

---

## Admin - Org Sync

| Method | Route | Role(s) |
|---|---|---|
| `POST` | `/api/admin/sync/org` | ADMINISTRATOR |
| `POST` | `/api/admin/sync/org/delta` | ADMINISTRATOR |

---

## Workspace UIs

Static workspace pages are served from `public/`.
These URLs are not role-gated by Express itself; access is enforced by the authenticated API calls each page makes, and navigation visibility comes from the canonical capability contract exposed through `/participant/config`.

| URL | Primary capability roles |
|---|---|
| `/participant` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `/participant/completed` | PARTICIPANT, ADMINISTRATOR, REVIEWER |
| `/review` | REVIEWER, APPEAL_HANDLER, ADMINISTRATOR |
| `/calibration` | Runtime-configurable via `calibrationWorkspace.accessRoles` (default SUBJECT_MATTER_OWNER, ADMINISTRATOR) |
| `/admin-content` | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| `/admin-content/courses` (+ `/courses/new`, `/courses/:id`) | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| `/admin-content/sections` | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| `/results` | SUBJECT_MATTER_OWNER, ADMINISTRATOR, REPORT_READER |
| `/profile` | any authenticated |
| `/admin-platform` | ADMINISTRATOR |
