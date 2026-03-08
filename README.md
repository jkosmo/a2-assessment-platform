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
- `GET /api/me`
- `GET /api/modules`
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
- `GET /api/reports/completion`
- `GET /api/reports/pass-rates`
- `GET /api/reports/manual-review-queue`
- `GET /api/reports/appeals`
- `GET /api/reports/export?type=<report>&format=csv`
- `POST /api/admin/content/modules/:moduleId/rubric-versions`
- `POST /api/admin/content/modules/:moduleId/prompt-template-versions`
- `POST /api/admin/content/modules/:moduleId/mcq-set-versions`
- `POST /api/admin/content/modules/:moduleId/module-versions`
- `POST /api/admin/content/modules/:moduleId/module-versions/:moduleVersionId/publish`
- `GET /participant` (manual test UI)

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
- Create submission
- Start and submit MCQ
- Queue/check assessment
- Check result

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
