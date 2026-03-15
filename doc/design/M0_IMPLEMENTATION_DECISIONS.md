# M0 Implementation Decisions

## Scope
This document captures design and architecture decisions for M0 implementation:
- `#9` Entra ID login + RBAC bootstrap
- `#10` Core data model + migration baseline
- `#11` Module and active version APIs
- `#12` Borderline/manual review discovery baseline

## Design Decisions

### 1) Backend baseline
- Chosen: Node.js + TypeScript + Express.
- Why: fast bootstrap, low ceremony, simple API layering.

### 2) Data model and traceability
- Chosen: Prisma schema modeling all core entities in the design note.
- Why: maintain explicit relationships from submission -> versions -> decisions.
- Additional decision: `AssessmentDecision` stores explicit version references (`moduleVersionId`, `rubricVersionId`, `promptTemplateVersionId`) to strengthen auditability.

### 3) Migration strategy for this environment
- Chosen: SQL migration files in `prisma/migrations/*` + repository migration runner (`src/scripts/applyMigrations.ts`).
- Why: Prisma schema-engine migration commands were unstable in this environment; SQL-based runner provides deterministic setup.

### 4) Auth + RBAC
- Chosen: dual auth mode:
- `AUTH_MODE=mock` for local development and test automation.
- `AUTH_MODE=entra` for JWT validation against Microsoft Entra.
- Why: unblock development while preserving enterprise integration path.
- RBAC source of truth: `RoleAssignment` in database with validity window.

### 5) Module API behavior
- Chosen: participant reads only active, published, and valid modules.
- Admin-like roles can read all modules.
- Why: enforce module lifecycle and avoid accidental access to unpublished content.

## Refactor Evaluation
- No pre-existing application code existed, so major refactor was not applicable.
- Minor complexity reduction applied:
- centralized user-role resolution in `userRepository`.
- centralized module visibility logic in `moduleRepository`.
- centralized auth mode handling in `authenticate` middleware.

## Configuration-First Decisions
Moved to config/env:
- Auth mode and Entra audience/tenant.
- Default mock user identity values.
- Database URL and runtime port.

## Testing Decisions
- Added integration tests for:
- `/api/me` role resolution.
- module listing and active-version retrieval.
- RBAC denial without roles.
- Added CI workflow running migration + seed + lint + test + build.

## Deferred / Follow-up
- Replace SQLite bootstrap with managed PostgreSQL in staging/production.
- Add admin APIs for role assignment management (currently seeded/manual).
- Add audit-event persistence hooks in write paths (currently M0 focus is read/auth/model baseline).

