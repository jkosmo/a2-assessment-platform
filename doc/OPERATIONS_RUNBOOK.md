# Operations Runbook

Covers day-to-day operation of the a2 Assessment Platform: startup, migrations, seeding, worker health, failure diagnosis, and tracing.

For Azure alerting signals and KQL queries see [OBSERVABILITY_RUNBOOK.md](OBSERVABILITY_RUNBOOK.md).
For environment variables and provisioning see [AZURE_ENVIRONMENTS.md](AZURE_ENVIRONMENTS.md).

---

## Process Model

The platform runs as a **single Node.js process** that handles both HTTP requests and background work:

| Component | Role |
|---|---|
| Express HTTP server | Serves all API routes and static workspace files |
| `AssessmentWorker` | Polls for pending assessment jobs and processes them asynchronously |
| `AppealSlaMonitor` | Checks for overdue appeals on a configurable interval and emits alerts |

Both background components start automatically on process startup and stop gracefully on `SIGTERM`/`SIGINT`.

> **Planned:** Web/worker process separation is tracked in epic #169. When implemented, a `PROCESS_ROLE` env var will control which components start (`web`, `worker`, or `all`). Until then, all roles run in the same process.

### Startup sequence

```
npm start
  └── scripts/runtime/startup.mjs
        1. prisma migrate deploy        # apply pending schema migrations
        2. (fallback) prisma db push    # only if PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK=true
        3. scripts/runtime/bootstrapSeed.mjs   # idempotent seed for lookup data
        4. src/index.ts                 # start HTTP server + AssessmentWorker + AppealSlaMonitor
```

The process will **exit with code 1** if migrations or the seed step fail. Check logs for the exact Prisma error before restarting.

### Health check

```
GET /healthz
```

Returns `200 OK` when the HTTP server is up. Does not check database connectivity or worker state — use the structured log signals for that (see below).

---

## Running Migrations

### Production / staging (CI/CD)

Migrations run automatically at startup via `startup.mjs`. No manual step is needed for normal deploys.

### Manual migration (emergency or local)

```bash
# Apply pending migrations
npm run db:migrate

# Reset and re-seed (destroys all data — dev/test only)
npm run db:reset && tsx prisma/seed.ts
```

Migration files live in `prisma/migrations/`. Never edit existing migration files — add new ones with `prisma migrate dev --name <description>`.

---

## Seeding

### Bootstrap seed (runs at every startup)

`scripts/runtime/bootstrapSeed.mjs` is idempotent and runs at every process start. It creates or updates reference data that the application requires to function (e.g. default module data).

### Full development seed

```bash
# After a db reset, restore a full dev dataset
npm run postgres:app:seed
# or
tsx prisma/seed.ts
```

### Test seed

```bash
npm run postgres:test:seed
# or
dotenv -e .env.test -- tsx prisma/seed.ts
```

---

## Worker Role and Health Indicators

### AssessmentWorker

Polls `assessmentJob` table for jobs in `PENDING` status. Each tick:
1. Claims the next available job (sets status → `PROCESSING`, locks with `workerId`)
2. Runs LLM evaluation and decision logic
3. Writes the decision, updates submission status, emits audit events
4. On failure: increments attempt counter; after `ASSESSMENT_JOB_MAX_ATTEMPTS` marks the job `FAILED`

**Key env vars:**

| Var | Default | Description |
|---|---|---|
| `ASSESSMENT_JOB_POLL_INTERVAL_MS` | `5000` | How often the worker polls for new jobs |
| `ASSESSMENT_JOB_MAX_ATTEMPTS` | `3` | Max attempts before a job is marked FAILED |

**Health signals** (check via structured logs or KQL):
- `assessment_queue_backlog` — emitted when pending job count exceeds threshold; indicates worker is falling behind
- `llm_evaluation_failed` — emitted on each LLM call failure; persistent pattern = LLM connectivity or quota issue

