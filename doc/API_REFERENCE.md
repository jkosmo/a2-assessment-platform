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
| `GET` | `/api/courses/enrollments` | The user's own active enrollments (assigned courses) with `dueAt` + derived `status` (ASSIGNED/IN_PROGRESS/OVERDUE/COMPLETED) (#496/EN-2). |
| `POST` | `/api/courses/:courseId/enroll` | Self-enrol on an **OPEN** course (source=SELF). `204`; `400` if the course is RESTRICTED (#496/EN-2). |

`GET /api/courses` hides **RESTRICTED** courses from users without an active enrollment; OPEN courses are visible to everyone (#496/EN-2).

`GET /api/courses/:courseId` also returns `discussionsEnabled` (course master toggle) and, per `items[]` element, `courseItemId` + `discussionsEnabled` — used by the discussion panel (#495).

---

## Discussions / Q&A (#495)

Threads hang on the course (course-level board, `courseItemId` absent) or on a specific `CourseItem` (per section/module). Mounted under the course path so access reuses "has access to the published course": read/write require published-course access (OPEN to all, RESTRICTED to enrolled/class-assigned); SMO/ADMIN always. Moderation (pin/lock/delete others') requires SMO/ADMIN; accepting an answer requires the asker or a moderator. Writing is blocked when `discussionsEnabled` is off for the course/item or the thread is `LOCKED`. Posts are **soft-deleted** (never hard-deleted). UGC is single-language plain text, returned as server-sanitised `bodyHtml` rendered with a **strict** allowlist (no iframe/raw HTML/images). All write routes use `discussionWriteLimiter` (30/min).

| Method | Route | Role | Description |
|---|---|---|---|
| `GET` | `/api/courses/:courseId/discussions?itemId=` | participant+ | List threads (course-level when `itemId` absent), pinned first then latest activity |
| `POST` | `/api/courses/:courseId/discussions` | participant+ | Create thread (`kind`, `title`, `bodyMarkdown`, optional `courseItemId`) |
| `GET` | `/api/courses/:courseId/discussions/:threadId` | participant+ | Thread + flat reply list |
| `PATCH` | `/api/courses/:courseId/discussions/:threadId` | author / SMO | Edit own (`title`/`bodyMarkdown`); moderate (`pinned`, `lock`); accept answer (`acceptedReplyId`, asker/SMO) |
| `DELETE` | `/api/courses/:courseId/discussions/:threadId` | author / SMO | Soft-delete thread. `204` |
| `POST` | `/api/courses/:courseId/discussions/:threadId/replies` | participant+ | Reply (auto-subscribes the author) |
| `PATCH` | `/api/courses/:courseId/discussions/:threadId/replies/:replyId` | author | Edit own reply |
| `DELETE` | `/api/courses/:courseId/discussions/:threadId/replies/:replyId` | author / SMO | Soft-delete reply. `204` |
| `PUT` | `/api/courses/:courseId/discussions/:threadId/subscription` | participant+ | Subscribe to the thread (idempotent) |
| `DELETE` | `/api/courses/:courseId/discussions/:threadId/subscription` | participant+ | Unsubscribe |

The course master toggle is set via the admin course API: `POST`/`PUT /api/admin/content/courses[/:courseId]` accept `discussionsEnabled` (boolean, default `true`); the admin course detail returns it.

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

#### Module assessment mode (`assessmentMode`) — #525/#578

`POST .../module-versions` accepts an optional `assessmentMode`:

- `FREETEXT_PLUS_MCQ` (default when omitted) — requires `taskText`, `rubricVersionId` and
  `promptTemplateVersionId` (free-text submission graded by the LLM) plus `mcqSetVersionId`.
- `MCQ_ONLY` — no free-text/LLM evaluation. `taskText`, `rubricVersionId` and
  `promptTemplateVersionId` are omitted; only `mcqSetVersionId` is required. Pass/fail is decided
  purely by the MCQ score against a threshold (`assessmentPolicy.passRules.mcqMinPercent`,
  default **70%**).
- `FREETEXT_ONLY` (#578) — free-text submission graded by the LLM, **no MCQ**. Requires `taskText`,
  `rubricVersionId` and `promptTemplateVersionId`; `mcqSetVersionId` is omitted. The rubric/practical
  score spans the full **0–100** (no MCQ band) and there is no MCQ gate. Red-flag / manual-review
  routing applies as for FREETEXT_PLUS_MCQ. The assessment runs on the free-text submission directly
  (no MCQ step). Export/import omit the MCQ set (`activeVersion.mcqSet` is `null`).

**Certification invariant (#476/#525):** a course completion / certificate is issued only when a
participant has **passed all modules** in the course **and read all learning sections**. This is
re-checked both when a module is passed and when a section is marked read.
| `GET` | `/api/admin/content/modules/:moduleId/export` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `DELETE` | `/api/admin/content/modules/:moduleId` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/generate/module-draft` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/generate/mcq` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |

#### Source-material ingest (#454/#479)

The conversational authoring "source" step turns files, URLs and pasted notes into source
material for draft generation. All routes use the `admin_content` capability.

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/admin/content/source-material/extract` | Upload a file (base64 JSON) → async parse job. Per-file cap **10 MB** (#479 Slice A); this route alone accepts a 16 MB JSON body. |
| `GET` | `/api/admin/content/source-material/extract/:jobId` | Poll parse-job status (`pending`/`done`/`failed`). On `done`: `{ extractedText, fileName, format, extractedChars, lowTextDensity }`. **#601 Fase 1:** `lowTextDensity=true` flags an image-heavy / sparse-text upload so the author is warned the module would be thin. |
| `POST` | `/api/admin/content/source-material/fetch-url` | Fetch a single URL (HTML→Readability / `text/plain`) → main text. SSRF-protected; 10/min per user. Body `{ url }`. |
| `POST` | `/api/admin/content/source-material/crawl-url` | **#479 Slice B.** Crawl a start URL: same-hostname only, ≤20 pages, ≤2 hops, honouring `robots.txt`, 300 ms politeness delay. Each page is independently SSRF-revalidated and byte-capped. **3/min per user.** Body `{ url }` → `{ startHostname, pages: [{ url, title, extractedText, fetchedBytes }], pagesCrawled, pagesSkipped, totalBytes, truncated }`. `422 crawl_empty` if nothing could be crawled. |
| `POST` | `/api/admin/content/source-material/condense` | LLM-condense combined source material when it exceeds ~50K chars. |

#### Agent Authoring (#647)

Design: `doc/design/AGENT_AUTHORING_647.md`. Lets an agent dry-run an
`a2-authoring-package/v1` (draft course/module/section plan) before orchestrating the
ordinary create/import endpoints. Publishing is manual and is **not** part of the agent API.

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/admin/content/agent-authoring/validate` | **AA-1 (#649).** Dry-run validation — **no DB writes**. Body `{ package: <a2-authoring-package/v1> }`. Returns `200 { valid, summary: { errors, warnings, objects }, issues: [{ severity: "error"\|"warning", path, code, message }], plan }` — 200 also for invalid packages (the report is the result). `plan` (topological execution order, ops `create_section`/`create_module`/`create_course`/`set_course_items`) is only populated when `errors == 0`. Covers all three `assessmentMode`s (`required_for_mode`/`forbidden_for_mode`), package rules (`duplicate_client_ref`, `unknown_client_ref`, `client_ref_type_mismatch`, `ref_or_id_required`, `ref_and_id_conflict`, `unknown_module_id`/`unknown_section_id`, `unknown_field` — publish/audit fields are rejected) and non-blocking warnings (`possible_duplicate_title`, `course_without_modules`). `400` only when the body isn't `{ package }` with the right `packageFormat`. |

**Agent-friendly create/import responses (AA-2, #650):** the create/import calls the skill
orchestrates accept an optional `clientRef` (pattern `[a-z0-9-]{1,64}`, echoed back in the
201-response, never persisted) and return admin-UI deep links in `links`:

- `POST /modules` and `POST /modules/import` → `links: { conversation: "/admin-content/module/:id/conversation", advanced: "/admin-content/module/:id/advanced" }`
- `POST /courses` and `POST /courses/import` → `links: { course: "/admin-content/courses/:id" }`
- `POST /sections` → `links: { editor: "/admin-content/sections?id=:id" }`. Also accepts
  `draft: true` — the section is created in Utkast (`activeVersionId` stays `null`; content is
  preserved as version 1, published later via `POST /sections/:id/publish`). Default (omitted)
  keeps auto-publish-on-save.

Agent imports must pass `autoPublish: false` (and the authoring contract has no `audit`, so
source-publish auto-publication can never trigger). Retry-safe `Idempotency-Key` support is
tracked separately in #726.

**Agent authoring tokens (AA-3, #651):** short-lived, scoped tokens for direct agent calls.
Issued by a logged-in ADMINISTRATOR/SMO with normal user auth (tokens can NOT mint tokens):

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/admin/content/agent-authoring/tokens` | Body `{ label?, ttlMinutes? (5–60, default 60) }` → `201 { token: "aat_…", id, expiresAt }`. The secret is shown **once**; only its sha256 hash is stored. Issuance is audited. |
| `GET` | `/api/admin/content/agent-authoring/tokens` | Own tokens (id, label, createdAt, expiresAt, revokedAt, lastUsedAt) — never the secret. |
| `POST` | `/api/admin/content/agent-authoring/tokens/:tokenId/revoke` | Owner or ADMINISTRATOR. Immediate; audited. |

Using `Authorization: Bearer aat_…` authenticates as the issuing user (works in both auth
modes; identity/roles from the DB) but the request is **scope-limited** to the five draft
authoring operations (validate, modules/import, sections, courses, courses/:id/items) —
anything else returns `403 agent_token_scope`. Extra hardening on the allowlisted calls:
import requires `mode: "createNew"` + `autoPublish: false`, section create requires
`draft: true`, and items may only be set on unpublished courses. No publish code path is
reachable with a token. Tokens are per installation (multitenant) and expire within the hour.

**Audit trace (AA-5, #653):** the same calls (plus `PUT .../courses/:courseId/items`) accept
an optional `agentRunId` (`[a-zA-Z0-9._-]{1,64}`, one ID per orchestration run). When
`clientRef`/`agentRunId` is present, the write's audit event gets
`source: "agent_authoring"` + `clientRef` + `agentRunId` in its metadata — query audit
events by `agentRunId` to reconstruct exactly what a run created (partial or complete).
Section/course creation and course-items updates are now always audited
(`section_created` with a `draft` flag, `course_created`, `course_items_updated`) for both
human and agent writes; the agent marker is only added for agent-orchestrated calls.

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
| `GET` | `/api/admin/content/courses/:courseId/publish-preview` | Inspect unpublished items before publishing (#734). Returns `{ courseId, allPublished, publishable, unpublishedItems: [{ type, id, title, publishable, blockers: [{code,message}] }] }`. Read-only; the UI calls it to drive the cascade-publish confirm dialog. |
| `POST` | `/api/admin/content/courses/:courseId/publish` | Publish course (#734). Body `{ publishItems?: boolean }`. If the course has unpublished modules/sections: without `publishItems:true` returns `409 course_has_unpublished_items` (with the preview) so the UI can confirm; with `publishItems:true` cascade-publishes the items (items → course) — but returns `422 course_publish_blocked_by_items` (with `details.unpublishedItems`) and publishes nothing if any item is un-publishable (module fails validation / no content, archived item). Enforces I1: a published course never contains unavailable content. Response `{ course, publishedItems }`. |
| `POST` | `/api/admin/content/courses/:courseId/unpublish` | Unpublish course (reversible soft take-down; no G3 lock, #705) |
| `POST` | `/api/admin/content/courses/:courseId/archive` | Archive course. Blocked `400` if a participant is mid-course (G3 — suggests unpublish instead); auto-unpublishes (I3, #705) |
| `POST` | `/api/admin/content/courses/:courseId/restore` | Restore an archived course (lands in Utkast, #705) |
| `GET` | `/api/admin/content/courses/:courseId/cascade-delete-preview` | **ADMINISTRATOR-only** (403 `forbidden` otherwise). Preview a destructive course cascade delete (#762). Returns `{ courseId, courseTitle, deletableModules, deletableSections, sparedModules, sparedSections, blockers, deletable }` — each entry `{ id, title, reason }`. Deletable = exclusive to this course (its only `CourseItem` reference) with no preserved records; spared = shared with another course (only unlinked); blockers = course completions, or an exclusive module with submissions/certifications. Read-only. |
| `POST` | `/api/admin/content/courses/:courseId/cascade-delete` | **ADMINISTRATOR-only** (403 `forbidden` otherwise). Delete a course + the modules/sections it exclusively owns, in one transaction, all-or-nothing (#762). Never destroys preserved records: if any blocker exists returns `400 validation_error` with `details.blockers` and deletes nothing. Otherwise `200 { deletedCourseId, deletedModuleIds, deletedSectionIds, sparedModuleIds, sparedSectionIds }`. FK order (load-bearing): unlink `CourseItem`/`CourseModule` → per exclusive module null `activeVersionId` then delete `ModuleVersion`→`MCQQuestion`→`MCQSetVersion`/`RubricVersion`/`PromptTemplateVersion`→module → per exclusive section null `activeVersionId` then delete `CourseSectionVersion`→section → delete course. Shared content is spared. |
| `GET` | `/api/admin/content/courses/:courseId/enrollments` | List active enrollments for a course, each with the participant + derived status (#496/EN-2) |
| `POST` | `/api/admin/content/courses/:courseId/enrollments` | Assign — body `{ userIds?: string[], department?: string, dueAt?: string\|null }`. Individual list and/or department materialisation. Idempotent per user; audited (#496/EN-2) |
| `DELETE` | `/api/admin/content/courses/:courseId/enrollments/:userId` | Revoke (soft) a participant's enrollment; audited (#496/EN-2) |
| `GET` | `/api/admin/content/classes` | List classes (cohorts) with member + assigned-course counts (#645/CL-2) |
| `POST` | `/api/admin/content/classes` | Create a class — body `{ name, description? }` (#645/CL-2) |
| `DELETE` | `/api/admin/content/classes/:classId` | Archive a class (soft). System classes rejected `400` (#645/CL-2) |
| `GET` | `/api/admin/content/classes/:classId/members` | List class members (#645/CL-2) |
| `POST` | `/api/admin/content/classes/:classId/members` | Add a member — body `{ userId }` (#645/CL-2) |
| `DELETE` | `/api/admin/content/classes/:classId/members/:userId` | Remove a member (#645/CL-2) |
| `GET` | `/api/admin/content/classes/:classId/courses` | List courses assigned to the class (#645/CL-2) |
| `POST` | `/api/admin/content/classes/:classId/courses` | Assign a course — body `{ courseId, dueAt?\|null }` (#645/CL-2) |
| `DELETE` | `/api/admin/content/classes/:classId/courses/:courseId` | Unassign a course (#645/CL-2) |
| `GET` | `/api/admin/content/users/search?q=` | Search users by name/email (min 2 chars, capped 20) for class membership (#645/CL-3) |

Classes (cohorts) assign a course to a group of participants dynamically: a participant is assigned a course if they belong to a class it is assigned to (evaluated at read time, never materialised). The built-in **"Alle deltakere"** system class covers all PARTICIPANT users. `GET /api/courses` and `GET /api/courses/enrollments` reflect class assignments (the latter with `source: "CLASS"`). Entra-linked classes (`kind=ENTRA`) are gated by the `classEntraLinkingEnabled` platform config (default off, CL-5).
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
| `POST` | `/api/admin/content/sections/:sectionId/publish` | Re-point active version to latest (G1 needs content, #705) |
| `POST` | `/api/admin/content/sections/:sectionId/unpublish` | Unpublish. Blocked `400` if the section is used in any course (G2, #705) |
| `POST` | `/api/admin/content/sections/:sectionId/archive` | Archive. Blocked `400` if used in any course (G2); auto-unpublishes (I3, #705) |
| `POST` | `/api/admin/content/sections/:sectionId/restore` | Restore an archived section (lands in Utkast, #705) |
| `DELETE` | `/api/admin/content/sections/:sectionId` | Delete (blocked `400` if the section is used in a course; names the courses, #705) |
| `POST` | `/api/admin/content/sections/preview` | Render markdown → sanitised HTML (same F3/X1 policy as participant view) |
| `POST` | `/api/admin/content/sections/localize` | LLM-translate title + bodyMarkdown to another locale (markdown-preserving). Rate-limited. |
| `POST` | `/api/admin/content/sections/:sectionId/assets` | Upload a section image (multipart `file`). PNG/JPEG/GIF/WebP/SVG, max 5 MB. SVG is sanitised server-side before storage (scripts/handlers/`foreignObject`/`<a>` stripped, #657). Returns `asset` + `ref` (`asset:<id>`). |
| `GET` | `/api/admin/content/sections/:sectionId/assets` | List section assets. |
| `POST` | `/api/admin/content/sections/:sectionId/assets/localize` | Generate translated SVG variants for the section's SVG drawings. Body `{ sourceLocale }`. Extracts `<text>`/`<tspan>` labels, translates to each other supported locale, stores a per-locale variant. Explicit author action (never implicit). Rate-limited (#657). |

The participant/preview serve endpoint `GET /api/content-assets/:assetId` accepts an optional `?locale=` query: when a translated SVG variant exists for that locale it is returned, else the original. SVG responses carry `Content-Security-Policy: …; sandbox` + `X-Content-Type-Options: nosniff` as defence-in-depth for direct navigation (#657).

---

## Admin - Modules

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/admin/modules` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |

---

## Admin - Platform

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/admin/platform` | ADMINISTRATOR — includes `certificateBackground: boolean` (#580) |
| `PUT` | `/api/admin/platform` | ADMINISTRATOR |
| `POST` | `/api/admin/platform/certificate-background` | ADMINISTRATOR — multipart `file` (PNG/JPEG/GIF/WebP, max 15 MB). Sets the platform-wide diploma background (#580). |
| `DELETE` | `/api/admin/platform/certificate-background` | ADMINISTRATOR — clears the diploma background (#580). |

**Certificate background image (#580):** the uploaded image is stored in blob (reusing F4 asset
storage) and referenced from platform key-value config — no new model. It is served
**unauthenticated** at `GET /certificate-background` (a non-sensitive branding image; `404` when
none is set), so the certificate page's CSS background and the admin preview `<img>` can load it
without auth headers. `GET /api/courses/completions/:certificateId` returns
`certificateBackgroundUrl` (`/certificate-background` or `null`).

---

## Admin - Org Sync

| Method | Route | Role(s) |
|---|---|---|
| `POST` | `/api/admin/sync/org` | ADMINISTRATOR |
| `POST` | `/api/admin/sync/org/delta` | ADMINISTRATOR |
| `POST` | `/api/admin/sync/org/entra` | ADMINISTRATOR — import the configured Entra group's members (Graph, managed identity) as platform users so they're searchable before first login. `400` if `ENTRA_USER_SYNC_GROUP_ID` is unset. Runbook: `doc/ops/ENTRA_USER_SYNC_690.md` (#690). |

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
