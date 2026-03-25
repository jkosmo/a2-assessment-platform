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
- [INCIDENTS.md](INCIDENTS.md)

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
3. `startup.mjs` imports and runs `scripts/runtime/bootstrapSeed.mjs` (gated by `BOOTSTRAP_SEED=true`)
4. `startup.mjs` imports `dist/src/index.js`
5. `src/index.ts` starts the Express server and binds the web listener

Important notes:
- bootstrap seed runs as part of `startup.mjs` before the app is imported, regardless of role
- `bootstrapSeed.mjs` gates itself on `BOOTSTRAP_SEED=true` — safe to always invoke
- production Azure config sets `BOOTSTRAP_SEED=false`

### Worker role startup

Worker startup differs intentionally:

1. `startup.mjs` runs
2. Azure worker app sets `SKIP_MIGRATE=true`, so migrations are skipped
3. `dist/src/index.js` is imported
4. `src/index.ts` starts a minimal HTTP listener and starts:
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

In worker-only mode, `src/index.ts` starts a minimal HTTP server that returns:

```json
{"status":"ok","role":"worker"}
```

for incoming requests. This is only a process heartbeat. It does not prove that:
- jobs are being picked up
- stale locks are being reset
- LLM calls are succeeding

Use logs and queue signals for worker health.

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

Current Azure expectation:
- staging may use bootstrap seed
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
