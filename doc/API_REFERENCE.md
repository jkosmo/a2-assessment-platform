# API Reference

All `/api/*` routes require authentication. In local/test `AUTH_MODE=mock`, use the `x-user-roles` header to set roles. Shared Azure environments must use `AUTH_MODE=entra`, where a valid JWT is required and mock identity headers are ignored.

**Stage only — the stage test account (2.105.0, 2.154.1).** An app-only token is accepted only when `DEPLOY_ENVIRONMENT` is exactly `staging` and the token's app is `STAGE_TEST_SERVICE_APP_ID` (`src/auth/stageTestService.ts`); neither is set in prod. Without further headers it is a subject-matter owner. With `x-stage-test-role: PARTICIPANT` it is a separate user (`stage-test-service-participant:<appId>`, `stage-testkonto-deltaker@stage.invalid`) with only the `PARTICIPANT` role; any other value of the header gives `401`. The header is read for nothing else: user tokens and agent tokens (`aat_…`) ignore it.

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
| `GET` | `/api/me/stats` | any authenticated, **always the caller** (2.141.0, #1138). Takes no user id in path, query or body; no role reaches another person's numbers. «Min statistikk» on `/profile`: `mood` (`ny` \| `mett` \| `sulten` \| `sur` \| `dramatisk`, by calendar weeks since last activity, Europe/Oslo), `lastActivityAt`, `weeks` (12 × `{ from, to, partial, sectionsRead, modulesPassed, coursesCompleted, readingMinutes }`, Monday–Sunday Oslo, oldest first, empty weeks included), `recent` (sum of the last 4 weeks), `totals` (`coursesCompleted` = certificates, `modulesPassed` = distinct modules, `sectionsRead` = distinct sections), `passedModules` (`moduleId`, `moduleTitle` localised, `passedAt`, `totalScore` of the latest passed attempt per module). Events come from the same loader as the activity report (`loadActivitySources`); a module is passed when the submission is settled and its latest decision passed. Reading time = words in the section version current at the read, in the caller's language, / 200 per minute, once per section per week |
| `GET` | `/api/me/data` | any authenticated. What is stored about the caller. Since 2.134.0 also `profile.modulePasses`: `moduleId`, `moduleVersionId`, `submissionId`, `passedAt`, `invalidatedAt` |
| `GET` | `/api/modules` | PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER |
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

> **#934 (2.133.0):** `POST /api/submissions` requires `moduleVersionId`: the `activeVersion.id` of the module the page
> showed (from `GET /api/modules` or `GET /api/modules/:moduleId`). No longer the active version: `409
> module_version_changed`. Missing: `409 client_outdated` (a tab from before the rollout; reload). Nothing is written in
> either case. The answer is parsed first; the version is read and compared under the content lock (shared) and the
> learner lock. `503 content_busy`: a lock could not be had within 3 seconds, nothing is written, and the same call can be
> repeated. A module without a published active version still answers `409 module_version_unavailable`, before the other
> checks.

> **#1140 stage 1 (2.154.0):** the module version a participant gets is decided in one place
> (`participantModuleVersion.ts`). `GET /api/modules`, `GET /api/modules/:moduleId` and
> `GET /api/modules/:moduleId/active-version` accept `?courseId=<id>`, and `POST /api/submissions` accepts `courseId`: the
> course the module was opened from. When the caller has access to that course and it contains the module, the course
> decides which major version is shown. Omitted, unknown, no access, or the module is not in it: the fallback applies (the
> highest major version among the courses the caller has the module in; without any course, the module's newest). On the
> `GET` routes a `courseId` that is empty or longer than 64 characters counts as omitted; `POST /api/submissions` answers
> `400 validation_error` for it. In the
> participant-facing answers `activeVersion` therefore means "the version you get", and that id is what `moduleVersionId`
> must carry. A course shows the module's newest version until it has pinned a major version; nothing pins one yet, so
> every answer is the same as before. Author-facing reads (`?adminFacing=true`) always get the module's newest.

> **#475 (v2.8.0):** `POST /api/submissions` accepts an optional `processSignals` object —
> `{ declaration?: "none"|"ideas"|"improve"|"autonomous", declarationText?: string, insistedAfterPrompt?: boolean }`
> — the participant's AI-use declaration. Stored on `Submission.processSignalsJson` (aggregate-only; no
> keystroke/paste telemetry). Only routes to review (never fails), and only when `aiInfluence` is enabled
> + live for the module. `GET /participant/config` returns `aiInfluence: { enabled, shadowMode }` that
> gates the client declaration UI (dormant by default).

---

## Courses (participant)

All routes use the `courses` capability: PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR, APPEAL_HANDLER, REPORT_READER, REVIEWER.

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/courses` | Published courses with progress. `progress.total` counts **all elements** (modules + learning sections); `completed` = passed modules + read sections. 2.102.0: each course has `themes: [{ id, name }]`, and the response has `themes` — every theme the participant has a course in, alphabetical in the participant's language. |
| `GET` | `/api/courses/completions` | **#934 (2.133.0):** the backlog sweep issues under the locks, one short transaction per course, and only for a course that looks like it lacks a certificate. If someone holds the content lock, the sweep stops for this request: the answer is still `200` with what exists, and the certificate comes next time. The user's course completions / certificates. **#934 (2.128.0):** a certificate applies to its major version, so a course can have one per major version. Each item carries `versionMajor`, `versionMinor` and `current` (`true` when the certificate is for the course's current major version). Only a `current` certificate makes the course completed; an older one is shown as «Certificate, version N». |
| `GET` | `/api/courses/completions/:certificateId` | A single completion by certificate ID, for the printable certificate view (#550). Owner-scoped — `404` for another user's certificate. Returns `certificateId`, `courseId`, `courseTitle` (localized), `certificationLevel`, `completedAt`, `participantName`, `moduleCount`, and (#934, 2.128.0) `versionMajor`, `versionMinor`, `current`. The certificate view shows the version from major version 2. |
| `GET` | `/api/courses/:courseId` | Course detail. Returns `modules[]` (legacy) and `items[]` — the ordered mixed module/section sequence; SECTION items carry a `read` flag (#491/#492). **#958:** SECTION items the participant cannot open (archived, or no active version) are **omitted entirely** — `available` is therefore always `true` on sections. MODULE items are all present, each carrying **two** independent flags. **#996: `available` and `required` are not the same question, and conflating them is a dead end.** `available:false` means the participant cannot open it right now. `required:false` means the certificate gate does not ask for it. An **unpublished** module is `available:false, required:true` — temporarily down, still counted. An **archived** module is `available:false, required:false` — taken out of circulation. A client that infers the second from the first will offer "Finish course" on a course the server will not certify: the click records the read and nothing happens. See `doc/DECISIONS.md` and `FEATURE_SURFACE_MAP` §25. |
| `GET` | `/api/courses/:courseId/sections/:sectionId` | **#934 (2.133.0):** also `sectionVersionId`, the version the text came from; send it back with `POST …/read`. Sanitised HTML + title of a learning section in the participant's locale. Validates the section belongs to the published course (#491). |
| `POST` | `/api/courses/:courseId/sections/:sectionId/read` | Mark a section as read (idempotent). `204` on success (#492). **#934 (2.133.0):** body `{ sectionVersionId }`, the `sectionVersionId` the `GET` above returned. No longer the active version: `409 section_version_changed`. Missing, empty or `null`: `409 client_outdated`. Any other type: `400 validation_error`. Nothing is written in any of these cases. Membership and version are checked under the content lock (shared) and the learner lock, so a section taken out of the course while the call waited gives `404`. `503 content_busy`: a lock could not be had within 3 seconds, nothing is written, and the same call can be repeated. |
| `GET` | `/api/courses/enrollments` | The user's own active enrollments (assigned courses) with `dueAt` + derived `status` (ASSIGNED/IN_PROGRESS/OVERDUE/COMPLETED) (#496/EN-2). |
| `POST` | `/api/courses/:courseId/enroll` | Self-enrol on an **OPEN** course (source=SELF). `204`; `400` if the course is RESTRICTED (#496/EN-2). |

`GET /api/courses` hides **RESTRICTED** courses from users without an active enrollment; OPEN courses are visible to everyone (#496/EN-2).

`GET /api/courses` returns the courses in the order the participant sees them (#1093): courses with a `sortOrder` first, ascending, then the rest alphabetically by the title in the request locale (`Intl.Collator`, numeric, case-insensitive). Each item carries `sortOrder` (integer or `null`). The client only partitions into ongoing and completed; it never re-sorts.

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

**Updating a course from its own export (#1095):** a course export now carries `course.course.origin` (`courseId`, `exportedAt`) and `origin` on every item (`sectionId` or `moduleId`, plus `versionNo` = the number of the version the file carries, which is the newest one — also an unpublished draft — for sections and modules alike; a course export therefore carries drafts, and a `createNew` import of such a file lands the module unpublished and holds the course back as a draft, reported as `heldBackByTranslationGate: true`). `POST /api/admin/content/courses/import` with `mode: "updateExisting"` and `targetId` lays a new **unpublished** version on every item the file recognises, creates items without `origin` as drafts (a new section is placed in the course; a new module is placed only when the course is unpublished — in a published course it stays in the module library and is listed in `summary.unplacedModuleIds`), takes items the file does not list out of the course (not deleted), reorders to the file, and updates the course's own fields. Nothing is published; the course keeps its id, publish state, class assignments and participant progress. Rejected before anything is written: a file exported from another course, or naming an item the course does not have (`400 { error: "origin_mismatch" }`); an item that has a newer version than the file's `origin.versionNo` (`400 { error: "origin_stale", details: { type, id, exportedVersionNo, currentVersionNo } }` ); the caller not owning the course (`403`, checked on `targetId`); `import_target_required` without `targetId`. An item the caller does not own (#903) is **replaced** (2.88.1, product decision 2026-10-12): a new section/module owned by the caller takes its place, with v1 = a published copy of the live version (participants see no change) and v2 = the file's content, unpublished; the old item is taken out of the course and archived when no other course uses it; section reads are copied to the new section, assessments stay on the old module. Listed in `summary.replacedUnownedIds: [{ type, oldId, newId, oldArchived }]`. Only items the file actually changed are replaced; an unowned item the file left unchanged, or whose live version does not pass today's publish gate, stays as it is and is listed in `summary.keptUnownedIds: [{ type, id, reason: "unchanged" | "not_publishable" }]`. The stale check runs before the ownership check, so an unowned item edited after the export also rejects the file. Administrators bypass ownership. The `201` response adds `summary: { updatedSections, updatedModules, createdSections, createdModules, removedSections, removedModules, unplacedModuleIds, replacedUnownedIds, keptUnownedIds, unchangedIds }`. An item the caller owns that the file did not change (body and assets; module version) gets no new version and is listed in `unchangedIds`. Audit: `course_imported` on the course plus `section_imported` / `module_imported` per item with `mode: "updateExisting"`. **#934 (2.129.0):** on a course that has been published, an update raises the **minor** version once — when the order or the items change, or the title or description changes. It never adds required content to a published course (new modules stay drafts outside it, new versions are laid ready and get the minor/major question in `publish-pending`), so it does not ask. `replaceExisting` on a course where someone holds a certificate for the current major version requires `version: "minor" | "major"` (product owner 2026-11-02) — without it **`400 course_version_required`** (`details.certificateHolders`) and nothing is written; without certificate holders it behaves as before (minor). A file that omits the description leaves it, and is no change. **#934 (2.132.0):** `replaceExisting` with `version: "major"` takes `confirmEmailRecipients` — over 200 recipients (`majorEmailRecipients` in the course detail) the import is otherwise rejected with **`409 major_email_confirm_required`** and nothing is written.

The same endpoints accept `sortOrder` (#1093): an integer 0–9999 places the course first in «Mine kurs», `null` clears it (alphabetical, the default); omitting the field leaves the stored value. The admin course detail returns `sortOrder`, and the course export/import envelope carries it as an optional field (`course.course.sortOrder`), so files from before 2.87.0 import unchanged.

> **#923 (v2.20.0) — item-level discussion has no UI any more, but the API is unchanged.** The
> participant section reader no longer mounts a board, and the SMO course editor no longer shows the
> per-item «Diskusjon» checkbox; the course-level board is the only entry point. The routes above
> still accept `itemId`/`courseItemId`, still enforce `CourseItem.discussionsEnabled`, and existing
> item-level threads are **untouched in the database** (no migration) — the product owner wants to
> verify the row count in production before anything is decided about them. See
> `doc/FEATURE_SURFACE_MAP.md` § 16 for the full surface list and the pre-deploy checklist.

---

## Manual Review

| Method | Route | Role(s) |
|---|---|---|
| `GET` | `/api/reviews` | ADMINISTRATOR, REVIEWER |
| `GET` | `/api/reviews/:reviewId` | ADMINISTRATOR, REVIEWER |
| `POST` | `/api/reviews/:reviewId/claim` | ADMINISTRATOR, REVIEWER |
| `POST` | `/api/reviews/:reviewId/override` | ADMINISTRATOR, REVIEWER |

### `submission.module` i køsvaret (#1027)

Gjelder både `/api/reviews` og `/api/appeals`.

- `title` — **ferdig lokalisert streng** på leserens språk (`x-locale`), ikke lagringsformatet.
  Klienten skal vise den som den er, ikke tolke den.
- `titleSearch` — **alle språkvariantene** av tittelen, som en liste.

⚠️ `titleSearch` finnes fordi køsøket før gikk over den rå JSON-strengen og derfor traff på tvers
av alle språk. Det var utilsiktet, men nyttig: en behandler fant saken uansett hvilket språk
tittelen ble skrevet på. Da #1022 begynte å lokalisere `title`, ble søket smalere uten at noen la
merke til det.

Et klientsidefilter som søker i køen **skal ta med `titleSearch`**, ellers blir søket smalere enn
det var før serveren lokaliserte.

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
| `GET` | `/api/reports/analytics/semantic-model` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/analytics/trends?granularity=<day\|week\|month>` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/analytics/cohorts?cohortBy=<month\|department>` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/analytics/data-quality` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/reports/export?type=<report>&format=csv` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |

`completion` and `pass-rates` count **people, not attempts** (2.95.0): each participant once per module,
by their latest submission. `totalSubmissions`, `completedSubmissions`, `underReviewSubmissions`,
`passCount`, `failCount` and `decisionCount` are people; `completion` rows and totals also carry
`attempts` (every submission, including retaken ones). `status` filters apply to the latest
submission.

## Cohort status (#498)

Teacher/SMO dashboard: enrollment status counts over a course's effective audience (individual
enrolments + class-assigned members), evaluated at read time.

| Method | Route | Roles |
|---|---|---|
| `GET` | `/api/cohort-status/courses` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |
| `GET` | `/api/cohort-status/course/:courseId` | ADMINISTRATOR, REPORT_READER, SUBJECT_MATTER_OWNER |

`GET /course/:courseId` returns `{ courseId, total, counts, byClass, generatedAt, coursePublished,
courseArchived }`.

### Activity (#1099)

Activity across all courses: reads, submitted attempts, passed modules (settled submission whose
latest decision passed, the same rule as the other reports) and completed courses. Participants are
users who have done something (read, submitted, completed) and have not left or been anonymised (product owner 2026-10-17). Nobody appears as «not started». Days and weeks are Europe/Oslo
calendar dates.

| Method | Route | Roles |
|---|---|---|
| `GET` | `/api/reports/activity?period=4\|12\|all&grain=day\|week&department=…` | ADMINISTRATOR (report readers get 403 from 2.128.0) |
| `GET` | `/api/reports/activity/users/:userId/recent` | ADMINISTRATOR (report readers get 403 from 2.128.0) |

`GET /activity` returns `{ generatedAt, period, grain, department, range, departments, population,
kpis, buckets, people }`. `/recent` returns the latest events with titles in the reader's locale, and
404 for anyone who is not among the report's participants.

**#967 — reminders and this dashboard treat an unreachable course in opposite ways, deliberately.**
The reminder schedule **suppresses** due-date mail for a course that is unpublished or archived (the
participant cannot open it, so the mail asks for something they cannot do) and counts each suppression
as `skippedCourseUnavailable`. This dashboard does the opposite: it never filters the audience — that
would empty the screen for a teacher who explicitly asked about *this* course — and reports
`coursePublished` / `courseArchived` instead. The course list includes unreachable courses for the
same reason, flagged rather than hidden.

The distinction is who is asking: a reminder is an action aimed at a participant who cannot act on it;
a dashboard is a question from a teacher who deserves an honest answer.

### #989 — recertification removed

`POST /api/reports/recertification/reminders/run` is **gone** (404). Modules no longer expire, so
there is nothing to remind anyone to renew. Course due-date reminders are a separate mechanism and
are unaffected (`CourseReminderMonitor`).

`GET /api/reports/recertification` **remains** — the URL keeps its historical name, but the response
now reports stored certification state instead of a derived expiry state:

| | Before | After |
|---|---|---|
| `reportType` | `recertification-status` | `certification-status` |
| `rows[].status` | `ACTIVE` \| `DUE_SOON` \| `DUE` \| `EXPIRED` \| `NOT_CERTIFIED` | `ACTIVE` \| `NOT_CERTIFIED` |
| `rows[]` expiry fields | `expiryDate`, `recertificationDueDate`, `daysUntilDue`, `daysUntilExpiry` | removed |
| `totals` | one count per lifecycle value | `certificationCount`, `ACTIVE`, `NOT_CERTIFIED` |

Historical rows still holding `DUE_SOON`/`DUE`/`EXPIRED` are reported as `ACTIVE` — they counted as
passed before and still do. `?status=` filtering accepts the two remaining values. The CSV export
token is unchanged (`/api/reports/export?type=recertification`).

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
| `POST` | `/api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/restore` | ADMINISTRATOR, or an **owner of this module** |
| `GET` | `/api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/publish-preview-versioned` | ADMINISTRATOR, or an **owner of this module** (#934, 2.135.0) |
| `POST` | `/api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/publish-versioned` | ADMINISTRATOR, or an **owner of this module** (#934, 2.135.0) |

#### Publish with an answer per course (#934 slice 5a-3, 2.135.0)

The rule has been on in production since 2026-11-06. Since 2026-11-08 the code no longer reads the switch, and `409 module_versioning_not_active` is never returned (it was the answer while the switch was off). An old server answers 404. Not reachable with an agent token. See `doc/DESIGN_934.md`, «5a-3» and «Den gamle regelen fjernet».

`GET …/publish-preview-versioned` → **200** `{ moduleId, moduleVersion: { id, versionNo, versionMajor, versionMinor }, currentMajor, anyonePassed, courses: [{ courseId, title, published, archived, versionMajor, versionMinor, certificateHolders, majorEmailRecipients, canChooseVersion }] }`. `canChooseVersion` (2.137.0) says whether the sender may choose a major version for that course: its owners or an administrator. `anyonePassed` says whether anyone holds a valid pass on the module; the dialog does not ask when no one does. `courses` are the courses that hold the module and have been out, also unpublished and archived ones. The numbers come from the functions the publish uses. `404 module_version_not_found`.

`POST …/publish-versioned` body (strict; an unknown field is `400 validation_error`):

```json
{ "moduleVersion": "major", "courseVersions": { "<courseId>": "major" }, "expectedCourseIds": ["<courseId>"], "confirmEmailRecipients": { "<courseId>": 250 } }
```

- `moduleVersion: "minor"`: a minor version in every course, no question. `courseVersions` naming `"major"` is `400 validation_error`. Publishing the version that is already active sets nothing live and changes no course version.
- `moduleVersion: "major"`: `expectedCourseIds` is required. An answer is required for every course with certificate holders that the sender may choose for: **`400 course_version_required`**, `details.courses: [{ courseId, certificateHolders }]`. A course's owners or an administrator may choose (2.137.0). Any other course gets a minor version without an answer, and `"major"` for it is **`403 course_version_not_owner`**, `details.courses: [{ courseId }]`, with nothing written. A course gets a major version only when the answer is major and someone holds a certificate; only then is the requirement raised in that course. Otherwise it gets a minor version and the requirement stands.
- **`409 affected_courses_changed`** (`details.currentCourseIds`): the set differs from `expectedCourseIds`, or an answer names a course that is not affected.
- `confirmEmailRecipients` is per course, 200 rule as in `PUT …/items`: `409 major_email_confirm_required`.
- `409 module_version_number_fixed` and `409 module_version_outdated`, `422 publish_blocked_by_validation`, as on `…/publish`.
- Response `{ moduleVersion, courses: [{ courseId, version: { kind, from, to, raisedModuleIds? } | null }], validationWarnings }`.

All of it runs in one transaction under the exclusive content lock; a rejection writes nothing. `POST …/publish` with `supersedesEarlierPasses: true` is **`409 client_outdated`** and nothing is written; `false` or omitted is a minor version in every course, as before. (Until 2026-11-08 the old #997 path, which set `SUPERSEDED` and e-mailed everyone who had passed, ran when the switch was off. It is removed.)

**The page (2.136.0)** reads the preview first: `200` gives the dialog with a choice per course; `409 module_versioning_not_active` or `404` gives the old dialog and `POST …/publish`. A version that has a number, or a module never published (`currentMajor: null`), gets no question and is sent as `moduleVersion: "minor"`.

**«Used in courses» (#1149).** `GET /api/admin/content/modules/library`: `courses: [{ id, title }]` and `courseCount` are the **active** courses that contain the module; an archived course is not listed or counted. `POST …/modules/:moduleId/unpublish` and `…/archive` are blocked (`400 content_in_use`) only by active courses. #1150: `…/archive` is also blocked by a saved draft (#1140) of an active course whose item list includes the module (`400 content_in_course_draft`); `…/unpublish` is not.

**Version numbers (2.136.0), additive; `versionNo` stands as before.** `GET /api/admin/content/modules/library`: `activeVersionMajor`, `activeVersionMinor` (`null` without an active version). `GET /api/modules` and `GET /api/modules/:moduleId`: `versionMajor`, `versionMinor` on `activeVersion`. `GET /api/admin/content/modules/:moduleId/export`: `versionMajor`, `versionMinor` on each of `versions.moduleVersions` (`null` for a version never published).

#### Restore an earlier module version (#896 S5)

`POST /api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/restore` → **201**
`{ moduleVersion }`.

Copies the named version's content **forward** into a new version. It does not rewind the module:
versions created after the restored one stay in the history, so restoring the wrong one is itself
undoable. The new version is always a **draft**, even when the source was published — restoring
says "go back to this text", not "publish it". Component versions (rubric, prompt template, MCQ
set) are referenced, not copied.

Idempotent per `(moduleId, moduleVersionId)` with an `Idempotency-Key`, so a double-click does not
create two versions. **404** when the version does not exist or belongs to a different module;
**403** for a caller who does not own the module.

#### Localized text: complete, partial, or a bare string (#892 / #905 / #913)

Every localized field accepts three shapes, and they mean different things:

| Shape | Meaning |
|-------|---------|
| `{"en-GB": "…", "nb": "…", "nn": "…"}` | Translated into all three languages |
| `{"nb": "…", "en-GB": "…"}` (partial) | Translated into the listed languages, **genuinely missing** the others |
| `"…"` (bare string) | Written in one language, not translated yet. Read as `nb` |

The partial form is the important one. A translation that succeeds for one target language and
fails for another has to be expressible, or the client is forced to collapse the value back to the
source language and **discard the translation that succeeded** — which is what #892 and #905 were
about, and what #913 finished by extending the same contract to MCQ content (`mcqSet.title`,
`questions[].stem`, `questions[].options[]`, `questions[].correctAnswer`, `questions[].rationale`).

**Question types (#1077).** A question in an `mcqSet` (create, import, append, agent package) has an
optional `questionType`: `"single"` (default) with `correctAnswer`, or `"multiple"` («select all that
apply») with `correctAnswers` — one or more of `options`, distinct, and not all of them. Exports
write `questionType` and `correctAnswers` for `"multiple"` only; a `"single"` question is exported as
before. Participant endpoints:

- `GET /api/modules/:moduleId/mcq/start` returns `questionType` per question (never the answer key).
- `POST /api/modules/:moduleId/mcq/submit`: each response has `selectedAnswer` (one string) **or**
  `selectedAnswers` (array, for `"multiple"`). A `"multiple"` answer is correct only when the chosen
  options equal the correct ones; a choice that is not an option makes it wrong.
- `GET /api/submissions/:id/mcq-review` adds `questionType`, and for `"multiple"` `selectedAnswers`
  and `correctAnswers` (as option text in the reader's locale).
- `POST /api/admin/content/generate/mcq` and `.../generate/mcq/revise` (#1077 delivery 1b): a
  question in the response may carry `"questionType": "multiple"` and `correctAnswers` (option text,
  in option order); `correctAnswer` is then the first of them. Generation follows a plan the server
  draws per call — a random 10–50 % of the questions, in random positions, each with a random number
  of correct options from one to all; a response that does not follow it after one retry gets a
  warning in `validation.issues`. Revision keeps each question's type unless the instruction asks otherwise, and
  never returns more than half the set as `"multiple"` (or as many as the input already had).

**Fill in the missing word (#1077 delivery 3).** `"questionType": "fill"`: the stem has exactly one
blank (`___`) in every language, and `options` are the **accepted answers** (1–6, none twice) — there
is no `correctAnswers`; `correctAnswer` is the first answer. Participant endpoints:

- `GET /api/modules/:moduleId/mcq/start` returns `options: []` for a `"fill"` question — the accepted
  answers are the answer key and never leave the server before submission.
- `POST /api/modules/:moduleId/mcq/submit`: the response is `textAnswer` (what the participant wrote;
  empty is allowed and wrong). Correct when it equals an accepted answer in any of the question's
  languages, ignoring case, spaces and punctuation at the end, or is one character from an accepted
  answer of 7+ characters.
- `GET /api/submissions/:id/mcq-review` returns `acceptedAnswers` (in the reader's locale) and
  `options: []` for `"fill"`; `selectedAnswer` is what was written.
- Revision and localization keep the type and the blank; generation does not make `"fill"` questions yet.

**Example answer (#1124 del 2).** A free-text module version has an optional `modelAnswer`
(LocalizedText): a strong answer to the task, shown to the participant after assessment when the
version's `assessmentPolicy.practical.modelAnswerAfterAssessment` is `true` (off by default).

- `POST /api/admin/content/modules/:moduleId/versions` takes `modelAnswer`. **Omitted keeps the
  previous version's value** (a client that does not know the field must not erase it); `null` clears
  it. It is exported and imported with the module, translated by `generate/module-draft/localize`
  when sent, and part of the publish gate's translation check.
- `GET /api/submissions/:id/model-answer` → `{ enabled, modelAnswer, ownAnswer }`. The only way the
  example answer reaches a participant: `modelAnswer` is the text in the reader's locale when the
  policy is on **and** the submission has a decision, else `null`; `ownAnswer` is the submitted text,
  field by field. 404 when the submission is not the caller's. No other participant endpoint carries
  the field.

Two rules for clients:

- **Never write a source-language copy into a locale whose translation failed.** A copy is
  indistinguishable from a real translation, so the publish gate cannot see the gap and the wrong
  language reaches a participant.
- **Omit a locale rather than sending `""`.** An empty localized value is rejected; an absent
  locale is the supported way to say "not translated". The same holds for an optional field the
  content does not have (`rationale`, `description`): omit the key.

#### Module version numbers (#934 slice 5a-2)

`POST …/module-versions/:moduleVersionId/publish` and `POST /api/calibration/workspace/publish-thresholds` also return
`versionMajor` and `versionMinor`. The number is given once, the first time a version is published: 1.0, then a minor version
unless the version is published through `…/publish-versioned` with `moduleVersion: "major"` (`supersedesEarlierPasses: true` on this route is `409 client_outdated` since the per-course rule, see above). Two refusals, with nothing written:

- **409 `module_version_number_fixed`**: a major version for a version that already has a number.
- **409 `module_version_outdated`**: the version belongs to a lower major version than the module's highest.

#### Publish translation gate (#896 S4)

Publishing is blocked when a participant-facing field is missing one of the three locales
(`en-GB`, `nb`, `nn`). The response is **422 `publish_blocked_by_validation`**, and each gap is one
entry in `issues[]`:

```json
{
  "error": "publish_blocked_by_validation",
  "issues": [
    {
      "severity": "blocking",
      "code": "translation_incomplete",
      "message": "taskText: missing nn",
      "field": "taskText",
      "missingLocales": ["nn"]
    }
  ]
}
```

`field` and `missingLocales` are structured deliberately: the UI's "translate what is missing"
action reads them directly rather than parsing the message.

Gated fields — all of them **only when present**, since an absent optional field is not an
untranslated one:

| Field | Why it is gated |
|-------|-----------------|
| `title` | Shown in the module list and the workspace |
| `description` | Shown to participants in the module list — content, not setup |
| `taskText` | The scenario the participant answers (absent for `MCQ_ONLY`) |
| `assessorExpectedContent` | Feeds assessment; surfaces in feedback |
| `candidateTaskConstraints` | Shown to the participant with the task |
| `mcq.question<N>` | Stem, options, correct answer and rationale of question N. For `MCQ_ONLY` the questions *are* the assessment. Reported per question rather than per option — one actionable line instead of eight |

A value stored as a plain string counts as translated only into the source locale (`nb`). That is
the #892/#905 encoding for "written once, not translated yet" — but it does not record *which*
language, so the client now writes a one-key map (`{"en-GB": "…"}`) instead. Bare strings remain
readable for legacy rows and API clients; they are simply assumed to be `nb`.

The same check guards the other publish doors:

- **Course cascade** (`POST /api/admin/content/courses/:courseId/publish` with `publishItems`):
  the module appears in `publish-preview` with `publishable: false` and a `translation_incomplete`
  blocker; the cascade returns 422 and publishes nothing.
- **Import auto-publish**: the import succeeds, but a package missing a locale lands as a **draft**
  instead of going live.
- **Calibration threshold publish** is exempt — it re-publishes an already-live version with new
  thresholds and no new participant-facing text.

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
| `POST` | `/api/admin/content/modules/:moduleId/versions` | ADMINISTRATOR, or an **owner of this module** |
| `GET` | `/api/admin/content/modules/:moduleId/export` | ADMINISTRATOR, or an **owner of this module** |

**`POST /modules/:moduleId/versions` (#906)** creates a module version **and every component it
references in one transaction** — rubric, prompt template and MCQ set. Either all of it exists
afterwards, or none of it does.

The granular routes (`/rubric-versions`, `/prompt-template-versions`, `/mcq-set-versions`,
`/module-versions`) remain: imports, agents and single-component edits compose with them. (Until
v2.19.0 the advanced editor also drove them card by card; that page is deleted.) But five separate
commits mean a failure on the last one leaves a module with orphaned component versions and no
version referencing them. **Authoring UIs should use the composed route.**

One call stays outside the transaction on the workspace's save path: `POST
/modules/:id/rubric-versions/ensure`, which runs when the author has not edited the criteria
directly. It may call the LLM to generate a rubric, and an HTTP round trip has no business holding
a database transaction open. It is idempotent — it returns the module's active rubric with
`reused: true` when one exists — so a failure downstream leaves a reusable rubric, not an orphan.

Components can be **created** inline (`rubric`, `promptTemplate`, `mcqSet`) or **referenced** by
id (`rubricVersionId`, `promptTemplateVersionId`, `mcqSetVersionId`) when unchanged. If both are
given for the same slot the newly created one wins. Idempotency-keyed per module
(`modules.versions.compose:<moduleId>`), so a retried request does not double-write and the same
key against a different module is not replayed.

It also accepts the **module-level** fields, applied in the same transaction (#896 S3b) — they
had no update path at all before, only creation:

| Field | Semantics |
|---|---|
| `title`, `description`, `certificationLevel` | Localized **patch**: naming one locale changes that locale and leaves the others. Send a plain string to replace the whole value as "one language, not translated yet" (#905). |
| `description: null` | Clears the description. Omitting the field leaves it untouched. |
| `validFrom`, `validTo` | ISO date or datetime; `null` clears the bound. An unparseable value is a `400`, not a clear. The **merged** window is validated against the stored dates, so moving one bound past the other is rejected even when only one is sent. |

The mode rules are enforced in both directions: a mode missing its required components is
rejected, and so is a mode carrying components it has no use for — those used to be dropped
silently behind a `201`.

`/modules/:moduleId/export` returns the full editing bundle for the module, **including MCQ
`correctAnswer` and `rationale`**. Access is owner-or-administrator (`assertModuleOwnership`),
not merely role-based. Until v2.11.11 the answer key was stripped for non-administrators; that
redaction was removed because the route is already owner-guarded, the same owner receives the
same answers from `/export-package`, and the admin UI loads the module through this endpoint —
so the redaction left the owner editing their own module without its answer key.

| `DELETE` | `/api/admin/content/modules/:moduleId` | ADMINISTRATOR, SUBJECT_MATTER_OWNER. Blocked while the module is in any course, **archived courses included** (#1149). Only active courses: `409 module_in_use` with `courseCount` at the top of the body (#705) and `details: { courseCount, count, courseTitles }`. At least one archived course: `400 content_in_archived_course`, `courseCount` at the top and `details: { count, courseTitles, archivedCount, archivedCourseTitles }` |
| `POST` | `/api/admin/content/generate/module-draft` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/generate/module-draft/localize` | ADMINISTRATOR, SUBJECT_MATTER_OWNER. Translates title, task text, guidance and expected content to one locale. **#1109:** `422 translation_structure_changed` when the translation changed the frames (see below); other failures stay `500 generation_failed`. |
| `POST` | `/api/admin/content/generate/mcq` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |

#### The translator keeps the frames (#1109)

The platform's translator — `POST /generate/module-draft/localize`, `POST /sections/localize` (also
used for a title alone and for one module field at a time by the publish gate's gap-fill) and
`POST /courses/localize-copy` — compares the translation with the source before answering. Every
frame (`:::tenk`, `:::sjekk`, `:::kort`, `:::steg`, `:::skriv`, `:::repetisjon`, English marker words
included) must be there as often as in the source, each «sjekk deg selv» must have its `- [x]` in the
same place, and each steps, cards, flashcards and write frame the same number of steps, cards or
checklist points; and the server must draw as many frames of each kind as it draws in the source. If
not, the translation to that locale is discarded:

```json
{ "error": "translation_structure_changed",
  "message": "The translation to nn changed the frames in the text and was not used. …",
  "details": { "locale": "nn", "fields": [ { "field": "bodyMarkdown",
    "problems": [ { "kind": "sjekk", "problem": "shape", "position": 1, "expected": "010", "actual": "100" } ] } ] } }
```

Status `422`. `problem` is `count` (another number of frames of that kind), `shape` (frame no.
`position` of that kind has another answer pattern / number of items) or `drawn` (as many frames, but
the server draws a different number — e.g. a blank line above `:::sjekk` was removed, so the options
became part of the list above). Clients treat the locale as not translated, as for any failed
translation: nothing is stored for it and the author is told. The rule table is shared with the skill:
`skills/a2-authoring-api/scripts/frame-structure.mjs` (`FRAME_KINDS`).

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
| `POST` | `/api/admin/content/agent-authoring/validate` | **AA-1 (#649).** Dry-run validation — **no DB writes**. Body `{ package: <a2-authoring-package/v1> }`. Returns `200 { valid, summary: { errors, warnings, objects }, issues: [{ severity: "error"\|"warning", path, code, message }], plan }` — 200 also for invalid packages (the report is the result). `plan` (topological execution order, ops `create_section`/`create_module`/`create_course`/`set_course_items`) is only populated when `errors == 0`. Covers all three `assessmentMode`s (`required_for_mode`/`forbidden_for_mode`), package rules (`duplicate_client_ref`, `unknown_client_ref`, `client_ref_type_mismatch`, `ref_or_id_required`, `ref_and_id_conflict`, `unknown_module_id`/`unknown_section_id`, `unknown_field` — publish/audit fields are rejected), section inline-figure rules (#763, Layer B: `missing_asset`, `duplicate_asset_source_id`, `unsupported_asset_mime`, `asset_too_large`, `asset_decode_failed`, `asset_svg_unsanitizable` errors; `unreferenced_asset` warning) and non-blocking warnings (`possible_duplicate_title`, `course_without_modules`). `400` only when the body isn't `{ package }` with the right `packageFormat`. |

**Agent-friendly create/import responses (AA-2, #650):** the create/import calls the skill
orchestrates accept an optional `clientRef` (pattern `[a-z0-9-]{1,64}`, echoed back in the
201-response, never persisted) and return admin-UI deep links in `links`:

- `POST /modules` and `POST /modules/import` → `links: { conversation: "/admin-content/module/:id/conversation", advanced: "/admin-content/module/:id/advanced" }`
- `POST /courses` and `POST /courses/import` → `links: { course: "/admin-content/courses/:id" }`
- `POST /sections` → `links: { editor: "/admin-content/sections?id=:id" }`. Also accepts
  `draft: true` — the section is created in Utkast (`activeVersionId` stays `null`; content is
  preserved as version 1, published later via `POST /sections/:id/publish`). Default (omitted)
  keeps auto-publish-on-save. **#763 (Layer B):** also accepts an OPTIONAL `assets[]` (inline
  figures/images, same entry shape as the export/authoring asset — `{ sourceId, filename,
  mimeType, sizeBytes, contentBase64, sourceLocale?, localizedVariants? }`, but `sourceId` is a
  client-chosen ref token `[a-zA-Z0-9_-]{1,64}` the markdown references as `asset:<sourceId>`).
  When present the server creates the section, imports the assets (mime allowlist + 5 MB
  per-asset cap + SVG re-sanitisation, reusing the #749 importer), remaps every `asset:<sourceId>`
  ref to the new `SectionAsset` id, and returns the `sourceId → assetId` map as `assetMap`. The
  section create is auto-published only when `draft` is not `true` (agent-token requests still
  require `draft: true`). This route accepts a larger 15 MB body to carry inlined assets.

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

**The role is not the whole check.** Routes on `:courseId` that WRITE additionally require that the caller
**owns the course** (or is ADMINISTRATOR) — `requireContentOwnership("COURSE", "courseId")`. They return
`403 content_ownership` for a non-owner SMO, or `403 content_unowned` when the course has no `ContentOwner` row at all
(legacy content — admin-only until an owner is assigned). Of the reads, `GET …/enrollments` (participant names, e-mail,
department, progress), `GET …/pending-versions` and `GET …/archive-preview` are guarded the same way.

**Most reads are open to every SMO by design** (product owner 2026-09-07, confirmed 2026-11-02; `doc/DECISIONS.md`,
«Fagansvarlige deler innsyn»): `GET /:courseId`, `GET /:courseId/items`, `GET /:courseId/publish-preview`,
`GET /:courseId/export-package` and `GET /:courseId/draft` have no ownership guard. #903/#943 once closed them; that was
reversed. Corrected 2026-11-13 (QA gate, #1150): this paragraph still described the closed state.

The **list** endpoints stay open by design: they are how an author finds their own content, and
each row carries `canManage` so the UI hides the actions the guard would reject. The line is
between the list and the detail.

The same asymmetry existed on classes and is closed by #943: `GET /:classId/members` returned the
name and e-mail of every member of any class while both writes on that path were guarded.

Course ownership is deliberately **not** module ownership: a course owner exporting their own
course receives the inlined payload of every module in it, including modules authored by someone
else and their MCQ answer keys. Accepted scope (#903) — the guard is about reading courses you
have nothing to do with, not about partitioning content inside a course you assembled.

### Courses

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/admin/content/courses` | List courses (with module count, and `sortOrder` — the placement in «Mine kurs», null = alphabetical, #1094; 2.102.0: `themes: [{ id, name }]`, localized and alphabetical; #934 (2.129.0): `versionMajor`, `versionMinor`. #1140 (2.157.0): `lifecycle` is `published_with_draft` for a published course with a saved draft — treat it as published) |
| `POST` | `/api/admin/content/courses` | Create a course. 2.102.0: optional `themeIds: string[]` |
| `GET` | `/api/admin/content/courses/:courseId` | Course detail (modules). Open to every author (product owner 2026-09-07; the ownership guard from #943 was removed again). #934 (2.129.0): `versionMajor`, `versionMinor`, and `certificateHolders` — how many have a course certificate for the current major version (the ones a new major version applies to). #934 (2.131.0): `contentRevision` — the counter the course form sends back as `expectedRevision`. #934 (2.132.0): `majorEmailRecipients` — how many a new major version e-mails: everyone with a course certificate for the course (any major version), active and not anonymized, one per person (`findMajorVersionRecipients`; can be higher than `certificateHolders`). #1140 (2.157.0): `hasDraft` — the course has a saved draft (fetch it with `GET …/draft`) — and `lifecycle` (`draft`, `published`, `published_with_draft`, `archived`). A published course with a draft is `published_with_draft`; an unpublished course can have a draft row left over (`lifecycle: "draft"`, `hasDraft: true`) |
| `PUT` | `/api/admin/content/courses/:courseId` | Update course metadata. 2.102.0: `themeIds: string[]` sets exactly those themes; omitted leaves them. An unknown id is **`400 course_theme_not_found`** and nothing is saved. The detail (`GET`) returns `themeIds`. #934 (2.129.0): a changed title or description on a course that has been published raises the minor version (compared as content, so the same text with the locale keys in another order is no change). The response carries the course after the bump. Content is NOT accepted here (an `items` field is ignored, as before) — see `PUT …/content`. #934 (2.131.0): **requires `expectedRevision`** (the detail's `contentRevision`); without it **`409 course_form_outdated`**, with a stale one **`409 course_changed`** (`details.currentRevision`) — nothing is saved. The course form no longer calls this route for an existing course |
| `PUT` | `/api/admin/content/courses/:courseId/content` | #934 (2.129.0): the course form's save when the content changed — the same fields as `PUT /:courseId` plus **required** `items` (same shape as `PUT …/items`) and optional `version: "major" \| "minor"`, in ONE transaction. The server decides the version once: changed content gets the author's answer, otherwise a changed title gives minor; no client flag can switch the bump off. A separate endpoint on purpose: during a rolling deploy an old server answers 404 instead of saving half. Response `{ course }` after the bump. **`403 content_ownership`** for a non-owner SMO. #934 (2.131.0): the course form saves an existing course ONLY here, also when the content is unchanged, with **required `expectedRevision`**: missing → `409 course_form_outdated`, stale (someone else saved after the form was opened) → `409 course_changed`; nothing is written in either case. #934 (2.132.0): optional `confirmEmailRecipients` — see `PUT …/items`. #1140 (2.157.0): a course that has a draft is locked — **`409 course_has_draft`** — for everything else that writes its fields or list: this route, `PUT /:courseId`, `PUT …/items`, `PUT …/modules` and the course import (`replaceExisting`, `updateExisting`; its one transaction is rolled back, and the images it uploaded are removed). Nothing is written. Without a draft the direct save works as before; the course builder saves a **published** course to `PUT …/draft` instead |
| `GET` | `/api/admin/content/courses/:courseId/draft` | #1140 (2.157.0): the draft of a published course — what the course builder has saved but not published. `{ draft: { id, revision, source, updatedById, updatedByName, updatedAt, course: { title, description, certificationLevel, enrollmentPolicy, discussionsEnabled, discussionOwnerNotifications, sortOrder, themeIds }, items: [{ type, sortOrder, moduleId, sectionId, title, discussionsEnabled, archivedAt, unpublished, missing }] } }`. A field the draft left out is filled in from the published course («as published»). `archivedAt`, `unpublished` and `missing` mark an item that stops the publish: archived or deleted after the draft was saved, or new in the draft and not published (`unpublished` is false for an item that is already in the published course, also when it has no published version). Open to every author, like the detail. **`404 course_draft_not_found`** without a draft. A stored draft that no longer fits the form's schema: **`409 course_draft_unreadable`** with `details: { draftId, revision }` (enough to discard it). Not reachable with an agent token |
| `PUT` | `/api/admin/content/courses/:courseId/draft` | #1140 (2.157.0): save the draft. Body: the fields of `PUT …/content` (without `version`, `expectedRevision`, `confirmEmailRecipients`), **required** `items`, and **required** `loaded` — what the form loaded: `{ expectedRevision }` (no draft seen; the detail's `contentRevision`) or `{ draftId, revision }` (the draft it loaded). Nothing participants see changes. Requires a published course (**`409 course_draft_requires_published`**; an unpublished course is saved directly). `{ expectedRevision }` when a draft exists, or a `draftId`/`revision` that is not the current draft (also when the draft is gone): **`409 course_draft_changed`**; `{ expectedRevision }` that is not the course's: **`409 course_changed`**. The counters are checked first; then the list as on a direct save (`400 course_duplicate_item`, `course_item_archived`, `course_item_not_found`) and the themes (`400 course_theme_not_found`). Holds the content lock. Response `{ draft }` as `GET`. **`403 content_ownership`** for a non-owner SMO. Audited (`course_draft_saved`). Not reachable with an agent token |
| `DELETE` | `/api/admin/content/courses/:courseId/draft?draftId=…&revision=…` | #1140 (2.157.0): discard the draft the tab loaded (`400 validation_error` without both query values). Works also when the course is unpublished or archived. `204`. If someone else has saved, published or discarded it since: **`409 course_draft_changed`**, and nothing is discarded. **`403 content_ownership`** for a non-owner SMO. Audited (`course_draft_discarded`). Not reachable with an agent token |
| `POST` | `/api/admin/content/courses/:courseId/draft/publish` | #1140 (2.157.0): publish the draft. Body (strict) `{ loaded: { draftId, revision }, version?: "major" \| "minor", confirmEmailRecipients?: number }`. Writes the draft to the course with the ordinary save (fields, themes, list; version and e-mail decided as in `PUT …/content`) and deletes the draft, in ONE transaction under the content lock; on any failure both stand as before. Response `{ course }`. Errors, nothing written in any of them: **`409 course_draft_changed`** (not the draft the tab loaded, or the draft is gone); **`409 course_draft_requires_published`** (the course is unpublished: publish it again or discard); **`409 course_draft_unreadable`**; **`400 course_draft_item_unusable`** with `details.items: [{ type, id, title, reason: "archived" \| "unpublished" \| "missing" }]`; **`400 course_version_required`** when the list changed, someone holds a certificate and `version` is missing; `409 major_email_confirm_required`. A theme deleted since the draft was saved is dropped, not an error. **`403 content_ownership`** for a non-owner SMO. Audited (`course_draft_published`, plus the ordinary `course_updated`). Not reachable with an agent token |
| `GET` | `/api/admin/content/themes` | 2.102.0: the themes for «Mine kurs», `{ themes: [{ id, name, courseCount, updatedAt }] }`; `name` is stored localized JSON. `courseCount` counts **active** courses; an archived course keeps its theme but is not counted (#1149). Readable by everyone in content administration |
| `POST` | `/api/admin/content/themes` | 2.102.0: create a theme. Body `{ name: { nb, nn?, "en-GB"? } }` (Bokmål required, max 80 characters). **ADMINISTRATOR only** (`403` otherwise) |
| `PUT` | `/api/admin/content/themes/:themeId` | 2.102.0: rename a theme, same body. **ADMINISTRATOR only**. `404 course_theme_not_found` |
| `DELETE` | `/api/admin/content/themes/:themeId` | 2.102.0: delete a theme; the courses only lose it. Response `{ detachedCourseCount }`. **ADMINISTRATOR only** |
| `PUT` | `/api/admin/content/courses/:courseId/modules` | Set the module list (legacy). Writes `CourseItem` MODULE-rader — det er ikke lenger en dual-write, `CourseItem` er eneste sannhetskilde (#502). Eventuelle SECTION-elementer bevares og re-indekseres etter modulene. **`400` hvis en modul er arkivert** (#992) — samme regel som `/items`; se under. #934 (2.131.0): samme tellerregel som `/items` |
| `GET` | `/api/admin/content/courses/:courseId/items` | Read the ordered mixed module/section sequence (#486/B2). Open to every SMO (see «Most reads are open» above) |
| `PUT` | `/api/admin/content/courses/:courseId/items` | Set the ordered sequence — body `{ items: [{type:"MODULE",moduleId} \| {type:"SECTION",sectionId}] }`. Re-syncs CourseModule (#486). **`400` hvis noe av innholdet er arkivert** (#938); se under. #934 (2.129.0): optional `version: "major" \| "minor"` — the author's answer when a **published** course's content changes (an item added, taken out or moved; the per-item discussion toggle is not content). Omitted while someone holds a certificate for the current major version: **`400 course_version_required`** (`details.certificateHolders`) and nothing is saved (product owner 2026-11-02); otherwise minor. `major` with nobody holding a certificate for the current major version becomes minor (there is nobody it applies to). A major version writes a `CourseVersion` row for the version that ends (the section versions just before the change) and one for the new version, in the same transaction; a section whose version differs between the two must be read again (reads before the new version's `publishedAt` no longer count for it). The legacy `PUT …/modules` always gives minor. A course that has never been published gets no new version (it becomes 1.0 at first publish); one that has been out (published now, a `slug`, or certificates) is versioned also while unpublished. #934 (2.131.0): optional `expectedRevision`; without it the call is accepted only for a course that has never been out (an agent token, a new course from the form) — otherwise **`409 course_form_outdated`**, checked under the content lock. `versionAware` is still accepted and means nothing. #934 (2.132.0): a major version creates one `CourseVersionNotice` row per recipient (`majorEmailRecipients` in the detail) in the same transaction, also while the e-mail is switched off; the worker sends them (see `COURSE_MAJOR_EMAIL_ENABLED`). Optional `confirmEmailRecipients: number` — the count the dialog showed. Over **200** recipients (recounted under the content lock) a major version needs it, and not lower than the recount: otherwise **`409 major_email_confirm_required`** (`details.majorEmailRecipients`) and nothing is written. An old client never sends it. The new `CourseVersion` row carries `changedItemCount` (sections with a new version or new in the course, modules newly live in it). |
| `GET` | `/api/admin/content/courses/:courseId/publish-preview` | Inspect unpublished items before publishing (#734). Open to every SMO (see «Most reads are open» above). Returns `{ courseId, allPublished, publishable, unpublishedItems: [{ type, id, title, publishable, blockers: [{code,message}] }] }`. Read-only; the UI calls it to drive the cascade-publish confirm dialog. |
| `POST` | `/api/admin/content/courses/:courseId/publish` | Publish course (#734). Body `{ publishItems?: boolean }`. If the course has unpublished modules/sections: without `publishItems:true` returns `409 course_has_unpublished_items` (with the preview) so the UI can confirm; with `publishItems:true` cascade-publishes the items (items → course) — but returns `422 course_publish_blocked_by_items` (with `details.unpublishedItems`) and publishes nothing if any item is un-publishable (module fails validation / no content, archived item). Enforces I1: a published course never contains unavailable content. Response `{ course, publishedItems }`. #934 (2.129.0): optional `courseVersion: "major" \| "minor"`. The cascade is ONE transaction (locked course row, snapshot, items, version, then the course); when new content goes live in a course that has been out and someone holds a certificate, the answer is required (`400 course_version_required` otherwise, nothing published). A course published for the first time becomes 1.0. `publish-preview` carries `course: { published, versionMajor, versionMinor, certificateHolders }`. A failure publishes nothing (`500 course_publish_failed`). #934 (2.132.0): `publish-preview`'s `course` also carries `majorEmailRecipients`; optional `confirmEmailRecipients` and the 200 rule as in `PUT …/items` (`409 major_email_confirm_required`, nothing published). |
| `GET` | `/api/admin/content/courses/:courseId/pending-versions` | 2.101.0: the course's items whose newest version is not the live one — a newer version laid ready (course update, #1095) or never published. Course owner or ADMINISTRATOR. Returns `{ courseId, items: [{ type, id, title, versionId, isNew, publishable, blockers, passedCount }], notOwnedItems: [{ type, id, title }], publishable, passedTotal, modulesWithPasses, course, affectedCourses }`. `affectedCourses` (#934 5a-3) is always present since 2026-11-08; `passedCount`/`passedTotal` are the old dialog's numbers. `items` holds only elements the caller owns; the rest are in `notOwnedItems`. #934 (2.129.0): `course: { published, versionMajor, versionMinor, certificateHolders }` — the dialog asks minor/major only when the course is published and `certificateHolders > 0`. #934 (2.132.0): and `majorEmailRecipients`. |
| `POST` | `/api/admin/content/courses/:courseId/publish-pending` | 2.101.0: publish every item in `items` above. Body `{ versionIds: string[], supersedesEarlierPasses?: boolean }`. `versionIds` must equal the current set, else **`409 pending_versions_changed`**. All or nothing: **`422 course_pending_blocked`** (with `details.items`) if any item is blocked. (Until 2026-11-08, with the switch off: **`400 revision_answer_required`** when someone had passed one of the modules and `supersedesEarlierPasses` was missing. Removed with the old rule.) The course's own publish state is untouched. Response `{ publishedItems, version }`. Not reachable with an agent token. #934 (2.129.0): optional `courseVersion: "major" \| "minor"` same rules as `PUT …/items` (omitted with certificate holders: `400 course_version_required`, nothing published). The items, the course version and the snapshot are written in ONE transaction — all or nothing; a failure publishes nothing (**`500 course_pending_failed`**). `version` is `{ kind, from, to }`, or `null` when nothing was published or the course has never been published. #934 (2.132.0): optional `confirmEmailRecipients`, 200 rule as in `PUT …/items`. #934 (2.135.0, always since 2026-11-08): `supersedesEarlierPasses: true`, or other affected courses with certificate holders, is **`409 client_outdated`** and nothing is written; otherwise `courseVersion` applies to this course and the modules get a minor version. |
| `POST` | `/api/admin/content/courses/:courseId/publish-pending-versioned` | #934 (2.135.0): «Publish new versions» with an answer per course. Body (strict) `{ versionIds: string[], courseVersions?: { [courseId]: "major" \| "minor" }, expectedCourseIds: string[], confirmEmailRecipients?: { [courseId]: number } }`. An answer for all affected courses with certificate holders that the sender may choose for: this one and every other course holding one of the items that has been out, also unpublished ones, listed as `affectedCourses` in `pending-versions`, each with `canChooseVersion` (2.137.0). A course's owners or an administrator may choose. Any other course gets a minor version without an answer, and `"major"` for it gives **`403 course_version_not_owner`** with nothing written. Else **`400 course_version_required`** with `details.courses`. A module gets a new major version when at least one course gets a major version because of it, and the requirement is raised in those courses only. Each course is raised exactly once. **`409 pending_versions_changed`**, **`409 affected_courses_changed`**, `422 course_pending_blocked`, `409 major_email_confirm_required`. One transaction under the exclusive content lock. Response `{ publishedItems, courses: [{ courseId, version }] }`. (`409 module_versioning_not_active` was the answer while the switch was off; never returned since 2026-11-08.) An old server answers 404. Not reachable with an agent token. |
| `POST` | `/api/admin/content/courses/:courseId/unpublish` | Unpublish course (reversible soft take-down; no G3 lock, #705) |
| `GET` | `/api/admin/content/courses/:courseId/archive-preview` | #1150 (2a-1): what archiving the course would do. Read-only; same access as `POST …/archive` (course owner or ADMINISTRATOR, **`403 content_ownership`** otherwise; not reachable with an agent token). Returns `{ courseId, courseTitle, archived, inProgressCount, pendingReviewCount, hasDraft, follows: [{ type, id, title, owned }], stays: [{ type, id, title, usedBy: [{ courseId, title, via: "course" \| "draft" }] }], alreadyArchived: [{ type, id, title }] }`. `inProgressCount` is the G3 number (participants «I gang» as «Mine kurs» counts them, see `course_has_active_participants`). `pendingReviewCount`: submissions on the course's modules from those participants that can still get an outcome (not `COMPLETED`/`REJECTED`/`SUPERSEDED`, or with an appeal not `RESOLVED`/`REJECTED`/`SUPERSEDED`). `follows`: the course's items (its own list, not its draft) that are not archived and not used elsewhere — in another non-archived course, or in a saved draft of one; they follow the course into the archive from 2a-2. `owned` says whether the caller owns the item (an administrator owns everything); items the caller does not own follow too. `stays`: used elsewhere, with where. `hasDraft`: the course has a saved draft (discarded on archive from 2a-2). An archived course: `archived: true`, empty lists and zero counts. `404 course_not_found`. Titles in the request's locale. In 2a-1 `POST …/archive` is unchanged: G3 still blocks. |
| `POST` | `/api/admin/content/courses/:courseId/archive` | Archive course. Blocked `400` if a participant is mid-course (G3 — suggests unpublish instead); auto-unpublishes (I3, #705). #1150 (2a-1): «mid-course» is now the same count as `archive-preview`'s `inProgressCount` and the course list's `inProgressCount` (see `course_has_active_participants`) |
| `POST` | `/api/admin/content/courses/:courseId/restore` | Restore an archived course (lands in Utkast, #705) |
| `GET` | `/api/admin/content/courses/:courseId/cascade-delete-preview` | **ADMINISTRATOR-only** (403 `forbidden` otherwise). Preview a destructive course cascade delete (#762). Returns `{ courseId, courseTitle, deletableModules, deletableSections, sparedModules, sparedSections, blockers, deletable }` — each entry `{ id, title, reason }`. Deletable = exclusive to this course (its only `CourseItem` reference) with no preserved records; spared = shared with another course (only unlinked); blockers = course completions, or an exclusive module with submissions/certifications. Read-only. |
| `POST` | `/api/admin/content/courses/:courseId/cascade-delete` | **ADMINISTRATOR-only** (403 `forbidden` otherwise). Delete a course + the modules/sections it exclusively owns, in one transaction, all-or-nothing (#762). Never destroys preserved records: if any blocker exists returns `400 validation_error` with `details.blockers` and deletes nothing. Otherwise `200 { deletedCourseId, deletedModuleIds, deletedSectionIds, sparedModuleIds, sparedSectionIds }`. #934 (2.131.0): body **requires** `{ expectedDeletedModuleIds, expectedDeletedSectionIds }` — what the preview showed; missing → `409 course_form_outdated`, different from the analysis under the content lock → `409 course_cascade_changed`, nothing deleted. FK order (load-bearing): unlink `CourseItem`/`CourseModule` → per exclusive module null `activeVersionId` then delete `ModuleVersion`→`MCQQuestion`→`MCQSetVersion`/`RubricVersion`/`PromptTemplateVersion`→module → per exclusive section null `activeVersionId` then delete `CourseSectionVersion`→section → delete course. Shared content is spared. |
| `GET` | `/api/admin/content/courses/:courseId/enrollments` | List active enrollments for a course, each with the participant + derived status (#496/EN-2) |
| `POST` | `/api/admin/content/courses/:courseId/enrollments` | Assign — body `{ userIds?: string[], department?: string, dueAt?: string\|null }`. Individual list and/or department materialisation. Idempotent per user; audited (#496/EN-2) |
| `DELETE` | `/api/admin/content/courses/:courseId/enrollments/:userId` | Revoke (soft) a participant's enrollment; audited (#496/EN-2) |
| `GET` | `/api/admin/content/classes` | List classes (cohorts) with member + assigned-course counts (#645/CL-2) |
| `POST` | `/api/admin/content/classes` | Create a class — body `{ name, description? }` (#645/CL-2) |
| `POST` | `/api/admin/content/classes/:classId/archive` | Archive a class (soft). System classes rejected `400` (#645/CL-2, route form from #1046) |
| `POST` | `/api/admin/content/classes/:classId/restore` | Restore an archived class |
| `DELETE` | `/api/admin/content/classes/:classId` | ⚠️ **Deletes the class permanently**, with its members, course assignments and owners (#1046: same route form as courses and sections). Only an archived class: an active one gives `400 class_not_archived`, a system class `400 system_class_immutable`. Before #1046 this route archived; do not use it to archive |
| `GET` | `/api/admin/content/classes/:classId/members` | List class members (#645/CL-2) — returns **name and e-mail**. **`403 content_ownership`** for a non-owner SMO, **`403 content_unowned`** on system classes (#943) |
| `POST` | `/api/admin/content/classes/:classId/members` | Add a member — body `{ userId }` (#645/CL-2). **`400 class_archived`** (`details: { action: "add_member", classId }`) when the class is archived (2026-11-08): the class is read with its row locked in the same transaction as the write, so an archive at the same moment either waits or is seen. Restore the class first; removing a member still works |
| `DELETE` | `/api/admin/content/classes/:classId/members/:userId` | Remove a member (#645/CL-2) |
| `GET` | `/api/admin/content/classes/:classId/courses` | List courses assigned to the class (#645/CL-2). **`403 content_ownership`** for a non-owner SMO (#943). Each row carries `coursePublished` / `courseArchived` (#967) — assignments to an unreachable course are **not** hidden (a hidden row is a row nobody can remove), they are flagged so the screen can explain why nobody is progressing |
| `POST` | `/api/admin/content/classes/:classId/courses` | Assign a course — body `{ courseId, dueAt?\|null }` (#645/CL-2). **`400 class_archived`** (`details: { action: "assign_course", classId }`) when the class is archived (2026-11-08), as for members |
| `DELETE` | `/api/admin/content/classes/:classId/courses/:courseId` | Unassign a course (#645/CL-2) |
| `GET` | `/api/admin/content/users/search?q=` | Search users by name/email (min 2 chars, capped 20) for class membership (#645/CL-3) |

Classes (cohorts) assign a course to a group of participants dynamically: a participant is assigned a course if they belong to a class it is assigned to (evaluated at read time, never materialised). The built-in **"Alle deltakere"** system class covers all PARTICIPANT users. `GET /api/courses` and `GET /api/courses/enrollments` reflect class assignments (the latter with `source: "CLASS"`). Entra-linked classes (`kind=ENTRA`) are gated by the `classEntraLinkingEnabled` platform config (default off, CL-5).
| `POST` | `/api/admin/content/courses/localize-copy` | LLM-translate course title/description (no course id: the body carries the text). `422 translation_structure_changed` if the translation adds or drops a frame (#1109, see «The translator keeps the frames») |
| `GET` | `/api/admin/content/courses/:courseId/export-package` | **Owner or admin only (#903).** Export envelope (inlines modules **and** sections in order, #512). #934 (2.136.0): `course.course.versionMajor` and `versionMinor` as information; the import does not read them, and a file without them is read as before. An empty course returns `422 course_not_exportable`. Section figures/images travel inline as base64 (#749, see below) |
| `POST` | `/api/admin/content/courses/import` | Import a course envelope (recreates sections via `items`, falls back to modules-only v1). Recreates section assets + remaps `asset:` refs (#749). Larger 35 MB body limit to carry inlined assets. **#937:** also accepts a bare course payload `{ course: {…} }`; anything unrecognisable returns `400 not_an_export_envelope` (a code, not prose — clients render it in the author's language). **#942 (security):** `mode: "replaceExisting"` requires ownership of `targetId` (403 `content_ownership` otherwise) — the same guard module and section import already had. **#957/#996:** responsen bærer `heldBackByTranslationGate: boolean`. Med `mode: "replaceExisting"` kan et **publisert** målkurs også bli tatt ned mens svaret har `heldBackByTranslationGate: false`: når fila er et utkast og en modul lander upublisert, avpubliseres kurset (2.89.1) — det står i revisjonssporet (`course_unpublished`, `reason: import_unpublished_module`), ikke i svaret. `true` betyr at kurset ble lagret som **utkast** selv om kilden var publisert, fordi minst én modul eller seksjon mangler et språk, eller (#1095) fordi en modul reiste som upublisert utkast i fila og kurset ikke kan publiseres rundt den — og selv om et eksisterende målkurs var publisert før importen (da avpubliseres det, ellers ville deltakere møtt «modul ikke tilgjengelig» i et levende kurs). Uten feltet fikk forfatteren `201 Created` uten forklaring. |
| `DELETE` | `/api/admin/content/courses/:courseId` | Delete course |

#### Arkivert innhold kan ikke legges inn i et kurs (#938/#992)

Både `PUT /:courseId/items` og legacy-ruta `PUT /:courseId/modules` avviser arkiverte moduler og
seksjoner med `400`. De to feilene er **med vilje forskjellige**, fordi de krever ulik handling av
klienten:

| Situasjon | Melding |
|---|---|
| Elementet finnes, men er arkivert | `One or more modules/sections are archived and cannot be added to a course.` |
| Elementet finnes ikke | `One or more modules/sections do not exist.` |

Ingenting skrives på veien til avslaget — kontrollen skjer før transaksjonen, så en avvist forespørsel
lar kursets sekvens stå urørt.

⚠️ **Merk for integrasjonsklienter:** legacy-ruta svarte tidligere `204` uansett modulstatus. En
klient som sender en arkivert modul-ID får nå `400`. Regelen finnes fordi arkivert innhold i et
publisert kurs blokkerte fullføring permanent (#938).

Regelen gjelder **ikke** upubliserte utkast — de kan legges inn, og utelates i stedet fra deltakerens
sekvens (se `doc/DECISIONS.md`, «Upublisert innhold vises ikke for kandidater i det hele tatt»).

#### Section figures/images carried through export/import (#749, Layer A)

Course export/import now transport a section's figures/images (`SectionAsset`), so figures survive a cross-environment round-trip and the authoring skill's fallback file — not just their markdown `asset:<id>` references. The transport is **additive** to `a2-content-export/v1` (no version-marker change); asset-less files exported before #749 import unchanged.

- **Schema:** each section payload gains an OPTIONAL `assets[]`; each entry is `{ sourceId, filename, mimeType, sizeBytes, contentBase64, sourceLocale?, localizedVariants?: [{ locale, contentBase64 }] }`. `sourceId` is the source-environment `SectionAsset` id — used only to match `asset:<sourceId>` markdown refs, never persisted as an id.
- **Export** inlines each `SectionAsset` blob (and every #657 localized SVG variant) as base64. Enforced caps: **5 MB per asset** and a **25 MB total-decoded-asset budget per envelope** — export fails `400 validation_error` if the total is exceeded (a figure is never silently dropped).
- **Import** decodes each asset, enforces the **mime allowlist** (`image/svg+xml`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`) and the 5 MB per-asset cap, **re-sanitises SVG** (base + variants; scripts/handlers/`foreignObject`/`<a>` stripped — defence in depth), stores it to a fresh blob under the new section, creates the `SectionAsset` row (preserving `sourceLocale`/localized variants), then **rewrites the section's active `bodyMarkdown`** so every `asset:<sourceId>` points at the new asset id. A failing asset surfaces a clear `400` naming the section/asset (no silent skip). Ordering is create-section → create-assets → re-save markdown with remapped refs, so the persisted active version never references source ids. See `doc/design/COURSE_FIGURES_AND_ASSETS.md` (Layer A). Skill figure *design* (Layer B) is a later phase.

#### Envelope scopes (#433, #512, #916)

`a2-content-export/v1` carries exactly one payload, named by `scope`:

| `scope` | Payload field | Endpoints |
|---|---|---|
| `module` | `module` | `GET /modules/:id/export-package` · `POST /modules/import` |
| `course` | `course` (inlines modules **and** sections in order) | `GET /courses/:id/export-package` · `POST /courses/import` |
| `section` | `section` | `GET /sections/:id/export-package` · `POST /sections/import` |

The schema refines `scope` against the payload in both directions, so an envelope can neither claim
a payload it lacks nor smuggle one it does not name; each import endpoint additionally rejects a
foreign scope with `400 scope_mismatch` rather than half-importing it. The `section` payload is the
**same object** a course envelope inlines under `items[].section` — the *payload* is byte-compatible
either way. What a course file actually holds under `items[]` is one level higher: the course ITEM
`{ type, sortOrder, section }`. Lifting one out therefore yields a fragment, not an envelope, and
until #937 that produced a raw Zod dump. All three import endpoints now **wrap what they can**
(see the import rows below), so the fragment a course file gives you imports directly. Adding `section`
did not change the format version: older files have no `section` field and validate exactly as before.

### Learning sections (#476)

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/admin/content/sections` | Create a section (`title` + `bodyMarkdown`) → section + version 1. Optional `draft`, `clientRef`, `agentRunId`, and (#763, Layer B) `assets[]` inline figures/images — imported + `asset:<sourceId>` refs remapped, `assetMap` (`sourceId→assetId`) echoed back. Larger 15 MB body for inlined assets. **Auto-publish-on-save is conditional (#916):** if the translation gate finds a gap the section is created as a DRAFT and the response carries `translationGate: { heldBack: true, issues[] }` |
| `GET` | `/api/admin/content/sections` | List sections. `courses: [{ id, title }]` and `courseCount` are the **active** courses that contain the section; an archived course is not listed or counted (#1149) |
| `GET` | `/api/admin/content/sections/:sectionId` | Section detail. `canManage` says whether the caller may manage the section (owner or administrator; 2.89.0) — the editor hides lifecycle and write actions when false. `bodyMarkdown` + `versionNo` come from the **newest** version (not only the active one), so a save held back by the gate is still visible to its author; `hasUnpublishedChanges` is true when the newest version is not the published one (#916) |
| `PATCH` | `/api/admin/content/sections/:sectionId/title` | Update title |
| `PUT` | `/api/admin/content/sections/:sectionId/content` | Store a new immutable content version. It becomes the active (participant-visible) one unless the translation gate blocks — then the version is stored, `activeVersionId` is left untouched, and the response carries `translationGate: { heldBack: true, issues[] }` (#916) |
| `POST` | `/api/admin/content/sections/:sectionId/publish` | Re-point active version to latest (G1 needs content, #705). Blocked `422 publish_blocked_by_validation` with `issues[]` (`field` + `missingLocales`) when a participant-visible field lacks a locale (#916) |
| `GET` | `/api/admin/content/sections/:sectionId/export-package` | **Owner or admin only.** Standalone `a2-content-export/v1` envelope with `scope: "section"` — the same section payload a course export inlines, so the two are interchangeable. Figures/images travel inline as base64 under the 25 MB total-asset cap. A section with no version returns `422 section_not_exportable` (#916) |
| `POST` | `/api/admin/content/modules/import` | Import a `scope: "module"` envelope. **#937:** also accepts a course item `{ type: "MODULE", sortOrder, module }` lifted out of a course file, or a bare module payload (recognised by `module` + `activeVersion`); both are wrapped server-side. A wrong scope returns `400 scope_mismatch`; an unrecognisable file returns `400 not_an_export_envelope` |
| `POST` | `/api/admin/content/sections/import` | Import a `scope: "section"` envelope. `mode: "createNew"` (default) creates a fresh section; `mode: "replaceExisting"` + `targetId` appends a new version to an **owned** target (403 `content_ownership` otherwise). A wrong scope returns `400 scope_mismatch`. **Accepts three shapes (#937):** a full envelope, a course item `{ type: "SECTION", sortOrder, section }` lifted out of a course file, or a bare section payload — the last two are wrapped server-side, and the synthesized envelope is recorded in the audit event as `envelopeSynthesized: true` (its `exportedAt` is the import time, not an export time). Anything else returns `400 not_an_export_envelope` with a human `message` instead of Zod issues; clients render the CODE in the author's language, never the server text. **The import always lands unpublished** (`published: false` in the response) — publishing is an explicit act after review, as for module import (#896 §9). Assets go through the same `stageSectionAssets` path as course import. Response `{ sectionId, sectionVersionId, assetCount, published, links }` (#916) |
| `POST` | `/api/admin/content/sections/:sectionId/unpublish` | Unpublish. Blocked `400 content_in_use` if the section is in an active course (G2, #705). #1149: an archived course does not block |
| `POST` | `/api/admin/content/sections/:sectionId/archive` | Archive. Blocked `400 content_in_use` if in an active course (G2); auto-unpublishes (I3, #705). #1149: an archived course does not block. #1150: a saved draft of an active course whose item list includes the section blocks too (`400 content_in_course_draft`); a draft of an archived course does not |
| `POST` | `/api/admin/content/sections/:sectionId/restore` | Restore an archived section (lands in Utkast, #705) |
| `DELETE` | `/api/admin/content/sections/:sectionId` | Delete. Blocked `400` while the section is in any course, **archived courses included** (#1149): `content_in_use` when all of them are active, `content_in_archived_course` when at least one is archived (`details` says which). Names the courses (#705) |
| `POST` | `/api/admin/content/sections/preview` | Render markdown → sanitised HTML (same F3/X1 policy as participant view). Body `{ markdown, locale?, variant? }`; `variant: "moduleText"` (2.96.1) renders a module's text — step by step, write it yourself and flashcards stay plain text, as the participant gets it. Default `"section"`. |
| `POST` | `/api/admin/content/sections/localize` | LLM-translate title + bodyMarkdown to another locale (markdown-preserving). Rate-limited. **#1109:** `422 translation_structure_changed` with `details.locale` and `details.fields[].problems` when the translation changed the frames — see «The translator keeps the frames». |
| `POST` | `/api/admin/content/sections/:sectionId/assets` | Upload a section image (multipart `file`). PNG/JPEG/GIF/WebP/SVG, max 5 MB. SVG is sanitised server-side before storage (scripts/handlers/`foreignObject`/`<a>` stripped, #657). Returns `asset` + `ref` (`asset:<id>`). |
| `GET` | `/api/admin/content/sections/:sectionId/assets` | List section assets. |
| `POST` | `/api/admin/content/sections/:sectionId/assets/localize` | Generate translated SVG variants for the section's SVG drawings. Body `{ sourceLocale }`. Extracts `<text>`/`<tspan>` labels, translates to each other supported locale, stores a per-locale variant. Explicit author action (never implicit). Rate-limited (#657). |

**Icon library (#1079):** `GET /static/icons/:name.svg` serves one icon from the platform's own library (Lucide, vendored as `public/static/icons/lucide-icons.json`). Open — no authentication, no roles: icons are not content, and an `<img>` in section text cannot carry a token. `:name` is Lucide's name (`[a-z0-9]+(-[a-z0-9]+)*`); the response is `image/svg+xml` (24 × 24, stroked in the platform's text colour) with `Cache-Control: public, max-age=86400`. An unknown or malformed name gives `404 { "error": "unknown_icon" }`. Section markdown references an icon as `![](icon:<name>)`; the renderer rewrites it to this route and drops unknown names, and the agent-authoring validation reports an unknown name as `unknown_icon` (error).

The participant/preview serve endpoint `GET /api/content-assets/:assetId` accepts an optional `?locale=` query: when a translated SVG variant exists for that locale it is returned, else the original. SVG responses carry `Content-Security-Policy: …; sandbox` + `X-Content-Type-Options: nosniff` as defence-in-depth for direct navigation (#657).

**Layouts (#1079).** An SVG figure can have a narrow layout beside the wide one. `?layout=narrow` asks for it; a figure without one, and an unknown layout name, answer with the wide layout (never an error). Two response headers say what was served and what the figure has, so a client can tell from one request whether asking again at another width is any use:

| Header | Value |
|---|---|
| `X-Asset-Layout` | `wide` or `narrow` — the layout of the file in the response |
| `X-Asset-Layouts` | the layouts the figure has, comma-separated: `wide` or `wide,narrow` |

Language goes before layout: asked for the narrow layout in a language the figure has only in the wide one, the answer is the wide layout in that language (`doc/DECISIONS.md`). Access rules are the same for every layout.

The narrow layout arrives through import and the authoring API as `layoutVariants` on the asset (`[{ "layout": "narrow", "contentBase64": "…", "localizedVariants": [...] }]`), and is carried by export. It is refused with `asset_layout_unknown` (not `narrow`, or given twice), `asset_layout_not_svg` (the asset is a raster image) or `asset_layout_text_mismatch` (its labels differ from the wide figure, in the original or in a translated variant). The validate report of an authoring package reports the same codes at `…assets[n].layoutVariants`. Manual upload in the section editor is unchanged: one file, the wide layout.

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
| `GET` | `/api/admin/platform/failed-assessments` | ADMINISTRATOR — submissions still STUCK after assessment gave up: a FAILED job, no decision, no active job (#953). Self-clearing — a queued retry or a decision removes the row. |
| `POST` | `/api/admin/platform/course-completions/external` | ADMINISTRATOR — registrerer kursbevis for et kurs tatt utenfor plattformen (#1145, `doc/design/PLAN_1145.md`). Body `{ courseId, userIds[≤200], reference, dryRun?, relatedCourseIds?[≤5] }`; **`dryRun` er `true` når feltet mangler**. Svar `{ dryRun, course, results: [{ userId, outcome, certificateId? }] }`, utfall `would_create`/`created`/`exists`/`exists_older_version`/`exists_related_course`/`not_reachable`/`unknown_user`/`busy`. 409 for et upublisert eller arkivert kurs. Én låst transaksjon per person med revisjon (`course_completion_registered_external`); idempotent. Agent-token får 403. Beviset får `source: "external"`, `completedAt: null` i `GET /api/courses/completions[/:id]`, og telles ikke som aktivitet. |
| `POST` | `/api/admin/platform/failed-assessments/:submissionId/retry` | ADMINISTRATOR — re-queues the assessment. 409 if the submission already has a decision. Separate from `POST /api/assessments/:id/run`, which is ownership-scoped to the submitter and returns 404 for an administrator (#953). |

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
| `/participant/completed` | 301 → `/participant` (2.126.0; siden er fjernet) |
| `/review` | REVIEWER, APPEAL_HANDLER, ADMINISTRATOR |
| `/calibration` | Runtime-configurable via `calibrationWorkspace.accessRoles` (default SUBJECT_MATTER_OWNER, ADMINISTRATOR) |
| `/admin-content` | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| `/admin-content/courses` (+ `/courses/new`, `/courses/:id`) | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| `/admin-content/sections` | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| `/results` | SUBJECT_MATTER_OWNER, ADMINISTRATOR, REPORT_READER |
| `/profile` | any authenticated |
| `/admin-platform` | ADMINISTRATOR |

## Domain-rule error codes (#999)

A rule in the domain said no — as opposed to Zod rejecting the request shape. These return `400`
with a code the client can look up, and the numbers the sentence needs as **fields**, not as prose
interpolated into `message`.

| Code | Meaning | `details` |
|---|---|---|
| `content_in_use` | The module or section is part of an **active** course (not archived; published or draft) and cannot be unpublished, archived or deleted. #1149: an archived course no longer stops unpublish or archive, and is not counted or named here | `{ count, courseTitles }` |
| `content_in_archived_course` | #1149: **delete only.** The module or section is part of at least one **archived** course. Deleting counts every course, archived ones too (`CourseItem` → module/section is `onDelete: Restrict`). `courseTitles` names all the courses, `archivedCourseTitles` the archived ones. The way out is to restore the course and take the item out of it | `{ count, courseTitles, archivedCount, archivedCourseTitles }` |
| `content_in_course_draft` | #1150: **archive only** (`POST …/modules/:id/archive`, `POST …/sections/:id/archive`). The module or section is used by at least one active course **only through a saved draft** of it (#1140). `courseTitles` names every course that uses it (list or draft), `draftCourseTitles` those where it is only in the draft; `uses` has one row per course with `via: "course" \| "draft"`. A separate code because `content_in_use`'s text («remove it from the courses, or unpublish them») does not help against a draft. Without drafts the answer is `content_in_use` as before. Unpublish is not affected | `{ count, courseTitles, draftCount, draftCourseTitles, uses }` |
| `content_in_issued_certificate` | The content is named in an issued certificate and can never be deleted | `{ count }` |
| `content_in_legacy_certificate` | The section is in a certificate issued before we recorded what it covered | `{ count }` |
| `course_has_active_participants` | Someone is part-way through the course, so it cannot be retired. #1150 (2a-1): «part-way» is what «Mine kurs» shows as «I gang»: no certificate for the course's **current** major version, not all steps done, and started (a submission on a non-archived module in the course, or a read that counts for the current major version). Whether the course is published, or visible to the participant, is not asked. Same number as `archive-preview`'s `inProgressCount` | `{ count }` |

`message` is unchanged and still carries a Norwegian sentence. It is logged, and it is what an API
consumer without a translation table gets. **It is no longer what a user sees** — the client
formats the sentence from the code and `details`.

⚠️ Every route renders these through one helper (`routes/helpers/respondWithAppError.ts`), which
matches the global error middleware. Fourteen routes previously wrote `{ error, message }` by hand
and dropped `details`; the placeholders then reached the screen unfilled.

Other guards still throw `validation_error` with prose, and the client still falls back to showing
that `message`. That fallback shrinks as more guards get codes — it is not a licence to add new
prose-only errors.
