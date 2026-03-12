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
