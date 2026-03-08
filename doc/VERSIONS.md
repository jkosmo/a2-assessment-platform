# Versions

This document tracks release versions and what each version includes.

## Versioning Rules
- Use Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Every push to remote must include a version bump.
- Every version bump must update this document.

## 0.3.6 - 2026-03-08
### Summary
Replaced startup migration mechanism to avoid `node:sqlite` runtime incompatibility.

### Included
- Changed `prestart` from custom SQLite migration script to `prisma migrate deploy`.
- Moved `prisma` package to runtime dependencies to guarantee CLI availability in deployed app.

### Notes
- Startup no longer depends on Node built-in `node:sqlite`.

## 0.3.5 - 2026-03-08
### Summary
Fixed runtime entrypoint mismatch in deployment artifact.

### Included
- Updated `start` script from `node dist/index.js` to `node dist/src/index.js`.

### Notes
- Deployment artifact structure from TypeScript build places the entrypoint at `dist/src/index.js`.
- Previous mismatch could terminate app startup immediately in App Service.

## 0.3.4 - 2026-03-08
### Summary
Startup probe compatibility fixes for Azure App Service.

### Included
- Added root endpoint `GET /` returning `200` to satisfy warmup/startup probing.
- Added explicit App Service port settings (`PORT=8080`, `WEBSITES_PORT=8080`) in Bicep app settings.

### Notes
- This targets recurring “site failed to start” deployment failures despite successful package deployment.

## 0.3.3 - 2026-03-08
### Summary
App Service startup strategy updated to use platform default Node startup path.

### Included
- Added `prestart` script in `package.json` to run runtime migrations before app boot.
- Removed custom `appCommandLine` override in Bicep and delegated startup to default `npm start` behavior.

### Notes
- This avoids custom startup command edge cases and keeps migration logic tied to app lifecycle.

## 0.3.2 - 2026-03-08
### Summary
Startup command fix for App Service Linux deployment.

### Included
- Updated App Service startup command in Bicep to ensure execution happens from app root:
- `cd /home/site/wwwroot && npm run db:migrate:runtime && npm run start`

### Notes
- This targets startup failures where `npm` runs outside the deployed application directory.

## 0.3.1 - 2026-03-08
### Summary
Staging deployment reliability fixes for GitHub Actions and App Service startup.

### Included
- Deployment script hardening:
- Robust temp directory resolution in Linux/Windows runners.
- Explicit native command exit-code checks with fail-fast behavior.
- Build deployment artifact before packaging (`npm ci`, Prisma client generation, TypeScript build).
- Prune dev dependencies before zip to keep runtime package leaner.
- CI/CD workflow update:
- Added concurrency control to avoid overlapping staging deployments and Kudu deployment locks.

### Notes
- This release addresses deployment failures caused by missing built artifacts in Run-From-Package deployments.

## 0.3.0 - 2026-03-08
### Summary
Completed implementation of next-step tracks: dev-tenant auth hardening and Azure staging/production automation baseline.

### Included
- Dev-tenant auth enhancements:
- Hardened Entra bootstrap script with API scope + client delegated permission setup.
- Generated role-map file support for safer config-based mapping.
- Extended onboarding/smoke-test guide for testers.
- Added automated integration test for group-claim to role mapping.
- Azure provisioning/deployment automation baseline:
- Bicep template for cost-optimized App Service deployment per environment.
- End-to-end deployment script for dedicated RG per environment.
- Optional budget/alert cost-guardrail script.
- GitHub Actions workflow for staging auto-deploy and production manual approval gate.
- Azure environment plan and runbook docs.
- Runtime migration script for deployed environments.

### Notes
- Production approval enforcement depends on GitHub Environment protection settings.
- Dev-tenant auth issues remain open until tenant-side validation is completed.

## 0.2.0 - 2026-03-08
### Summary
Parallel implementation of track A (dev-tenant auth setup baseline) and track B (M1 core assessment flow).

### Included
- M1 core flow backend:
- submission creation API with required-field validation
- MCQ start/submit endpoints with deterministic scoring
- async assessment job queue/worker orchestration
- strict LLM structured assessment contract (stub mode)
- backend decision engine with config-driven thresholds and manual-review routing
- assessment/result endpoints
- Manual participant test console:
- `/participant` UI for module -> submission -> MCQ -> assessment -> result flow
- Dev-tenant auth setup baseline:
- Entra group-claim to app-role sync support (config-driven)
- bootstrap script for dev tenant app registrations/groups (`scripts/entra/setup-dev-tenant-auth.ps1`)
- onboarding and smoke-test documentation (`doc/DEV_TENANT_AUTH_ONBOARDING.md`)
- New config assets:
- `config/assessment-rules.json`
- `config/entra-group-role-map.example.json`
- Added M1 flow integration tests and kept M0 tests green.

### Notes
- `LLM_MODE=azure_openai` is scaffolded but not implemented yet.
- Follow-up hardening and rollout tracking remains in open issues.

## 0.1.1 - 2026-03-08
### Summary
Dev-tenant Entra authentication target design for shared development/testing.

### Included
- New design document for issue `#37`:
- `doc/DEV_TENANT_AUTH_TARGET_DESIGN.md`
- Defined target architecture (API app + client app, issuer/audience contract).
- Defined required Entra objects, naming conventions, and ownership model.
- Defined explicit dev/prod tenant separation policy.
- Defined rollout plan from `AUTH_MODE=mock` to `AUTH_MODE=entra`.
- Linked new design document from README.

### Notes
- Follow-up execution is tracked in `#40`, `#38`, and `#39`.

## 0.1.0 - 2026-03-08
### Summary
Initial M0 foundation release.

### Included
- Backend bootstrap with TypeScript + Express.
- Authentication and RBAC foundation (`mock` and `entra` mode).
- Core relational schema and migration baseline.
- Module and active-version read APIs.
- Seed data for local/test setup.
- M0 discovery decision for borderline/manual review routing.
- Basic CI workflow (lint, test, build).

### Notes
- Migration execution is done through repository migration scripts in this version.
