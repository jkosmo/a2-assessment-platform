# PostgreSQL Migration Plan for Prisma Runtime Parity (#91)

## Context
The current repo has an architecture mismatch:
- `prisma/schema.prisma` uses `provider = "sqlite"`
- local and test environments default to `file:` database URLs
- migration/reset scripts use `node:sqlite`
- Azure deployment still points `DATABASE_URL` at a SQLite file path

At the same time, the architecture documentation states PostgreSQL-compatible production as the target shape.

This note defines a safe migration plan. It is not the migration itself.

## Current backlog decision
Decision updated: `2026-03-13`

Current recommendation:
- keep SQLite only as a temporary dev/staging bridge
- do not treat PostgreSQL as optional for production anymore
- priority: raise from `Pri-4` backlog to pre-production readiness work
- target: complete before any production go-live decision

Reasoning for the change:
- expected scale is still modest, approximately 60 total users
- the solution is still explicitly non-critical
- however, staging has now shown repeated SQLite/App Service operational failures
- the observed failures were not hypothetical lock noise; they included:
  - `disk I/O error`
  - `database disk image is malformed`
  - `unable to open database file`
- staging recovery required deleting the SQLite file and rebuilding the environment
- a follow-on bootstrap/request race then caused `Unique constraint failed on the fields: (email)` during user creation

This means `#91` is no longer only an architectural cleanup item. It is now a documented operational risk that should block production use on the current storage model.

## Current coupling points
Files that currently assume SQLite:
- `prisma/schema.prisma`
- `.env.example`
- `.env.test`
- `src/scripts/applyMigrations.ts`
- `scripts/runtime/applyMigrations.mjs`
- `src/scripts/resetDatabase.ts`
- `src/scripts/dbUrl.ts`
- `scripts/runtime/dbUrl.mjs`
- `.github/workflows/ci.yml`
- `infra/azure/main.bicep`

Operational consequence:
- local/test runtime behavior does not match target production database semantics
- reset and migration flow depends on SQLite file deletion and manual SQL replay
- CI cannot validate PostgreSQL-specific schema behavior today

## Risks of changing this in one step
- Prisma schema/provider change can invalidate existing local/test bootstrap assumptions
- manual migration scripts based on `node:sqlite` will stop working immediately
- CI may fail before replacement database orchestration exists
- runtime deploy can break if Azure still points to a file-backed `DATABASE_URL`

## Reasons to stay on SQLite temporarily
For the current workload profile, SQLite still has real short-term advantages:
- lowest runtime cost because there is no separate managed database service
- simpler local developer bootstrap
- fewer moving parts while finishing feature and UX work

But the threshold for moving has now been crossed for production planning:
- observed staging pain is no longer hypothetical
- the current runtime/storage model has already shown corruption and recovery fragility
- any continued SQLite use should be framed as a temporary bridge, not an acceptable production target

## Symptoms that should trigger re-evaluation
Re-open active PostgreSQL implementation work if one or more of these appear in staging or production:

### Concurrency and correctness symptoms
- frequent `SQLITE_BUSY`, `database is locked`, or equivalent write-contention failures
- queue-processing delays that correlate with concurrent writes
- requests that intermittently fail only under overlapping submission/review/appeal activity

### Performance symptoms
- sustained increase in API latency during normal work hours with database access as the likely bottleneck
- participant flow feels slow specifically on write-heavy steps such as submission creation, MCQ submit, manual-review override, or appeal resolution
- background jobs lag even when CPU and network look healthy

### Operational symptoms
- inability to run more than one app instance safely because of file-backed database constraints
- difficulty backing up, restoring, or inspecting production data confidently
- deploys or restarts create database-file risk, corruption concern, or operational fragility
- database file growth becomes awkward to manage operationally

Observed in staging on `2026-03-13`:
- database corruption and file access failures did occur
- restart/reset recovery was needed to restore service
- request traffic could race bootstrap seed and create secondary integrity failures

### Product and reporting symptoms
- reporting/export workloads start interfering with normal transactional use
- calibration, reporting, or admin workflows need heavier querying than SQLite handles comfortably
- audit/compliance or retention tooling becomes too hard to implement safely on the current engine

## Symptom watch list
Practical signals to monitor:
- error logs containing SQLite lock/busy messages
- increased request duration on:
  - `POST /api/submissions`
  - `POST /api/modules/:moduleId/mcq/submit`
  - `POST /api/reviews/:reviewId/override`
  - `POST /api/appeals/:appealId/resolve`
- assessment queue backlog growth without corresponding CPU saturation
- staging/production pressure to scale out App Service horizontally

If these stay absent, staying on SQLite remains the lower-risk choice.

## Recommended migration strategy
Do this in controlled slices, not one large branch.

### Slice 1: Introduce PostgreSQL-ready tooling without switching default runtime
Goals:
- add PostgreSQL-compatible reset/migrate path
- keep current SQLite flow temporarily available while CI and local developer flow are updated

Work:
- add PostgreSQL env examples for local/test
- introduce reset/migrate utilities that work via Prisma commands or SQL client against PostgreSQL
- stop adding new SQLite-specific helper logic

Exit criteria:
- repo supports both legacy SQLite bootstrap and parallel PostgreSQL bootstrap for a short transition window

