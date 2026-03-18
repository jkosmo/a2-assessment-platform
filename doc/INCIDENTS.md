# Incident Log

This document records notable staging/production incidents so symptoms, root causes, mitigations, and follow-up actions remain discoverable after the immediate fix.

## Incident Template
- Date:
- Environment:
- Symptom:
- Impact:
- Root cause:
- Mitigation:
- Recovery verification:
- Follow-up:
- References:

## 2026-03-18 - Staging SQLite Corruption (Recurrence) — Container Timeout
- Date: `2026-03-18`
- Environment: `staging`
- Symptom:
  - manual review queue showed 0 entries despite having cases visible earlier the same day
  - appeal queue dropped from 4 open appeals to 0 with no manual resolution
  - logging gap of ~47 minutes (11:48 → 12:35 UTC) with no `appeal_sla_backlog` events
- Impact:
  - all runtime test data lost: submissions, manual reviews, and appeals wiped
  - staging environment effectively reset to seed-only state mid-session
- Root cause:
  - Azure App Service container failed to start at `2026-03-18T12:29:28Z` with `ContainerTimeout` (did not start within 230s limit)
  - Azure recycled the container and started a fresh one at `2026-03-18T12:35:02Z`
  - on restart, the SQLite database was re-initialised by bootstrap seed, wiping all runtime data
  - underlying cause is the same as 2026-03-12: SQLite on Azure App Service persistent storage is unreliable under container restarts
  - confirmed via `az webapp log download` + docker log analysis; no code regression involved
- Mitigation:
  - none required — app recovered automatically after container restart
  - test data was re-created through a new participant flow session
- Recovery verification:
  - `appeal_sla_backlog` resumed at `2026-03-18T12:35:54Z` with `openAppeals: 0`
  - new submission, assessment, and appeal created successfully after restart
- Follow-up:
  - this is the second SQLite corruption/data-loss incident in 6 days on staging
  - `#91` (Postgres migration) must be prioritised — SQLite is not viable for persistent staging data
  - consider whether staging needs a "do not rely on persistent test data" policy until Postgres is in place
- References:
  - docker log: `ContainerTimeout` at `2026-03-18T12:29:28Z`
  - app log gap: `2026-03-18T11:48Z` → `2026-03-18T12:35Z`
  - previous incident: 2026-03-12 below
  - [INCIDENTS.md — 2026-03-12 entry](#2026-03-12---staging-sqlite-corruption)
  - [#91 Postgres migration issue]

## 2026-03-12 - Staging SQLite Corruption
- Date: `2026-03-12`
- Environment: `staging`
- Symptom:
  - `/api/modules` and `/api/me` returned `401 unauthorized`
  - participant workspace could not load modules
- Impact:
  - manual workspace verification in staging was blocked
  - the error presented as auth failure even though the underlying problem was data/runtime related
- Root cause:
  - the staging SQLite database at `/home/site/data/app.db` became corrupt
  - App Service logs showed `database disk image is malformed`
  - auth middleware hit the database during role lookup and masked the backend failure as `401`
- Mitigation:
  - downloaded App Service logs and confirmed the SQLite corruption
  - backed up the corrupt `app.db`
  - deleted the active SQLite database file from staging
  - restarted the app so runtime migrations and bootstrap seed recreated the database
- Recovery verification:
  - `GET /healthz` returned `200`
  - `GET /api/me` returned `200` with mock headers
  - `GET /api/modules` returned `200` with seeded modules after bootstrap completed
- Follow-up:
  - changed auth middleware so backend/runtime failures are surfaced as `500 internal_error` instead of `401`
  - keep monitoring for further SQLite disk I/O or corruption symptoms as part of deferred Postgres decision `#91`
- References:
  - Release `0.3.114`
  - Commit `a3838d3`
  - [authenticate.ts](/C:/Users/JoakimKosmo/a2-assessment-platform/src/auth/authenticate.ts)
  - [VERSIONS.md](/C:/Users/JoakimKosmo/a2-assessment-platform/doc/VERSIONS.md)
