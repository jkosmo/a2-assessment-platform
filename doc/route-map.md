# Pilot Route and Workspace Map

This map covers all admin-content entry points and their status for pilot. Use it for support, testing, and onboarding.

## Admin content workspaces

| Route | Workspace | HTML file | Status |
|---|---|---|---|
| `/admin-content` | Module library (root) | `admin-content-library.html` | **Canonical** |
| `/admin-content/module/:moduleId/conversation` | Module — conversational editor | `admin-content.html` | **Canonical** |
| `/admin-content/module/:moduleId/advanced` | Module — advanced editor | `admin-content-advanced.html` | **Canonical** |
| `/admin-content/courses` | Course list | `admin-content-courses.html` | **Canonical** |
| `/admin-content/courses/new` | New course (conversational flow) | `admin-content-courses.html` | **Canonical** |
| `/admin-content/courses/:courseId` | Course detail | `admin-content-courses.html` | **Canonical** |
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
| `/participant/completed` | Completed assessment result view |
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
| `/api/courses` | Participant | Browse enrolled courses |
| `/api/me` | All | Current user identity and roles |
| `/api/reviews` | Reviewer / Admin | Manual review queue and override |
| `/api/appeals` | Appeal Handler / Admin | Appeal queue and resolution |
| `/api/admin/content` | SMO / Admin | Module and course content management |
| `/api/admin/platform` | Admin | Platform administration |
| `/participant/config` | Public (rate-limited) | Participant console bootstrap config |
| `/healthz` | Public | Health check (no version info) |
