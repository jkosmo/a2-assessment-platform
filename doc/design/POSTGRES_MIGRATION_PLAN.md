# PostgreSQL Migration Plan for Prisma Runtime Parity (#91)

## Context
Status updated: `2026-03-19`

The repo has now completed the local/test provider switch:
- `prisma/schema.prisma` now uses `provider = "postgresql"`
- local and test environments now default to PostgreSQL connection strings
- the old SQLite-specific reset/migrate runners are no longer part of the default flow
- CI now validates the PostgreSQL bootstrap path

Staging has now also been recovered and verified on the PostgreSQL-backed runtime:
- `GET /healthz` -> `200`
- `GET /version` -> `200`
- `GET /` -> `200`
- core stage UI pages and static assets load successfully

The repo now also carries a formal PostgreSQL migration baseline:
- legacy SQLite-era Prisma migrations have been archived under `prisma/migrations_sqlite_legacy/`
- `prisma/migrations/` now starts from a PostgreSQL baseline migration
- runtime startup now prefers `prisma migrate deploy`
- a temporary non-production compatibility fallback to `prisma db push` exists for already-provisioned environments while they are converged onto the new migration chain

The remaining delivery gap is now split in two:
- this note / `#91`: staging validation follow-up plus final SQLite/doc cleanup
- production onboarding and rollout: tracked separately in `#154 EPIC: Produksjonssetting`

Within `#91`, the remaining delivery gap is concentrated in staging hardening and cleanup:
- repo-default Azure provisioning now targets Azure Database for PostgreSQL Flexible Server
- protected staging flow verification still needs to be completed with the right Entra-access path
- the recovery deployment should be converged back to the intended automated deploy/runtime shape

At the same time, the architecture documentation states PostgreSQL-compatible production as the target shape.

This note defines a safe migration plan. It is not the migration itself.

> **Source of truth for issue #91:** keep this document in sync with the GitHub issue so the issue description can remain a concise summary of the current plan, progress, and remaining work.

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
Active remaining rollout follow-up points:
- staging protected flows still need broader smoke verification under real Entra-authenticated access
- staging should be redeployed once through the intended automated path and re-verified
- production access/provisioning/deploy work now lives under `#154`

Historical/cleanup follow-up points:
- archived SQLite-era migration history should remain as historical reference only and not re-enter the active migration chain
- remaining docs and runbooks should consistently describe the PostgreSQL baseline rather than the old `db push`-only posture

Operational consequence:
- local/test/CI and the current staging runtime now align on PostgreSQL
- the remaining gap in `#91` is no longer startup recovery or migration-baseline definition; it is staging validation depth plus final cleanup

## Risks of the remaining cutover work
- staging still needs one clean pass through the intended automated deploy path after the recovery deployment used to restore service
- protected stage workflows can still hide auth/role/config issues until they are exercised under real Entra access
- runtime data handling and rollback/runbook expectations still need explicit production-side verification under `#154`
- the temporary non-production `db push` compatibility fallback should not become a permanent substitute for explicit migration application

## Reasons to stay on SQLite temporarily
For the current workload profile, SQLite still has real short-term advantages:
- lowest runtime cost because there is no separate managed database service
- simpler local developer bootstrap
- fewer moving parts while finishing feature and UX work

But the threshold for moving has now been crossed for production planning:
- observed staging pain is no longer hypothetical
- the current runtime/storage model has already shown corruption and recovery fragility
- any continued SQLite use should be framed as a temporary bridge, not an acceptable production target

## Staging baseline: serverless PostgreSQL pricing expectation
For staging, the recommended target is a **serverless/burstable Azure Database for PostgreSQL Flexible Server**. This provides a reliable managed database with a low monthly cost profile for low‑traffic environments.

Typical cost profile (approximate, USD/month):
- **Compute (B1ms burstable / serverless)**: ~$10–15
- **Storage (32 GiB)**: ~$3.7
- **Total**: **~$15–20 / month** (lower if the server is stopped when idle)

This gives a predictable low‑cost baseline while eliminating the operational fragility seen with SQLite in App Service.

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

The non-invasive work discussed for `#91` corresponds to the Preparation slice and Slice 1 below. Those slices are intended to avoid touching the existing staging/production runtime contract while the PostgreSQL path is being prepared.

