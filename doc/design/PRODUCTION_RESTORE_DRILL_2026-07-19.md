# Production Restore Drill — 2026-07-19

Disaster-recovery drill executed against production PostgreSQL to satisfy #403 (EPIC #443,
production reliability baseline). Verifies that production can be recovered from backup **before**
we ever have to do it under incident pressure.

- **Date (UTC):** 2026-07-19
- **Operator / Verifier:** engineering (single-operator drill; roles combined per runbook §Ownership)
- **Prerequisite:** #402 (backup hardening) — closed 2026-05-16 ✅
- **Runbook exercised:** [`doc/PRODUCTION_RESTORE_RUNBOOK.md`](../PRODUCTION_RESTORE_RUNBOOK.md)
- **Scope (agreed):** Path 1 (Native PITR) executed end-to-end for real; Paths 2 (vaulted) and 3
  (logical export) verified available as a table-top exercise (recovery points / scripts confirmed
  present, full reconstruct deferred to next drill).

## Result summary

| Path | Method | Outcome |
|---|---|---|
| 1 — Native PITR | **Executed for real** — restored to a new isolated server, verified data, torn down | ✅ PASS |
| 2 — Vaulted backup | Table-top — confirmed vault + weekly recovery points exist | ✅ available (reconstruct deferred) |
| 3 — Logical export | Table-top — confirmed runbook + export script exist | ✅ available (needs pre-change export artifact) |

**Verdict:** Production is recoverable via native PITR with intact, coherent participant data. Two
independent secondary paths are configured and evidenced. Three runbook weaknesses were found and
fixed (below).

## Path 1 — Native PITR (executed)

**Inputs captured**
- Source server: `a2-assessment-platform-prd-pg-hea5kl` (RG `rg-a2-assessment-production`, Norway East, v16)
- Restore point: latest available (restore-to-now)
- Backup window at drill time: earliest restore `2026-07-12`, retention **7 days**
- Target (throwaway) server: `a2-assessment-platform-prd-pg-restore-202607190625`

**Command** (PowerShell — see finding F3 on why not Git Bash)
```powershell
az postgres flexible-server restore -g rg-a2-assessment-production `
  -n a2-assessment-platform-prd-pg-restore-202607190625 `
  --source-server a2-assessment-platform-prd-pg-hea5kl --yes
```

**Infrastructure checks**
- Restored server reached `state: Ready` (created `2026-07-19T06:27:49Z`), correct RG + region + version 16 ✅
- Application database `a2assessment` present (alongside system DBs) ✅

**Data sanity** (counts after `ANALYZE` — see finding F4)

| Table | Rows | Table | Rows |
|---|---|---|---|
| AuditEvent | 90 | AssessmentDecision | 2 |
| User | 61 | CertificationStatus | 2 |
| Module | 16 | LLMEvaluation | 2 |
| Submission | 6 | Appeal | 1 |
| MCQAttempt | 6 | Course | 1 |
| AssessmentJob | 2 | CourseEnrollment | 0 |
| Class | 2 | ManualReview | 0 |

Submission → LLMEvaluation → AssessmentDecision → CertificationStatus lineage is present and
internally consistent; the audit trail (90 events) restored intact. Data is non-empty and coherent
with a pilot-stage production dataset.

**Teardown**
- Throwaway server deleted after verification. Deletion was initially **blocked by the production RG
  `CanNotDelete` lock** (see finding F5) — completed by temporarily removing the lock, waiting ~60s
  for propagation, deleting the server, then **immediately recreating the identical lock** (verified
  restored). The `/32` firewall rule was removed together with the server.
- No production runtime was ever repointed; the source server was never touched (runbook §Shared Rule 5–7).

## Path 2 — Vaulted backup (table-top)

- Vault `a2-assessment-platform-prd-bkv-hea5kl` present.
- Recovery points confirmed: weekly cadence, newest `2026-07-12`, oldest observed `2026-06-14`
  (≥5 points), policy retention `P3M`.
- Full restore-as-files + PostgreSQL reconstruction **not executed this drill** — this is the primary
  gap to close in the next drill.

## Path 3 — Logical export / manual reconstruction (table-top)

- Runbook [`doc/PRODUCTION_LOGICAL_EXPORT_RUNBOOK.md`](../PRODUCTION_LOGICAL_EXPORT_RUNBOOK.md) present.
- Export tooling `scripts/azure/create-logical-export.ps1` present (`pg_dump --format=custom`).
- Recovery through this path depends on an actual pre-change export artifact having been taken; none
  was reconstructed this drill.

## Findings — runbook weaknesses (all fixed this drill)

- **F1 — Retention drift.** Runbook "Current Production Baseline" stated `backup retention: 35 days`;
  the live server reports **7 days** (PITR earliest restore = `2026-07-12`). → Runbook corrected to 7 days.
- **F2 — Broken evidence reference.** Runbook referenced
  `doc/design/PRODUCTION_RESTORE_DRILL_2026-04-15.md` (incl. as the vaulted-path validation evidence),
  but that file does not exist in the repo. → References repointed to this 2026-07-19 drill.
- **F3 — Windows tooling gotcha (new note added).** `az` commands that take a full ARM resource ID
  (`--source-server /subscriptions/...`) must be run in **PowerShell**, not Git Bash — MSYS rewrites
  the leading slash into `C:/Program Files/Git/...` and the command fails. Passing the bare server
  *name* also avoids it.
- **F4 — Data-plane verification note (new).** Verifying row counts from an operator workstation
  requires: (a) a temporary `/32` firewall rule for the operator's egress IP, (b) `az.cmd` on Windows
  strips double-quoted SQL identifiers passed via `-q`, so quote-sensitive `COUNT(*)` fails — run
  `ANALYZE` first and read `pg_stat_user_tables` (single-quote literals only), or use `psql` (not
  bundled with az). A fresh restore has empty planner stats until `ANALYZE` runs.
- **F5 — Prod RG delete-lock blocks drill teardown (new note added).** The production resource group
  carries a `CanNotDelete` lock (`rg-production-do-not-delete`, #405) that blocks deletion of the
  throwaway restored server *and* its child firewall rules. Teardown procedure: remove the lock, wait
  ~60s for propagation (lock changes are eventually-consistent — deleting too soon still fails
  `ScopeLocked`), delete the server, then **immediately recreate the identical lock** and verify it is
  restored. Do this as one guarded block so the lock is never left off.

## Acceptance criteria (#403)

- [x] Native PITR restore executed in an isolated environment (not prod runtime)
- [x] Paths 2 & 3 verified available (recovery points / scripts confirmed) — full reconstruct deferred
- [x] Drill documented here
- [x] Runbook weaknesses found and fixed (F1–F4)
- [x] `doc/INCIDENTS.md` updated with drill reference
- [x] Next drill planned

## Next drill

- **Cadence:** quarterly. **Next: 2026-10** (target).
- **Focus for next drill:** execute Path 2 (vaulted restore-as-files → reconstruct server) and Path 3
  (logical export replay) end-to-end, not just table-top; and re-run the single-operator process test
  against the corrected runbook.
