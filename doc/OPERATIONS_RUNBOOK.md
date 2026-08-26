# Operations Runbook

This runbook covers day-to-day runtime operations for the A2 Assessment Platform:
- startup behavior
- migrations and seed behavior
- web/worker role topology
- assessment job processing health
- stale-lock and stuck-job recovery
- first-response failure diagnosis

Related documents:
- [OBSERVABILITY_RUNBOOK.md](OBSERVABILITY_RUNBOOK.md)
- [AZURE_ENVIRONMENTS.md](AZURE_ENVIRONMENTS.md)
- [PRODUCTION_RESTORE_RUNBOOK.md](PRODUCTION_RESTORE_RUNBOOK.md)
- [PRODUCTION_LOGICAL_EXPORT_RUNBOOK.md](PRODUCTION_LOGICAL_EXPORT_RUNBOOK.md)
- [INCIDENTS.md](INCIDENTS.md)
- [DEPLOY_OPTIMIZATION.md](DEPLOY_OPTIMIZATION.md)
- [pilot/VERIFICATION_CHECKLIST.md](pilot/VERIFICATION_CHECKLIST.md)

**Deploy discipline rules** are authoritative in [../CLAUDE.md](../CLAUDE.md#deploy-discipline--established-2026-05-17). Read those before making any infra/workflow change.

## Production Deployment and Rollback

This section covers the minimum operator runbook for production cutover, post-deploy verification, and rollback decision-making.

Production deploys are executed through GitHub Actions:
- workflow: `.github/workflows/deploy-azure.yml`
- environment: `production`
- approval gate: GitHub Environment required reviewers

Production configuration is expected to live in GitHub Environment state, not as manual portal drift:
- non-secret runtime/config values: GitHub Environment `production` variables
- secrets: GitHub Environment `production` secrets
- Azure infrastructure shape: `infra/azure/main.bicep`
- deployment orchestration: `scripts/azure/deploy-environment.ps1`

### Pre-deploy checklist

Before approving a production deploy:
1. Confirm the intended commit/ref is the one being deployed.
2. Confirm `deploy-staging` completed successfully in the same workflow run.
3. Confirm the production GitHub Environment still has the intended runtime values:
   - authentication mode and Entra values
   - LLM runtime values
   - participant notification channel
   - PostgreSQL production profile values
4. Confirm no manual portal changes are being relied on for the deploy to succeed.
5. Confirm there is no active incident that would make production verification ambiguous.
6. If the deploy includes schema/data risk, confirm a pre-change logical export has been taken and recorded.

### Production post-deploy verification

Minimum verification after every production deploy:
1. Verify web `GET /healthz`.
2. Verify web `GET /version`.
3. Verify the worker app responds on `/healthz`.
4. Verify production Entra sign-in succeeds on one real route such as `/participant`.
5. Verify one production assessment path that exercises the currently intended LLM runtime.
6. Verify one participant notification path if the deploy changed notification or communication settings.
7. Check recent logs for:
   - `unhandled_error`
   - `llm_evaluation_failed`
   - `assessment_job_stuck_alert`
   - `participant_notification_failed`
8. Confirm queue backlog is stable or decreasing after startup churn.

Recommended evidence to capture in the deploy record or incident notes:
- workflow run URL
- deployed commit SHA
- web app URL and worker app URL
- version response
- whether LLM and notification smoke paths passed

## Pre-pilot Verification Gate

For a staged pilot candidate, run the dedicated checklist before treating a build as ready:
- [pilot/VERIFICATION_CHECKLIST.md](pilot/VERIFICATION_CHECKLIST.md)

The checklist is intentionally shorter than the full readiness material and focuses on:
- Entra redirect sanity
- admin-content library and mode transitions
- course flow sanity
- review and appeal route sanity
- web and worker health
- minimum alert baseline presence

### Rollback boundary

Application code can be redeployed quickly. Database state cannot be assumed to roll back with the application.

Important boundary:
- App Service code/config rollback is usually a redeploy action.
- PostgreSQL schema/data rollback is a recovery action and may require PITR, vaulted backup restore, or logical export-assisted repair.

Do not assume that re-deploying an older commit will reverse:
- Prisma migrations that already ran
- destructive data writes
- operator/admin changes already committed to the database

### Production rollback decision guide

Use the simplest safe option that matches the failure mode.

1. Configuration or app-only regression
   - symptoms: startup regression, bad runtime flag, broken route, bad LLM/notification wiring, no evidence of destructive writes
   - action: redeploy the last known good commit through the same GitHub workflow

2. Migration or schema compatibility regression
   - symptoms: web app fails during startup migration, older code cannot safely run against current schema, or new schema caused app breakage
   - action: stop and assess before redeploying older code
   - likely path: corrective forward deploy or explicit database recovery, not blind rollback
   - if the change was classified as high-risk, verify whether a pre-change logical export exists before choosing the recovery path

3. Recent destructive or corrupt writes
   - symptoms: wrong results persisted, damaged certification state, unexpected deletes/updates
   - action: use the recovery decision tree from the PostgreSQL recovery documentation
   - likely path: PITR first, then vaulted backup or logical export where needed

4. Infrastructure/runtime outage without data corruption
   - symptoms: app unavailable but data believed intact
   - action: prefer redeploy/restart/recreate through the standard Azure workflow before escalating to database recovery

### Escalation triggers

Escalate beyond a normal application redeploy when any of the following are true:
- a production migration has already applied and rollback safety is unclear
- participant results or certification status may have been written incorrectly
- appeal state or manual-review data may have been corrupted
- repeated worker failures are causing queue churn or stale-lock resets
- notification delivery failed after a business write and user impact is unclear

When escalating:
1. Preserve evidence first.
2. Record the incident in [INCIDENTS.md](INCIDENTS.md).
3. Use [OBSERVABILITY_RUNBOOK.md](OBSERVABILITY_RUNBOOK.md) for KQL/log confirmation.
4. Use [PRODUCTION_RESTORE_RUNBOOK.md](PRODUCTION_RESTORE_RUNBOOK.md) for restore decision and operator steps.
5. Use [doc/design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md](design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md) for database recovery posture and longer-term architecture expectations.

## Runtime Topology

The current runtime no longer assumes a single all-in-one production process.

Application code supports three roles through `PROCESS_ROLE`:

| Role | Starts HTTP app | Starts AssessmentWorker | Starts AppealSlaMonitor | Starts PseudonymizationMonitor | Starts AuditRetentionMonitor |
|---|---|---|---|---|---|
| `web` | yes | no | no | no | no |
| `worker` | minimal listener only | yes | yes | yes | yes |
| `all` | yes | yes | yes | yes | yes |

Current Azure shape:
- one App Service for web traffic with `PROCESS_ROLE=web`
- one App Service for background work with `PROCESS_ROLE=worker`
- both currently share the same App Service Plan
- both have `alwaysOn=true`

The worker app exists so background processing does not depend on the web role staying warm.

## Startup Behavior

Entrypoint:
- `scripts/runtime/startup.mjs`

Built app entrypoint:
- `dist/src/index.js`

### Web role startup

Normal web startup sequence:

1. `startup.mjs` checks that the built app exists
2. unless `SKIP_MIGRATE=true`, it runs:
   - `prisma migrate deploy`
   - optional compatibility fallback to `prisma db push --skip-generate` only when `PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK=true`
3. `startup.mjs` imports `dist/src/index.js`
4. `src/index.ts` starts the Express server and binds the web listener

Important notes:
- bootstrap seeding is NOT part of the normal startup path
- to seed a non-production environment, run explicitly: `npm run bootstrap:seed` (requires `BOOTSTRAP_SEED=true`)

### Worker role startup

Worker startup differs intentionally:

1. `startup.mjs` runs
2. Azure worker app sets `SKIP_MIGRATE=true`, so migrations are skipped
3. `startup.mjs` imports `dist/src/index.js`
4. `src/index.ts` starts a minimal HTTP listener and starts all background loops:
   - `AssessmentWorker`
   - `AppealSlaMonitor`
   - `PseudonymizationMonitor`
   - `AuditRetentionMonitor`

The worker listener is only there so App Service keeps the process alive. It is not a full application surface.

## Health Checks

### Web app

Use:
- `GET /healthz`
- `GET /version`

`/healthz` is a **readiness probe (#809, 2026-07-25):** it returns `200 {status:"ok"}` only when the DB is
reachable (a `SELECT 1` probe, cached 5s, bounded by a 2s timeout), and `503 {status:"degraded"}` when the
DB is unreachable. It was previously a static `200` stub that returned as soon as Express bound the port —
which masked a bound-but-broken web and made the health check / deploy smoke test meaningless. It still
does NOT prove:
- worker health (use the worker `/healthz`)
- queue drain behavior
- that migrations finished (they run before the app starts, so a ready `/healthz` implies they did)

### Worker app

In worker-only mode, `src/index.ts` starts a minimal HTTP server.
The process heartbeat includes last-cycle status for all active background loops:

```json
{
  "status": "ok",
  "role": "worker",
  "startedAt": "<ISO timestamp>",
  "workers": {
    "assessmentWorker": { "instanceId": "<uuid>", "lastCycleAt": "<ISO timestamp or null>" },
    "appealSlaMonitor": { "lastCycleAt": "<ISO timestamp or null>" },
    "pseudonymizationMonitor": { "lastCycleAt": "<ISO timestamp or null>" },
    "auditRetentionMonitor": { "lastCycleAt": "<ISO timestamp or null>" }
  }
}
```

`lastCycleAt: null` means the loop has not yet completed a successful cycle since startup.

This is still a process heartbeat and does not prove that:
- jobs are being picked up
- LLM calls are succeeding
- stale locks are being reset

Use logs and queue signals for deeper worker health assessment.

## Migrations and Schema Changes

### Production and staging

Current expectation (updated by #811, 2026-07-25):
- **both the web AND worker roles run `prisma migrate deploy` on startup** (`SKIP_MIGRATE=false` on
  both). Prisma serializes concurrent migrate deploys with an advisory lock, so web + worker migrating on
  the same deploy is safe (one applies, the other sees "up to date").
- **Why the worker migrates too (#811):** previously the worker had `SKIP_MIGRATE=true` and relied on web
  to migrate first. On a deploy the new worker container could start and process a job *before* web
  applied the migration → a missing column failed/partial-processed the job. Now each role's runtime only
  starts after its own migrate completes, so new code never runs against an un-migrated schema.

Normal deploy path (per role):
- deploy artifact → container starts → `scripts/runtime/startup.mjs` runs `prisma migrate deploy` → app starts.

**Migrations MUST be expand/contract-safe (deploy invariant):**
- **Expand within a deploy** — additive only (add columns/tables/indexes). Old (still-running) containers
  must keep working against the NEW schema during the rollout overlap, and the new code must tolerate the
  OLD schema for the brief window before its own migrate completes.
- **Contract in a FOLLOW-UP deploy** — drop/rename a column or table only after every container running
  code that used it is gone. Never combine an additive change and a destructive change to the same object
  in one deploy.
- A destructive migration bundled with code that still reads the dropped object will error on the old
  containers mid-rollout (this class caused the 2026-05-21 incident).

Compatibility fallback:
- `PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK=true` allows a non-production fallback to `prisma db push`
- production should keep this `false`

### Manual migration commands

Apply pending migrations:

```bash
npm run db:migrate
```

Reset database and skip seed:

```bash
npm run db:reset
```

Generate Prisma client:

```bash
npm run prisma:generate
```

Never edit an already-applied migration in place.

## Audit Hash Chain Maintenance (#804)

The audit log is a tamper-evident hash chain (`AuditEvent.payloadHash` covers `prevHash | actor |
timestamp | content`; `chainSeq` gives the order). Appends are serialized by a Postgres advisory lock in
`recordAuditEvent`, so the chain stays linear under concurrency.

**One-time backfill after deploying #804 to an environment.** The additive migration adds `chainSeq` +
`prevHash` but leaves pre-#804 rows unsealed; `verifyAuditChain` fails on them until they're re-sealed. New
rows chain forward regardless, but run the backfill once per env so the whole table verifies:

```bash
# against whatever DATABASE_URL is set — target the env explicitly
dotenv -e .env.<env> -- npm run maint:backfill-audit-chain   # re-seals existing rows
dotenv -e .env.<env> -- npm run maint:verify-audit-chain     # exits non-zero if the chain is broken
```

**Historical PII scrub (#806)** — one-time, removes email/name left in old audit metadata (idempotent;
0 = nothing to clean). It re-seals the chain internally:

```bash
dotenv -e .env.<env> -- npm run maint:scrub-audit-pii
```

**Running these against PRODUCTION** needs a temporary Postgres firewall rule for your IP, and the prod RG
has a `CanNotDelete` lock that blocks *deleting* the temp rule. See the operator memory
`prod-db-firewall-lock-gotcha` for the exact create → run → remove-lock → delete-rule → **re-create-lock**
→ verify recipe (and switch subscription: prod sub `5b3f760b-…`, KV `a2-prd-kv-hea5kl`). Always re-verify
the RG lock is restored afterward. As of 2026-07-25 the prod backfill re-sealed 90 rows; scrub = 0.

**Verification is also a maintenance script** — schedule or run `maint:verify-audit-chain` ad hoc to detect
tampering (a non-zero exit means a row was edited/removed/reordered).

### Collapse duplicated localized titles (#892)

Renaming a module used to copy the author's one title into `en-GB`, `nb` **and** `nn`. The rename path is
fixed (v2.11.3), but rows written before it still look translated — which is exactly the signal a
translation-status view needs. This collapses such values back to a plain string.

**Dry run by default.** `--apply` is required to write, and the dry run prints the ids it would touch:

```bash
dotenv -e .env.<env> -- npm run maint:collapse-duplicated-titles             # dry run — read the ids
dotenv -e .env.<env> -- npm run maint:collapse-duplicated-titles -- --apply  # write
```

Safe because the change is **display-neutral**: `localizeContentText` resolves
`map[locale] ?? map["en-GB"] ?? first value`, and a plain string is returned verbatim for every locale — so
when every entry holds the same string, both encodings render identically everywhere. Only the false claim
"this has a per-locale translation" goes away. Idempotent; a second run reports 0.

Deliberately does **not** touch genuine translations, partial translations (two equal + one different),
single-locale maps (`{"nb":"…"}` records *which* language the text is in), or values that are already plain
strings. Covers `Module.title`, `CourseSection.title`, `Course.title`, `Course.description`.

**Against staging** the resource group has no lock, so the firewall step is straightforward:

```powershell
az account set --subscription <STAGING_SUBSCRIPTION_ID>
az postgres flexible-server firewall-rule create -g rg-a2-assessment-stg `
  --server-name a2-assessment-platform-stg-pg-x6eyx4 --name tmp-<you> `
  --start-ip-address <your-ip> --end-ip-address <your-ip>
$env:DATABASE_URL = az keyvault secret show --vault-name a2-stg-kv-x6eyx4 --name DATABASE-URL --query value -o tsv
npx tsx scripts/maintenance/collapse-duplicated-titles.ts            # dry run
npx tsx scripts/maintenance/collapse-duplicated-titles.ts --apply    # write
az postgres flexible-server firewall-rule delete -g rg-a2-assessment-stg `
  --server-name a2-assessment-platform-stg-pg-x6eyx4 --name tmp-<you> --yes
```

**Against production** the RG carries a `CanNotDelete` lock that blocks *deleting* the temp rule — follow the
create → run → remove-lock → delete-rule → **re-create-lock** → verify recipe in the operator memory
`prod-db-firewall-lock-gotcha`, in small separate steps, and re-verify the lock is restored afterwards.

### Translating section and module titles in one course

`scripts/maintenance/translate-course-titles.ts` fills **missing** locale values for the titles of
every section and module in a single course, translating from a source locale (default `nb`) with
`localizeSectionContent` — the same service the section editor's "Translate" action calls.

Run it when a course reads as a mix of languages because it was authored before renaming had a
translation step (#892 / v2.11.3). Note the ordering dependency: run
`maint:collapse-duplicated-titles` **first**. Until the fabricated per-locale copies are collapsed,
every title looks translated and this script skips all of them.

```powershell
# Requires real LLM config — with LLM_MODE != azure_openai the script refuses to --apply, because the
# stub localiser returns placeholders like "[nn] Tittel" and writing those is worse than the problem.
$env:LLM_MODE = "azure_openai"
$env:AZURE_OPENAI_ENDPOINT = "<endpoint from the environment's app settings>"
$env:AZURE_OPENAI_DEPLOYMENT = "<deployment>"
$env:AZURE_OPENAI_API_VERSION = "2024-10-21"
$env:AZURE_OPENAI_API_KEY = az keyvault secret show --vault-name <kv> --name AZURE-OPENAI-API-KEY --query value -o tsv
$env:DATABASE_URL = az keyvault secret show --vault-name <kv> --name DATABASE-URL --query value -o tsv

npx tsx scripts/maintenance/translate-course-titles.ts --course "<title fragment>"            # dry run
npx tsx scripts/maintenance/translate-course-titles.ts --course "<fragment>" --apply          # write
```

Flags: `--from <locale>` (source, default `nb`), `--to en-GB,nn` (targets), `--redo-duplicates`
(also refill locales whose value merely repeats the source — the #892 signature).

Two caveats worth knowing before reading the output:

- **`--redo-duplicates` is not idempotent.** A title that is legitimately identical across languages
  (a proper noun such as "Klassisk LLM") comes back from the translator unchanged, so the flag
  re-flags it on every subsequent run. Harmless — it rewrites the same value — but a rerun reporting
  "2 to fill" does not mean the previous run failed.
- **It never overwrites an existing value.** A locale holding a *wrong* translation (e.g. an English
  slot containing Norwegian text) is left alone by design, and the participant still sees the wrong
  language. Those must be fixed by renaming the module in the authoring UI.

Firewall access follows the same recipe as the cleanup script above — including the production
lock dance.

## Seed Behavior

### Bootstrap seed

File:
- `scripts/runtime/bootstrapSeed.mjs`

This seed is:
- idempotent
- intended for non-production environments
- gated by `BOOTSTRAP_SEED=true`
- **not invoked by normal startup** — must be run explicitly

Explicit invocation:

```bash
BOOTSTRAP_SEED=true node scripts/runtime/bootstrapSeed.mjs
```

or via npm script:

```bash
BOOTSTRAP_SEED=true npm run bootstrap:seed
```

Current Azure expectation:
- staging may run bootstrap seed as an explicit deploy/init step
- production should not

### Full local/test seed

Examples:

```bash
npm run postgres:app:seed
npm run postgres:test:seed
```

or

```bash
tsx prisma/seed.ts
```

## Assessment Job Processing

Core files:
- `src/modules/assessment/AssessmentWorker.ts`
- `src/modules/assessment/AssessmentJobRunner.ts`
- `src/modules/assessment/staleLockScanner.ts`

Assessment job statuses:
- `PENDING`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`

Current processing cycle:
1. scan for expired running jobs and reset/fail them
2. emit alerts for long-running stuck jobs
3. find next runnable `PENDING` job
4. attempt to lock it with:
   - `lockedAt`
   - `lockedBy`
   - `leaseExpiresAt`
5. run assessment
6. mark job `SUCCEEDED`
7. on failure, either:
   - return job to `PENDING` with delay
   - mark job `FAILED` if max attempts are exhausted

Relevant env vars:

| Var | Default | Meaning |
|---|---|---|
| `ASSESSMENT_JOB_POLL_INTERVAL_MS` | `4000` | Worker poll interval |
| `ASSESSMENT_JOB_MAX_ATTEMPTS` | `6` | Retry ceiling. Raised from 3 in #953 — three attempts 30 s apart gave a total window under one minute, too tight to survive an LLM outage. |
| `ASSESSMENT_JOB_RETRY_BASE_MS` | `60000` | First wait between retries; doubles each attempt (1+2+4+8+16 = 31 min over six attempts). |
| `ASSESSMENT_JOB_RETRY_CAP_MS` | `1800000` | Ceiling on a single wait. |
| `ASSESSMENT_FAILED_ALERT_THRESHOLD` | `3` | Stuck assessments before administrators are e-mailed (#953). One is a single case; the pile-up is the signal. |
| `ASSESSMENT_FAILED_ALERT_COOLDOWN_MS` | `86400000` | Minimum gap between those e-mails. ⚠️ Raise this during a known outage — without a cap every failing submission would mail every administrator, and a filtered alert is worse than none. Persisted in `PlatformConfig`, so it survives a worker restart. |
| `ASSESSMENT_JOB_LEASE_DURATION_MS` | `300000` | Lease duration before a running job is considered stale |
| `ASSESSMENT_JOB_STUCK_THRESHOLD_MS` | `600000` | Threshold for emitting stuck-job alerts |

## Stale-Lock Recovery

Stale-lock recovery is implemented now.

What happens:
- before processing each job cycle, the worker calls `scanAndResetStaleJobs()`
- jobs whose lease has expired are reset automatically
- if attempts are exhausted, the stale job is marked `FAILED` instead of being re-queued

Observed signals:
- `assessment_job_stale_lock_detected`
- audit events:
  - `assessment_job_stale_lock_reset`
  - `assessment_job_stale_lock_failed`

This means stale `RUNNING` jobs do not normally require immediate manual SQL intervention anymore.

### Manual intervention still needed when

- the same jobs repeatedly go stale
- a job reaches `FAILED` and should be retried after a fix
- a deeper worker/LLM bug is causing repeated lease expiry

Useful SQL:

```sql
SELECT id, "submissionId", status, attempts, "lockedAt", "leaseExpiresAt", "errorMessage"
FROM "AssessmentJob"
WHERE status IN ('PENDING', 'RUNNING', 'FAILED')
ORDER BY "updatedAt" DESC;
```

Re-queue a failed job only after understanding the failure cause:

```sql
UPDATE "AssessmentJob"
SET status = 'PENDING',
    "availableAt" = NOW(),
    "lockedAt" = NULL,
    "lockedBy" = NULL,
    "leaseExpiresAt" = NULL
WHERE id = '<job-id>';
```

## Stuck-Job Alerts

Stuck-job alerts are also implemented.

What they do:
- `alertOnStuckJobs()` scans for jobs running beyond `ASSESSMENT_JOB_STUCK_THRESHOLD_MS`
- each stuck job emits an error-level `assessment_job_stuck_alert`

This is an operational warning, not automatic remediation.
Auto-remediation is handled by stale-lock reset once the lease expires.

Interpretation:
- `assessment_job_stuck_alert` means a worker run is taking unusually long
- repeated alerts for the same job usually indicate:
  - LLM timeouts
  - process stalls
  - unhandled runtime bugs

## Appeal SLA Monitor

Core files:
- `src/modules/appeal/AppealSlaMonitor.ts`
- `src/modules/appeal/appealSlaMonitorService.ts`

What it does:
- runs on the worker role
- scans appeals in `OPEN` and `IN_REVIEW`
- emits queue posture and overdue signals

Relevant env vars:

| Var | Default | Meaning |
|---|---|---|
| `APPEAL_SLA_MONITOR_INTERVAL_MS` | `600000` | Monitor interval |
| `APPEAL_OVERDUE_ALERT_THRESHOLD` | `1` | Threshold for overdue alerting |

Observed signals:
- `appeal_sla_backlog`
- `appeal_overdue_detected`

## Common Failure Modes

### Web app fails during startup

Symptoms:
- App Service restart loop
- `/healthz` unavailable
- startup logs stop before "Starting application runtime..."

Check:
1. migration error output from `startup.mjs`
2. database connectivity
3. whether built artifact contains `dist/src/index.js`
4. whether production accidentally has `PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK=true`

### Worker app is alive but queue does not drain

Symptoms:
- worker process heartbeat is healthy
- `assessment_queue_backlog` keeps rising
- no recent `SUCCEEDED` jobs

Check:
1. `llm_evaluation_failed` events
2. `assessment_job_stuck_alert` events
3. repeated stale-lock detection for same submissions
4. whether worker app is running the intended artifact and env vars

### Repeated stale-lock resets

Symptoms:
- many `assessment_job_stale_lock_detected`
- same submission cycles between `RUNNING` and retry/failure

Check:
1. downstream LLM/API failures
2. process crashes or unhandled errors
3. whether lease duration is too short for the current workload

### Appeal monitor alerts

Symptoms:
- `appeal_overdue_detected`
- high `openAppeals` / `inReviewAppeals` backlog in logs

Check:
1. whether handler capacity is sufficient
2. whether appeal ownership is clear
3. whether queue is moving from `OPEN` to `IN_REVIEW` and `RESOLVED`

### Participant notification problems

Signals:
- `participant_notification_sent`
- `participant_notification_failed`
- `participant_notification_pipeline_failed`

Check:
1. `PARTICIPANT_NOTIFICATION_CHANNEL`
2. webhook configuration if channel is `webhook`
3. ACS configuration if channel is `acs_email`

### PG deploy hits `ServerIsBusy` or every deploy updates the server

Symptoms:
- `az deployment group create` fails with `ServerIsBusy` on `Microsoft.DBforPostgreSQL/flexibleServers`, or
- every routine deploy logs `Forcing ARM PostgreSQL server update` even when the server properties have not changed

Check (see `doc/AZURE_ENVIRONMENTS.md` → "Deploy mechanics" for the underlying logic):
1. Deploy log: did the PG pre-flight (#411) actually run? Look for `PostgreSQL server properties match desired state - skipping ARM server update.` If absent, the pre-flight skipped — usually because `$existingPgServer` did not resolve (RG empty / fresh deploy / different env-code prefix).
2. Deploy log: what did the credential guard (#410) say? Look for the `Credential-drift check (#410): …` line and the `kvRead=` tag:
   - `kvRead=secret-read` + "skip is safe" → ordinary unchanged deploy; the server update *was* skipped.
   - `kvRead=secret-read` + "DIFFERS … password rotation intended" → the deploy SP read the secret and a rotation is in progress; PG update is expected.
   - `kvRead=secret-read-failed` / `secret-unparseable` / `kv-name-unresolved` → the deploy SP cannot read DATABASE-URL; guard forces the update conservatively. Expected once after a fresh env recreate (#470 grant doesn't exist yet, self-heals on next deploy). If it recurs every deploy, verify the env's `DEPLOY_PRINCIPAL_ID` GitHub variable is set to the deploy SP objectId (staging `36b2fabb-…`, production `cba285e6-…`) and that `Microsoft.Authorization/roleAssignments` for the SP on `DATABASE-URL` was actually created — `az rest` GET at `…/vaults/<kv>/secrets/DATABASE-URL/providers/Microsoft.Authorization/roleAssignments?$filter=atScope()`.

## Correlation IDs

Correlation IDs are attached by:
- `src/middleware/requestObservability.ts`

Behavior:
- request header `x-correlation-id` is propagated when present
- otherwise a UUID is generated
- response always includes `x-correlation-id`
- request completion logs include the correlation ID
- unhandled errors include the correlation ID in `unhandled_error`

Use the correlation ID to reconstruct a request path in logs before jumping to deeper incident hypotheses.

## Operational First Response

1. Confirm whether the problem is on the web side, worker side, or both.
2. Check latest deploy and startup logs.
3. Check `/healthz` and `/version` on the web app.
4. Inspect recent worker signals:
   - `assessment_queue_backlog`
   - `assessment_job_stuck_alert`
   - `assessment_job_stale_lock_detected`
   - `llm_evaluation_failed`
   - `appeal_overdue_detected`
5. Use correlation IDs for request-scoped failures.
6. If participant-impacting, capture:
   - affected module
   - affected submission IDs
   - queue status
   - whether decisions were written
7. Add or update the incident entry in [INCIDENTS.md](INCIDENTS.md).

## Manual Verification Checklist

After a deploy or recovery step:
1. Verify web `/healthz`.
2. Verify web `/version`.
3. Verify worker process is emitting fresh logs.
4. Submit or re-check one known assessment flow if relevant.
5. Confirm queue backlog is stable or decreasing.
6. Confirm no repeated stale-lock or stuck-job alerts remain unexplained.
