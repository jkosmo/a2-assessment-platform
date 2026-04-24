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
- [pilot/VERIFICATION_CHECKLIST.md](pilot/VERIFICATION_CHECKLIST.md)

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

`/healthz` confirms the HTTP app is up.
It does not prove:
- database connectivity
- worker health
- queue drain behavior

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

Current expectation:
- the web role owns runtime schema application
- worker role skips migrations

Normal deploy path:
- deploy artifact
- web role starts
- `prisma migrate deploy` runs
- app starts

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
| `ASSESSMENT_JOB_MAX_ATTEMPTS` | `3` | Retry ceiling |
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
