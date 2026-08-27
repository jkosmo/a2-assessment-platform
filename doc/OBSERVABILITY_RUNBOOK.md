# Observability Runbook

This runbook covers the currently implemented observability model for:
- request tracing
- worker health
- queue behavior
- LLM failures
- appeal SLA monitoring
- participant notification delivery
- unhandled runtime failures

Related documents:
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
- [AZURE_ENVIRONMENTS.md](AZURE_ENVIRONMENTS.md)
- [INCIDENTS.md](INCIDENTS.md)

## Current Signal Model

Structured operational logs are emitted through:
- `src/observability/operationalLog.ts`

Request-scoped observability is attached through:
- `src/middleware/requestObservability.ts`

Unhandled runtime failures are surfaced through:
- `src/middleware/errorHandling.ts`

Current Azure deployment sends diagnostics from both:
- web App Service
- worker App Service

into Log Analytics.

## Request Tracing

Header:
- `x-correlation-id`

Behavior:
- propagated if present
- generated if absent
- returned in the response header
- included in `http_request`
- included in `unhandled_error`

Primary request event:
- `http_request`

Current payload includes:
- `correlationId`
- `method`
- `path`
- `statusCode`
- `durationMs`
- `userId`

Use correlation IDs first when diagnosing single-request or single-user failures.

## Current Structured Events

### Web/runtime events
- `http_request`
- `unhandled_error`
- `submission_document_parse`