### Slice 2: Move Prisma datasource provider to PostgreSQL
Goals:
- align Prisma schema with target engine
- generate client against PostgreSQL provider

Work:
- change `datasource db.provider` to `postgresql`
- review schema types and defaults for PostgreSQL compatibility
- regenerate migrations from a PostgreSQL baseline if current SQL is SQLite-specific

Exit criteria:
- schema, generated client, and migrations are PostgreSQL-valid

### Slice 3: Replace reset/migrate scripts
Goals:
- remove `node:sqlite` dependency from app and runtime scripts

Work:
- replace `src/scripts/applyMigrations.ts` with Prisma-native migration application
- replace `scripts/runtime/applyMigrations.mjs` with non-SQLite runtime-safe logic
- replace `src/scripts/resetDatabase.ts` with database/schema reset for test/local PostgreSQL only
- delete `dbUrl` helpers once no longer needed

Exit criteria:
- no runtime or developer script imports `node:sqlite`
- no script depends on file-path database URLs

### Slice 4: Update CI to run against PostgreSQL
Goals:
- CI validates the real target engine

Work:
- provision PostgreSQL service container in GitHub Actions or equivalent CI dependency
- update `.env.test` and CI secrets/vars to use PostgreSQL connection strings
- run generate, migrate, seed, tests, and build against PostgreSQL

Exit criteria:
- CI green with PostgreSQL-only test path

### Slice 5: Update Azure runtime provisioning
Goals:
- deployed runtime matches architecture target

Work:
- stop provisioning SQLite file path in App Service app settings
- provision or connect to Azure Database for PostgreSQL
- inject PostgreSQL `DATABASE_URL`
- verify migrations run safely on deploy

Exit criteria:
- staging runtime uses PostgreSQL end to end
- production rollout can be gated after staging verification

### Slice 6: Remove legacy SQLite path
Goals:
- eliminate dual-mode ambiguity

Work:
- remove SQLite env examples and helpers
- remove fallback docs that still describe SQLite as the normal development/test path
- update README and architecture references

Exit criteria:
- repo has one supported relational engine path across dev/test/stage/prod

## Implementation details by area
### Prisma and schema
Review for PostgreSQL semantics:
- enum handling
- timestamp/default behavior
- string/text size assumptions
- index compatibility
- migration SQL generated by Prisma rather than hand-replayed SQLite DDL where possible

### Developer bootstrap
Recommended local development baseline:
- PostgreSQL via container or local service
- `DATABASE_URL=postgresql://...`
- one documented bootstrap path in README

### Test strategy
Recommended test baseline:
- integration tests always use PostgreSQL
- unit tests remain DB-agnostic where possible
- no SQLite-only pretest hooks

### Runtime migration behavior
Preferred approach:
- use Prisma migration deployment tooling rather than custom SQL replay in runtime startup
- keep startup idempotent and explicit
- do not keep hand-maintained engine-specific migration runners once PostgreSQL is adopted

## File-by-file migration checklist
| File | Required change |
| --- | --- |
| `prisma/schema.prisma` | switch provider to `postgresql` |
| `.env.example` | replace `file:` URL with PostgreSQL example |
| `.env.test` | replace `file:` URL with PostgreSQL test URL |
| `src/scripts/applyMigrations.ts` | remove `node:sqlite` runner |
| `scripts/runtime/applyMigrations.mjs` | remove `node:sqlite` runner |
| `src/scripts/resetDatabase.ts` | replace file deletion reset with PostgreSQL reset |
| `.github/workflows/ci.yml` | add PostgreSQL service/dependency and updated env |
| `infra/azure/main.bicep` | stop setting SQLite file URL; wire PostgreSQL connection |
| `README.md` | document new bootstrap and testing flow |
| `doc/ARCHITECTURE.md` | remove engine-mismatch debt note when resolved |

## Verification plan
Minimum verification before merge:
1. Local bootstrap works from empty PostgreSQL database.
2. `npm run prisma:generate` succeeds.
3. `npm run db:migrate` succeeds.
4. `npm run prisma:seed` succeeds.
5. `npm test` succeeds against PostgreSQL.
6. CI succeeds with PostgreSQL service.
7. Staging deploy succeeds with PostgreSQL-backed runtime.
8. Smoke test participant, reviewer, appeal, reporting, and admin-content flows in staging.

## Rollback boundaries
Safe rollback before Slice 5:
- revert CI/dev changes while production/runtime remains unchanged

Safe rollback after Slice 5 only if:
- SQLite path still exists in parallel, or
- staging-only migration is isolated from production

Unsafe rollback:
- switching production/staging runtime to PostgreSQL without a reversible deploy plan or verified backup/export path

## Recommendation
Current recommendation:
- continue using SQLite only as a short-lived bridge while finishing validation and non-production work
- do not go to production on App Service + file-backed SQLite
- treat `#91` as required pre-production work, not optional backlog polish

The symptoms above are no longer hypothetical; staging has already exhibited them. The remaining question is sequencing, not whether the migration is justified.

Recommended order:
1. CI/test PostgreSQL bootstrap
2. script replacement
3. Prisma provider switch
4. Azure runtime wiring
5. SQLite cleanup

This keeps the blast radius smaller and lets staging validate the engine change before production is affected.
