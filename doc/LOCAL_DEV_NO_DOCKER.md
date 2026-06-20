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

To reset the local DB: `dotenv -e .env.postgres.local -- npx prisma migrate reset` (then it
re-applies migrations + seeds).

## Notes

- Integration tests (`npm test`) still need Postgres; they run in **CI** — you don't need them
  locally. The two loops above cover local development.
- Definition of done for user-facing changes (see CLAUDE.md): a Playwright e2e of the primary
  flow, written with the feature and run locally before deploy.
