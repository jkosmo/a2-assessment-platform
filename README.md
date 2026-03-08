# A2 Assessment Platform

Backend implementation currently covers:
- `#9` Entra login + RBAC bootstrap
- `#10` Core data model + migrations with version traceability
- `#11` Module + active version APIs
- `#12` Borderline routing discovery baseline
- `#13` Participant module overview (manual test UI)
- `#14` Submission API with required field validation
- `#15` MCQ start/submit with deterministic scoring
- `#16` LLM assessment stub
- `#17` LLM contract with strict schema validation
- `#18` Backend decision engine with thresholds/manual-review routing
- `#19` Async assessment job orchestration
- `#37` Dev tenant auth target design

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

## API
- `GET /healthz`
- `GET /api/me`
- `GET /api/modules`
- `GET /api/modules/:moduleId`
- `GET /api/modules/:moduleId/active-version`
- `GET /api/modules/:moduleId/mcq/start?submissionId=<id>`
- `POST /api/modules/:moduleId/mcq/submit`
- `POST /api/submissions`
- `GET /api/submissions/:submissionId`
- `GET /api/submissions/:submissionId/result`
- `POST /api/assessments/:submissionId/run`
- `GET /api/assessments/:submissionId`
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
