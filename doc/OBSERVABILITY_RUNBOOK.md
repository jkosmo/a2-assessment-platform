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
- [OPERATIONS_RUNBOOK.md](/c:/Users/JoakimKosmo/a2-assessment-platform/doc/OPERATIONS_RUNBOOK.md)
- [AZURE_ENVIRONMENTS.md](/c:/Users/JoakimKosmo/a2-assessment-platform/doc/AZURE_ENVIRONMENTS.md)
- [INCIDENTS.md](/c:/Users/JoakimKosmo/a2-assessment-platform/doc/INCIDENTS.md)

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

### Appeal monitoring events
- `appeal_sla_backlog`
- `appeal_overdue_detected`

### Notification events
- `participant_notification_sent`
- `participant_notification_failed`
- `participant_notification_pipeline_failed`
- `recertification_reminder_sent`
- `recertification_reminder_failed`

## Alert Baseline

The current Azure alert baseline is narrower than the full signal list.

Implemented alert-backed concerns:

### Latency alert
- Source: App Service metric `AverageResponseTime`
- Severity: Sev2
- Evaluates HTTP latency on the web app

### LLM failure alert
- Source: log query over `llm_evaluation_failed`
- Severity: Sev2

### Queue backlog alert
- Source: log query over `assessment_queue_backlog`
- Severity: Sev2
- Alert logic applies a pending-job threshold in Azure query configuration

### Appeal overdue alert
- Source: log query over `appeal_overdue_detected`
- Severity: Sev2

## Signals Without Dedicated Azure Alerts

These events are useful today but are not described as first-class Azure alerts in the baseline:
- `assessment_job_stale_lock_detected`
- `assessment_job_stuck_alert`
- `unhandled_error`
- `submission_document_parse`
- notification success/failure events
- recertification reminder events

They should still be queried during incident response.

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
6. Query appeal monitor signals if the incident is queue/SLA related:
   - `appeal_sla_backlog`
   - `appeal_overdue_detected`
7. Query notification events if users are missing status updates.
8. Record findings in [INCIDENTS.md](/c:/Users/JoakimKosmo/a2-assessment-platform/doc/INCIDENTS.md).

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

## Follow-up Directions

The current baseline is useful but still modest.
Natural next observability upgrades:
- dashboards/workbooks for queue and worker posture
- alerting for stuck-job patterns and unhandled-error rates
- synthetic probes for key participant and admin flows