### Preparation slice: Close design and define the parallel PostgreSQL path
Goals:
- make the migration sequence explicit before changing shared defaults
- identify which changes can land without touching the existing staging/production runtime contract
- define rollback boundaries, environment contract, and verification gates

Work:
- refresh this design note after the staging incidents on `2026-03-12` and `2026-03-18`
- inventory SQLite-specific repo/runtime dependencies and classify them by local, CI, or deployed-runtime impact
- decide the PostgreSQL connection-string and environment-variable contract for local, test, CI, staging, and production
- decide whether PostgreSQL migration should start from a clean Prisma baseline or an adapted migration history
- define the preparation-slice deliverables and the handoff criteria into implementation slices

Exit criteria:
- the design, sequencing, and rollback boundaries are documented and agreed
- `#91` reflects the real current implementation state and the remaining preparation scope

### Slice 1: Introduce PostgreSQL-ready tooling without switching default runtime
Goals:
- add PostgreSQL-compatible local/test tooling in parallel
- keep current SQLite flow temporarily available while the PostgreSQL path is prepared

Work:
- add PostgreSQL env examples for local/test
- add an opt-in local PostgreSQL bootstrap path for developers
- introduce reset/migrate utilities that work via Prisma commands or SQL client against PostgreSQL
- stop adding new SQLite-specific helper logic

Exit criteria:
- repo supports both legacy SQLite bootstrap and parallel PostgreSQL bootstrap for a short transition window
- local preparation work can continue without changing staging/production runtime behavior

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

### Slice 5: Update Azure runtime provisioning and redeploy environments
Goals:
- deployed runtime matches architecture target

Work:
- provision or connect to Azure Database for PostgreSQL from the Azure deployment path
- inject PostgreSQL `DATABASE_URL`
- update GitHub Environment variables/secrets and deployment workflow to match the new contract
- redeploy staging and verify migrations/bootstrap run safely on deploy

Exit criteria:
- staging runtime uses PostgreSQL end to end
- production rollout can be gated after staging verification under `#154`

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
| `infra/azure/main.bicep` | wire Azure Database for PostgreSQL connection and app settings |
| `README.md` | document new bootstrap and testing flow |
| `doc/ARCHITECTURE.md` | remove engine-mismatch debt note when resolved |

## Verification plan
Minimum verification remaining for `#91`:
1. Local bootstrap works from empty PostgreSQL database.
2. `npm run prisma:generate` succeeds.
3. `npm run db:migrate` succeeds.
4. `npm run prisma:seed` succeeds.
5. `npm test` succeeds against PostgreSQL.
6. CI succeeds with PostgreSQL service.
7. Staging deploy succeeds with PostgreSQL-backed runtime through the intended automated path.
8. Smoke test participant, reviewer, appeal, reporting, and admin-content flows in staging.
9. Keep the PostgreSQL migration baseline authoritative and avoid reintroducing SQLite-era migration drift.

## Rollback boundaries
Safe rollback before Slice 5 (Azure runtime cutover):
- revert CI/dev changes while production/runtime remains unchanged

Safe rollback after Slice 5 only if:
- SQLite path still exists in parallel, or
- staging-only migration is isolated from production

Unsafe rollback:
- switching production/staging runtime to PostgreSQL without a reversible deploy plan or verified backup/export path

## Recommendation
Current recommendation:
- treat the repo/provider switch and staging runtime recovery as complete
- treat the PostgreSQL migration baseline as established in repo
- focus remaining effort in `#91` on staging validation depth and final SQLite/doc cleanup
- do not keep any new staging/production deployment on App Service + file-backed SQLite
- track production provisioning/deploy/cutover work under `#154`, not under `#91`
- treat `#91` as open until staging follow-up and final cleanup are settled

The symptoms above are no longer hypothetical; staging has already exhibited them. The remaining question is sequencing, not whether the migration is justified.

Recommended order:
1. Preparation slice
2. Slice 1: parallel PostgreSQL local/test tooling
3. Slice 2: Prisma provider switch
4. Slice 3: script replacement
5. Slice 4: CI PostgreSQL validation
6. Slice 5: Azure runtime wiring
7. Slice 6: SQLite cleanup

This keeps the blast radius smaller by separating design/preparation from cutover work and by leaving the deployed runtime untouched until the PostgreSQL path has been defined, implemented, and validated.
