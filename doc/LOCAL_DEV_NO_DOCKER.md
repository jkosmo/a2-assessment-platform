# Local dev without Docker / WSL / admin

This machine can't run Docker Desktop or WSL2 (enabling the "Virtual Machine Platform"
Windows feature requires admin, which we don't have). The standard `npm run dev` /
`npm run postgres:*` flow uses Docker and therefore won't work here. This is the admin-free
substitute: a **portable PostgreSQL** (zip binaries, runs in a user folder) + a `dev:local`
script that skips the Docker step.

## Two loops

- **Fast client loop (no DB needed):** the Playwright client e2e runs the real front-end in
  Chromium against mocked APIs — this is what catches the client-layer bug class (i18n keys,
  fetch/Content-Type, CSP, rendering). No Postgres required:
  ```
  npx playwright test --config playwright.admin-content.config.ts
  ```
- **Full-stack loop (real app + DB):** portable Postgres + `npm run dev:local` (below).

## Portable PostgreSQL (one-time setup)

Already set up on this machine under `C:\Users\<you>\a2-pg-local\`:
- `pgsql\` — PostgreSQL 16 binaries (from the EnterpriseDB Windows zip; **extract with Windows
  `tar.exe`, not Git Bash tar or PowerShell Expand-Archive** — the former is GNU tar that can't
  read zip, the latter is unreliably slow on a 300 MB archive).
- `data\` — the data directory, `initdb`'d with superuser `a2_app` and **trust auth on
  localhost** (so the password in `DATABASE_URL` is ignored locally).
- Databases `a2_assessment_dev` + `a2_assessment_test` created; migrations applied; dev seeded.

Connection (matches `.env.postgres.local`): `127.0.0.1:54329`, user `a2_app`, db `a2_assessment_dev`.

## Daily use

1. **Start Postgres** (once per reboot): run `C:\Users\<you>\a2-pg-local\start-pg.cmd`
   (or `pg_ctl -D <data> -o "-p 54329" -l <log> start`).
2. **Run the app:** `npm run dev:local` (app on `http://127.0.0.1:3000`, `AUTH_MODE=mock`).
3. **Stop Postgres** when done: `C:\Users\<you>\a2-pg-local\stop-pg.cmd`.

### Consent on a fresh database

In mock mode each console page sends a different mock identity (e.g. the section editor uses
`content-owner-1`, the participant view uses the default `dev-user-1`). Privacy consent is
stored **per user**, so on a fresh DB every identity hits a `403 consent_required` until it
accepts the notice. To pre-accept the current consent version for all mock identities at once:

```
npm run dev:seed:consent
```

Run it once after a fresh setup or a DB reset. Idempotent.

To reset the local DB: `dotenv -e .env.postgres.local -- npx prisma migrate reset` (then it
re-applies migrations + seeds), followed by `npm run dev:seed:consent`.

## Separate Postgres for the integration tests (2026-11-22)

The integration tests can run four files at a time (`npm run test:integration:parallel`), each against its own copy of the
test database (`CREATE DATABASE … TEMPLATE`, see `test/support/integrationDbNames.ts`). That needs a test user with
`CREATEDB`. On a machine where Postgres is an admin-installed Windows service with an unknown `postgres` password, the
user can't be given that right — so the tests get their own cluster instead, in a user folder, started without admin:

```powershell
$bin = "C:\Program Files\PostgreSQL\17\bin"
& "$bin\initdb.exe" -D C:\Dev\pg-test\data -U postgres -A trust -E UTF8 --locale=Norwegian_Norway.1252 --no-instructions
# append to C:\Dev\pg-test\data\postgresql.conf:
#   port = 5434                  (5432/5433 are the installed services)
#   listen_addresses = 'localhost'
#   max_connections = 300        (four processes, each with its own Prisma pool)
#   shared_buffers = 256MB
#   fsync = off / synchronous_commit = off / full_page_writes = off
#     — test data is always rebuilt, so nothing waits for the disk. Never use these for data worth keeping.
#   timezone = 'Europe/Berlin'
& "$bin\pg_ctl.exe" -D C:\Dev\pg-test\data -l C:\Dev\pg-test\postgres.log -w start
& "$bin\psql.exe" -U postgres -h 127.0.0.1 -p 5434 -d postgres -c "CREATE ROLE a2_app LOGIN CREATEDB;" -c "CREATE DATABASE a2_assessment_test OWNER a2_app;"
```

`a2_app` is not a superuser there, so permissions otherwise match the shared database. Use the same locale as the
database the tests ran against before: the collation decides how Norwegian names sort.

Then in `.env.test.local` (gitignored): `DATABASE_URL` on port `5434` (the password is ignored, trust auth on
localhost only), and `A2_TEST_PG_DATA=C:\Dev\pg-test\data`. With that set, `npm run db:reset:native` — and so every
`test:integration:native` / `test:integration:parallel` run — first starts the cluster if it isn't running
(`scripts/test/ensure-test-postgres.mjs`). Without it the script does nothing.

## Notes

- Integration tests (`npm test`) still need Postgres; they run in **CI** — you don't need them
  locally. The two loops above cover local development. For running them locally, see the section above.
- Definition of done for user-facing changes (see CLAUDE.md): a Playwright e2e of the primary
  flow, written with the feature and run locally before deploy.

### Agent Authoring smoke (EPIC #647)

Drive the agent-authoring API against your local app without any agent or ChatGPT:

```
# App running via `npm run dev:local` (mock auth). In another shell:
$env:A2_USER_ID   = 'content-owner-1'      # any id; role hint below grants access
$env:A2_USER_ROLES = 'SUBJECT_MATTER_OWNER'
$env:A2_BASE_URL  = 'http://127.0.0.1:3000'
node skills/a2-authoring-api/scripts/import-package.mjs --file skills/a2-authoring-api/fixtures/example-package.json --validate-only
node skills/a2-authoring-api/scripts/import-package.mjs --file skills/a2-authoring-api/fixtures/example-package.json
```

The fixture creates a course with 2 learning sections + one module of each assessment mode
(FREETEXT_ONLY / MCQ_ONLY / FREETEXT_PLUS_MCQ) as **drafts**, and prints admin links + an
`agentRunId`. Package the skill as a distributable zip with `npm run skill:package`.

- Agent-authoring integration tests (native Postgres, no Docker):
  `npm run test:integration:native -- test/agent-authoring-validate.test.ts test/agent-authoring-orchestration.test.ts test/agent-authoring-audit.test.ts test/agent-authoring-token.test.ts test/agent-authoring-skill-import.test.ts`
