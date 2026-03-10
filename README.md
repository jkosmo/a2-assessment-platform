# A2 Assessment Platform

Current implementation includes MVP core flow, governance flow, and observability baseline:
- Foundation auth/RBAC with mock + Entra modes.
- Module/version retrieval and participant flow (submission + MCQ + assessment result).
- Decision engine, async assessment worker, audit event pipeline.
- Manual review and appeal workspace flow with immutable decision lineage.
- Reporting endpoints + CSV export (completion, pass rates, manual review queue, appeals).
- Admin content publication flow for rubric/prompt/MCQ/module versions.
- Internationalization baseline (`en-GB`, `nb`, `nn`) for participant UI and key API payloads.
- Azure deployment baseline (staging auto deploy, production approval gate, alerts/runbooks).

## Tech
- Node.js + TypeScript + Express
- Prisma ORM
- SQLite (development bootstrap)

## Setup
1. Copy env file:
```bash
cp .env.example .env
```

2. Install dependencies:
```bash
npm install
```

3. Generate Prisma client and run migration:
```bash
npm run prisma:generate
npm run db:reset
npm run db:migrate
```

4. Seed baseline data:
```bash
npm run prisma:seed
```

5. Start app:
```bash
npm run dev
```

## Automated Testing
- Local:
```bash
npm run lint
npm test
npm run build
```
- CI:
  - Workflow: `.github/workflows/ci.yml`
  - Runs on PR + push to `main`.
  - Includes Prisma generate, migrate/seed against `.env.test`, type-check, tests, and build.

## Deploy and Runtime Automation
- CI/CD deploy workflow: `.github/workflows/deploy-azure.yml`
- `main` push: automatic staging deploy.
- Production deploy: manual `workflow_dispatch` with environment approval gate.
- Infrastructure as code: `infra/azure/main.bicep`
- Deploy script: `scripts/azure/deploy-environment.ps1`

## API
- `GET /healthz`
- `GET /version`
- `GET /participant/config`
- `GET /api/me`
- `GET /api/modules`
- `GET /api/modules/completed?limit=<n>`
- `GET /api/modules/:moduleId`
- `GET /api/modules/:moduleId/active-version`
- `GET /api/modules/:moduleId/mcq/start?submissionId=<id>`
- `POST /api/modules/:moduleId/mcq/submit`
- `POST /api/submissions`
- `GET /api/submissions/history?limit=<n>`
- `POST /api/submissions/:submissionId/appeals`
- `GET /api/submissions/:submissionId`
- `GET /api/submissions/:submissionId/result`
- `POST /api/assessments/:submissionId/run`
- `GET /api/assessments/:submissionId`
- `GET /api/audit/submissions/:submissionId`
- `GET /api/reviews`
- `GET /api/reviews/:reviewId`
- `POST /api/reviews/:reviewId/claim`
- `POST /api/reviews/:reviewId/resolve`
- `GET /api/appeals`
- `GET /api/appeals/:appealId`
- `POST /api/appeals/:appealId/claim`
- `POST /api/appeals/:appealId/resolve`
- `GET /api/calibration/workspace?moduleId=<id>&status=<csv>&moduleVersionId=<id>&dateFrom=<ISO>&dateTo=<ISO>&limit=<n>`
- `GET /api/reports/completion`
- `GET /api/reports/pass-rates`
- `GET /api/reports/manual-review-queue`
- `GET /api/reports/appeals`
- `GET /api/reports/mcq-quality`
- `GET /api/reports/recertification`
- `POST /api/reports/recertification/reminders/run?asOf=<ISO-date>`
- `GET /api/reports/analytics/semantic-model`
- `GET /api/reports/analytics/trends?granularity=<day|week|month>`
- `GET /api/reports/analytics/cohorts?cohortBy=<month|department>`
- `GET /api/reports/analytics/data-quality`
- `GET /api/reports/export?type=<report>&format=csv`
- `POST /api/admin/content/modules`
- `POST /api/admin/content/modules/:moduleId/rubric-versions`
- `POST /api/admin/content/modules/:moduleId/prompt-template-versions`
- `POST /api/admin/content/modules/:moduleId/benchmark-example-versions`
- `POST /api/admin/content/modules/:moduleId/mcq-set-versions`
- `POST /api/admin/content/modules/:moduleId/module-versions`
- `POST /api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/publish`
- `POST /api/admin/sync/org/delta`
- `GET /participant` (manual participant test UI)
- `GET /participant/completed` (manual completed-modules UI)
- `GET /appeal-handler` (manual appeal-handler workspace UI)
- `GET /calibration` (manual calibration workspace UI)
- `GET /admin-content` (manual content-management workspace UI)