**Stale jobs:** A job stuck in `PROCESSING` for an unexpectedly long time may indicate a crashed worker that did not release the lock. These require manual intervention until stale-lock recovery (#170) is implemented:
```sql
-- Identify stale PROCESSING jobs
SELECT id, "submissionId", "workerId", "updatedAt"
FROM "AssessmentJob"
WHERE status = 'PROCESSING'
  AND "updatedAt" < NOW() - INTERVAL '10 minutes';

-- Reset a stale job back to PENDING (after confirming worker is dead)
UPDATE "AssessmentJob"
SET status = 'PENDING', "workerId" = NULL, "attemptCount" = "attemptCount"
WHERE id = '<job-id>';
```

### AppealSlaMonitor

Checks for appeals past their SLA deadline on a configurable interval.

**Key env vars:**

| Var | Default | Description |
|---|---|---|
| `APPEAL_SLA_MONITOR_INTERVAL_MS` | `600000` (10m) | Check interval |
| `APPEAL_OVERDUE_ALERT_THRESHOLD` | `1` | Minimum overdue count before an alert is emitted |

**Health signal:** `appeal_overdue_detected` — contains `overdueAppeals` count and `oldestOverdueHours`.

---

## Common Failure States

### Database unreachable at startup

**Symptom:** Process exits immediately with a Prisma `Can't reach database server` error.

**Steps:**
1. Confirm `DATABASE_URL` is set and points to the correct host/port.
2. Check PostgreSQL server status (App Service → PostgreSQL resource → Overview).
3. If the DB is healthy, check App Service network/VNet configuration.
4. Check for pending firewall rules blocking the connection.

### Migration fails at startup

**Symptom:** `startup.mjs` exits with a non-zero code before the HTTP server starts.

**Steps:**
1. Check the migration log for the specific error.
2. If the migration has a schema conflict, roll back to the previous deploy via GitHub Actions (Deployments tab → re-run previous workflow).
3. If it's a new migration that needs to be applied manually, run `npm run db:migrate` from a connected environment.

> `PRISMA_RUNTIME_ALLOW_DB_PUSH_FALLBACK=true` enables a `prisma db push` fallback — use only for non-production environments during initial database provisioning. Never use in production.

### LLM evaluation failures

**Symptom:** `llm_evaluation_failed` log events; submissions stuck in `PENDING` assessment state.

**Steps:**
1. Check `LLM_MODE` env var. `stub` mode should never fail — if it does, it's a code bug.
2. For `azure_openai` mode: verify `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_KEY` are set correctly.
3. Check Azure OpenAI quota and rate limits in the Azure portal.
4. If the deployment is down: jobs will retry up to `ASSESSMENT_JOB_MAX_ATTEMPTS` times. After that the job is marked `FAILED` — manual re-queuing is required (set `status = 'PENDING'` in the database).

### Assessment queue backlog growing

**Symptom:** `assessment_queue_backlog` alert fires; queue depth increasing over time.

**Steps:**
1. Confirm the AssessmentWorker is running — check for `assessmentWorker.start()` in startup logs.
2. Check for LLM failures (stalled evaluation = jobs not completing).
3. Check `ASSESSMENT_JOB_POLL_INTERVAL_MS` — if set very high, reduce it.
4. If backlog is due to a spike in submissions, it should drain automatically. Monitor queue depth trend.

### Worker process crash (unhandled exception)

**Symptom:** No log output from worker; new submissions not progressing to assessment.

**Steps:**
1. Restart the App Service instance (or trigger a new deploy).
2. Check `uncaughtException` / `unhandledRejection` events in structured logs.
3. Jobs left in `PROCESSING` after the crash need manual reset (see stale job query above).

### Participant notifications not delivered

**Symptom:** `participant_notification_failed` or `participant_notification_pipeline_failed` events in logs.

**Steps:**
1. Check `PARTICIPANT_NOTIFICATION_CHANNEL` (`log`, `webhook`, or `email`).
2. For `webhook` mode: verify `PARTICIPANT_NOTIFICATION_WEBHOOK_URL` is reachable and returns 2xx.
3. For `email` mode: verify Azure Communication Services credentials are configured.
4. For `log` mode: this should never fail — if it does, it's a code bug.

---

## Tracing with Correlation ID

Every request gets a `x-correlation-id` header (generated or propagated from the client). It appears in:
- The response header `x-correlation-id`
- Every structured log event emitted during that request

**To trace a failing request:**

1. Get the correlation ID from the failing response header, client error log, or user report.
2. Query logs by correlation ID (replace `<corr-id>`):

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has "<corr-id>"
| project TimeGenerated, raw
| order by TimeGenerated asc
```

3. Review the full event sequence: auth → route handler → service calls → response.
4. For assessment jobs spawned by the request, the job ID is logged at submission time — search for it to follow the async path.

For additional KQL queries (LLM failures, queue backlog, slow requests, overdue appeals) see [OBSERVABILITY_RUNBOOK.md](OBSERVABILITY_RUNBOOK.md).
