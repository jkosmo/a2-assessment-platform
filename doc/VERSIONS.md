# Versions

This document tracks release versions and what each version includes.

## Versioning Rules
- Use Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Every push to remote must include a version bump.
- Every version bump must update this document.

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