## Auth modes
- `AUTH_MODE=mock` (default for local development)
- `AUTH_MODE=entra` (JWT validation against Microsoft Entra ID)

In mock mode, optional headers can override identity:
- `x-user-id`
- `x-user-email`
- `x-user-name`
- `x-user-department`
- `x-user-roles` (comma-separated app roles)
- `x-user-groups` (comma-separated Entra group object IDs)

## Manual testing
1. Start backend:
```bash
npm run dev
```

2. Open participant console:
```text
http://localhost:3000/participant
```

3. Run flow:
- Load modules
- Create submission (MCQ starts automatically)
- Submit MCQ
- Queue/check assessment
- Check result
- Create participant appeal (after `COMPLETED` result)

Submission parser behavior:
- `POST /api/submissions` supports optional attachment parsing fields:
  - `attachmentBase64`
  - `attachmentFilename`
  - `attachmentMimeType`
- PDF and DOCX attachments are parsed into submission `rawText`.
- If parsing fails and `rawText` is provided, `rawText` is used as fallback.
- If parsing fails without fallback text, API returns a clear parse error message.

4. Optional completed-modules view (`PARTICIPANT` role):
```text
http://localhost:3000/participant/completed
```
- Load module history and verify latest completion score/status per module

5. Optional handler flow in dedicated workspace (`APPEAL_HANDLER`/`ADMINISTRATOR` role):
```text
http://localhost:3000/appeal-handler
```
- Queue auto-loads open/in-review appeals on page load; use status filter (`OPEN`, `IN_REVIEW`, optional `RESOLVED`) as needed
- Use queue search for participant/module/appeal filtering
- Select an appeal row and run `Claim Appeal`
- Resolve using decision reason + resolution note + pass/fail value

6. Optional calibration flow in dedicated workspace (`SUBJECT_MATTER_OWNER`/`ADMINISTRATOR` role):
```text
http://localhost:3000/calibration
```
- Enter `moduleId` and load calibration snapshot
- Use status/date/module-version filters to inspect historical outcomes
- Review benchmark-anchor coverage and quality-signal flags

7. Optional admin content flow in dedicated workspace (`SUBJECT_MATTER_OWNER`/`ADMINISTRATOR` role):
```text
http://localhost:3000/admin-content
```
- Create a base module (title/description/certification/validity window)
- Load/select module
- Create rubric/prompt/MCQ versions from JSON fields
- Create module version by linking created version IDs
- Publish module version

Participant console behavior is config-driven via:
- `config/participant-console.json`
- env key `PARTICIPANT_CONSOLE_CONFIG_FILE`
- `navigation.items[]` controls shared top-menu entries and per-role visibility
- `appealWorkspace.queuePageSize` controls `/appeal-handler` queue fetch limit (max `200`)
- `flow.autoStartAfterMcq`, `flow.pollIntervalSeconds`, `flow.maxWaitSeconds` control auto assessment start/polling in participant UI
  - when `flow.autoStartAfterMcq=true`, manual assessment buttons are hidden in participant UI
- `calibrationWorkspace.accessRoles` controls API access roles for `/api/calibration/workspace`
- `calibrationWorkspace.defaults.statuses`, `lookbackDays`, `maxRows` control default query behavior
- `calibrationWorkspace.signalThresholds` controls pass/manual-review/benchmark-coverage flags
- `identityDefaults.participant`, `identityDefaults.appealHandler`, `identityDefaults.calibrationOwner`, and `identityDefaults.contentAdmin` set default test identity per workspace

LLM provider mode is env-driven via:
- `LLM_MODE=stub|azure_openai`
- Stub mode:
  - `LLM_STUB_MODEL_NAME`
- Azure OpenAI mode:
  - `AZURE_OPENAI_ENDPOINT`
  - `AZURE_OPENAI_API_KEY`
  - `AZURE_OPENAI_DEPLOYMENT`
  - `AZURE_OPENAI_API_VERSION` (default `2024-10-21`)
  - `AZURE_OPENAI_TIMEOUT_MS` (default `30000`)
  - `AZURE_OPENAI_TEMPERATURE` (default `0`)
  - `AZURE_OPENAI_MAX_TOKENS` (default `1200`)
  - `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER` (`max_tokens` | `max_completion_tokens` | `auto`, default `auto`)