### Assessment worker events
- `assessment_queue_backlog`
- `llm_evaluation_failed`
- `assessment_job_stale_lock_detected`
- `assessment_job_stuck_alert`
- `assessment_failed_backlog_alert` — error. Assessments that used up every retry and are still
  waiting for a human (#953). Carries `failedCount`, `threshold` and `recipientCount`. ⚠️ A
  `recipientCount` of 0 means nobody could be e-mailed — the platform has no active ADMINISTRATOR
  role assignment. The backlog is real regardless; this is the line that says so.
- `assessment_decision_already_present` — info. A run stopped because the submission already had a
  decision (#953, requirement 2). Not a fault: a job that arrived too late. Frequent occurrences are
  themselves the finding — it means runs are being abandoned near the runtime deadline.
- `insufficient_evidence_pattern_only` — **error, and worth reading.** The substring fallback in
  `hasInsufficientEvidenceSignal` was the ONLY thing reporting "insufficient evidence" — the
  structured fields (`evidence_sufficiency`, `manual_review_reason_code`) said otherwise (#1026).
  ⚠️ That signal feeds `autoFailForInsufficientEvidence`, which **suppresses manual review**. When
  `llmRecommendedManualReview` is true in the payload, a phrase in the model's own improvement
  advice — patterns like `additional material` or `detailed reflection` — may have turned a case a
  human should have seen into an automatic fail.
  Carries `assessmentPass` (`primary`/`secondary`), `matchedPatterns`, and the structured values.
  **What to do:** these are the measurements that decide whether the fallback can be removed. Count
  them; if `llmRecommendedManualReview` is true in any of them, treat that submission as one to
  re-check by hand.
- `secondary_trigger_shadow_diff` — info. The live trigger for a second assessment (substrings in
  the model's free text) and the proposed structured rule disagreed (#1023). Behaviour is unchanged;
  this is measurement only. ⚠️ Read the comment on #1023 before interpreting: as of 2026-08-27 the
  structured rule never fires in our sample, so disagreements will almost all point one way.

### Appeal monitoring events
- `appeal_sla_backlog`
- `appeal_overdue_detected`

### Notification events
- `participant_notification_sent`
- `participant_notification_failed`
- `participant_notification_pipeline_failed`

#989: `recertification_reminder_sent` / `recertification_reminder_failed` are **no longer emitted** —
recertification of modules was removed. `certification_downgrade_skipped` (previously
`recertification_downgrade_skipped`) is unrelated to expiry and is still emitted: it fires when a
late-resolving FAIL from an *older* submission would have downgraded a certification earned by a
newer one.

## Alert Baseline

The pilot alert baseline is intentionally small and focused on failures that otherwise require manual log discovery.

### Web latency alert
- Alert resource: `*-latency-*`
- Source: App Service metric `AverageResponseTime`
- Severity: Sev2
- Evaluates HTTP latency on the web app

### LLM evaluation failure alert
- Alert display name: `LLM evaluation failures detected`
- Source: log query over `llm_evaluation_failed`
- Severity: Sev2

### Queue backlog alert
- Alert display name: `Assessment queue backlog is above threshold`
- Source: log query over `assessment_queue_backlog`
- Severity: Sev2
- Alert logic applies a pending-job threshold in Azure query configuration

### Appeal overdue alert
- Alert display name: `Overdue appeals detected`
- Source: log query over `appeal_overdue_detected`
- Severity: Sev2

### Worker distress alert
- Alert resources:
  - `a2-assessment-platform-stg-worker-health`
  - `a2-assessment-platform-prd-worker-health`
- Source: App Service metric `HealthCheckStatus` on the worker app
- Severity: Sev1
- Purpose: catch worker unhealthy/crash states without waiting for manual log discovery

### Unhandled runtime error alert
- Alert display name: `Unhandled runtime errors detected`
- Source: log query over:
  - `unhandled_error`
  - `unhandled_rejection`
  - `uncaught_exception`
- Severity: Sev1

### Participant notification delivery alert
- Alert display name: `Participant notification delivery failures detected`
- Created when notification delivery uses `acs_email` or `webhook`
- Source: log query over:
  - `participant_notification_failed`
  - `participant_notification_pipeline_failed`
  - `recertification_reminder_failed` — **dead clause since #989**; nothing emits it any more. The
    Bicep query (`infra/azure/main.bicep`) still contains it. Harmless (the alert still fires on the
    two live events); tidy it up on the next infra-touching deploy rather than dragging a Bicep
    change into a code-only release.
- Severity: Sev2

## Signals Without Dedicated Azure Alerts

These events are useful today but are not described as first-class Azure alerts in the baseline:
- `assessment_job_stale_lock_detected`
- `assessment_job_stuck_alert`
- `submission_document_parse`
- notification success events
- `certification_downgrade_skipped`

They should still be queried during incident response.

## Alert First Response

### Worker distress alert
- Alert:
  - `a2-assessment-platform-stg-worker-health`
  - `a2-assessment-platform-prd-worker-health`
- First checks:
  - confirm worker `GET /healthz`
  - check recent restart activity and deployment timing
  - check for `uncaught_exception`, `unhandled_rejection`, and startup failures in the worker log stream

### Unhandled runtime error alert
- Alert: `Unhandled runtime errors detected`
- First checks:
  - separate web-path failures from worker-path failures
  - pull a recent sample from `unhandled_error`, `unhandled_rejection`, or `uncaught_exception`
  - correlate to deploy window, affected route, and recent user flow

### Participant notification delivery alert
- Alert: `Participant notification delivery failures detected`
- First checks:
  - confirm whether `PARTICIPANT_NOTIFICATION_CHANNEL` is `acs_email` or `webhook`
  - inspect recent `participant_notification_failed` events for `failureReason`
  - verify whether the business write succeeded and whether manual user follow-up is required

## First Response Checklist

1. Confirm whether the problem is:
   - request/web only
   - worker/queue only
   - both
2. Check `/healthz` and `/version` on the web app.
3. Check latest deploys and recent restart activity.
4. Pull a correlation ID if a specific request or user flow failed.
5. Query recent worker signals:
   - `assessment_queue_backlog`
   - `llm_evaluation_failed`
   - `assessment_job_stuck_alert`
   - `assessment_job_stale_lock_detected`
   - worker health check failures
6. Query appeal monitor signals if the incident is queue/SLA related:
   - `appeal_sla_backlog`
   - `appeal_overdue_detected`
7. Query notification events if users are missing status updates or a delivery alert fired.
8. Record findings in [INCIDENTS.md](INCIDENTS.md).

## Core KQL Queries

All queries below assume data is coming from App Service console logs and Azure diagnostics.

### Trace a correlation ID

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

### Recent unhandled errors

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has "\"event\":\"unhandled_error\""
| project TimeGenerated, raw
| order by TimeGenerated desc
```

### Recent LLM failures

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has "\"event\":\"llm_evaluation_failed\""
| project TimeGenerated, raw
| order by TimeGenerated desc
```

### Queue backlog trend

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has "\"event\":\"assessment_queue_backlog\""
| extend pendingJobs = toint(extract("\"pendingJobs\":([0-9]+)", 1, raw))
| extend runningJobs = toint(extract("\"runningJobs\":([0-9]+)", 1, raw))
| summarize maxPending = max(pendingJobs), maxRunning = max(runningJobs) by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

### Stale-lock resets or failures

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has "\"event\":\"assessment_job_stale_lock_detected\""
| project TimeGenerated, raw
| order by TimeGenerated desc
```

### Stuck-job alerts

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has "\"event\":\"assessment_job_stuck_alert\""
| project TimeGenerated, raw
| order by TimeGenerated desc
```

### Slow request trend

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has "\"event\":\"http_request\""
| extend durationMs = todouble(extract("\"durationMs\":([0-9]+)", 1, raw))
| where isnotnull(durationMs)
| summarize p95DurationMs = percentile(durationMs, 95), maxDurationMs = max(durationMs) by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

### Appeal SLA backlog and overdue cases

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has_any ("\"event\":\"appeal_sla_backlog\"", "\"event\":\"appeal_overdue_detected\"")
| project TimeGenerated, raw
| order by TimeGenerated desc
```

### Notification delivery failures

```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(2h)
| extend raw = coalesce(
    tostring(column_ifexists("ResultDescription", "")),
    tostring(column_ifexists("Message", "")),
    tostring(column_ifexists("Log_s", ""))
  )
| where raw has_any (
    "\"event\":\"participant_notification_failed\"",
    "\"event\":\"participant_notification_pipeline_failed\"",
    "\"event\":\"recertification_reminder_failed\""
  )
| project TimeGenerated, raw
| order by TimeGenerated desc
```

## Azure CLI Shortcuts

```bash
az monitor metrics alert list -g <resource-group> -o table
az monitor scheduled-query list -g <resource-group> -o table
az monitor app-insights component list -g <resource-group> -o table
az monitor log-analytics workspace list -g <resource-group> -o table
```

## Interpretation Notes

### `assessment_queue_backlog`
- emitted on enqueue and worker cycle
- not every emission means an incident
- watch the trend, not one isolated event

### `assessment_job_stale_lock_detected`
- means a leased running job expired and was reset or failed
- repeated occurrences point to worker instability or downstream latency

### `assessment_job_stuck_alert`
- means a running job exceeded the stuck threshold
- treat as warning for investigation even if recovery later succeeds

### `participant_notification_pipeline_failed`
- means the workflow finished but the notification side-effect failed
- do not assume the business write failed just because the notification did

### `Container get mounts received unexpected exception` (platform docker log)
- benign cosmetic Linux App Service / Run-From-Package platform message — not an app error
- emitted by Azure during the cold-start container mount check, regardless of Always On
- triaged + closed not-planned in #423 (2026-05-27) with evidence: warning persists on cold starts but never correlates with functional failures
- ignore unless it starts coinciding with real `/healthz` failures or container restarts

### `Credential-drift check (#410): …` (deploy log)
- emitted by `deploy-environment.ps1` pre-flight on every full Bicep deploy
- read the `kvRead=` tag and the surrounding message for the path taken — see `doc/OPERATIONS_RUNBOOK.md` → "PG deploy hits `ServerIsBusy` or every deploy updates the server" for the full table
- a `kvRead=secret-read` + "skip is safe" line is the happy path; anything else explains why the deploy chose to force a PG server update

## Follow-up Directions

The current baseline is useful but still modest.
Natural next observability upgrades:
- dashboards/workbooks for queue and worker posture
- alerting for stuck-job patterns and unhandled-error rates
- synthetic probes for key participant and admin flows
