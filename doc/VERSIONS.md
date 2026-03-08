# Versions

This document tracks release versions and what each version includes.

## Versioning Rules
- Use Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Every push to remote must include a version bump.
- Every version bump must update this document.

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
