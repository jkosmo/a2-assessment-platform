# API Reference

All `/api/*` routes require authentication. In `AUTH_MODE=mock`, use the `x-user-roles` header to set roles. In `AUTH_MODE=entra`, a valid JWT is required.

Role requirements per route group are enforced by the RBAC middleware and the canonical capability contract in `src/config/capabilities.ts`. See [DOMAIN_LIFECYCLE.md](DOMAIN_LIFECYCLE.md) for the full ownership model.

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
| `GET` | `/api/admin/content/modules/:moduleId/export` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `DELETE` | `/api/admin/content/modules/:moduleId` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/generate/module-draft` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |
| `POST` | `/api/admin/content/generate/mcq` | ADMINISTRATOR, SUBJECT_MATTER_OWNER |

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
| `/results` | SUBJECT_MATTER_OWNER, ADMINISTRATOR, REPORT_READER |
| `/profile` | any authenticated |
| `/admin-platform` | ADMINISTRATOR |