Azure OpenAI compatibility note:
- for `gpt-5-nano`, use:
  - `AZURE_OPENAI_TEMPERATURE=1`
  - `AZURE_OPENAI_MAX_TOKENS=4000`
  - `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`

Sensitive-data preprocessing before LLM evaluation is config-driven via:
- `config/assessment-rules.json`
- `sensitiveData.enabledByDefault` toggles masking baseline
- `sensitiveData.moduleOverrides.<moduleId>` enables/disables masking per module
- `sensitiveData.rules[]` defines detection regex patterns and replacement tokens

Secondary LLM assessment policy is config-driven via:
- `config/assessment-rules.json`
- `secondaryAssessment.enabledByDefault` toggles second-pass behavior globally
- `secondaryAssessment.moduleOverrides.<moduleId>` enables/disables second-pass per module
- `secondaryAssessment.triggerRules` controls when a second pass should run
- `secondaryAssessment.disagreementRules` controls when pass disagreement must route to manual review

Recertification policy is config-driven via:
- `config/assessment-rules.json`
- `recertification.validityDays` controls certification validity period
- `recertification.dueOffsetDays` controls when recertification becomes due before expiry
- `recertification.dueSoonDays` controls early warning status window
- `recertification.reminderDaysBefore[]` controls pre-expiry reminder schedule offsets

Advanced analytics reporting model is config-driven via:
- `config/reporting-analytics.json`
- `kpiDefinitions[]` defines semantic KPI catalog metadata
- `trends.*` controls trend granularity behavior
- `cohorts.*` controls cohort dimensions
- `dataQuality.*` controls pipeline quality thresholds

Benchmark example versioning policy is config-driven via:
- `config/benchmark-examples.json`
- `maxExamplesPerVersion` limits benchmark anchor set size
- `maxTextLength` limits benchmark text field size
- `requiredFields` enforces benchmark example structure

Org delta sync policy is config-driven via:
- `config/org-sync.json`
- `conflictStrategy` controls identity collision handling (`merge_by_email` / `skip_conflict`)
- `allowDepartmentOverwrite`, `allowManagerOverwrite`, `defaultActiveStatus` control update behavior

Module completion policy is config-driven via:
- `config/module-completion.json`
- `completedSubmissionStatuses` defines what counts as completed
- `hideCompletedInAvailableByDefault` controls `/api/modules` default filtering
- `defaultCompletedHistoryLimit`, `maxCompletedHistoryLimit` control `/api/modules/completed` pagination defaults/bounds

Seed baseline now includes two modules for multi-module flow checks:
- `Generative AI Foundations`
- `AI Governance and Risk Essentials`

## Discovery output
Borderline/manual review routing baseline is documented in:
- `doc/M0_BORDERLINE_ROUTING.md`

M0 architecture and implementation decisions are documented in:
- `doc/M0_IMPLEMENTATION_DECISIONS.md`

M1 implementation decisions are documented in:
- `doc/M1_IMPLEMENTATION_DECISIONS.md`

Version history is tracked in:
- `doc/VERSIONS.md`

Dev-tenant Entra auth target design is documented in:
- `doc/DEV_TENANT_AUTH_TARGET_DESIGN.md`

Dev-tenant auth onboarding and smoke tests are documented in:
- `doc/DEV_TENANT_AUTH_ONBOARDING.md`

Dev-tenant auth bootstrap script:
- `scripts/entra/setup-dev-tenant-auth.ps1`

Azure staging/production runbook:
- `doc/AZURE_ENVIRONMENTS.md`

Azure deployment workflow:
- `.github/workflows/deploy-azure.yml`

Internationalization baseline and translation workflow:
- `doc/I18N.md`

Appeals operating process (SLA, ownership, escalation):
- `doc/APPEALS_OPERATING_MODEL.md`

Observability and incident response runbook:
- `doc/OBSERVABILITY_RUNBOOK.md`

Phase-2 design note for participant appeal notifications:
- `doc/PHASE2_APPEAL_NOTIFICATIONS_DESIGN.md`

Org sync conflict/override strategy:
- `doc/ORG_SYNC_CONFLICT_STRATEGY.md`

Phase-2 design note for Azure OpenAI assessment integration:
- `doc/PHASE2_AZURE_OPENAI_INTEGRATION.md`

Phase-2 design note for admin content workspace:
- `doc/PHASE2_ADMIN_CONTENT_WORKSPACE_DESIGN.md`
