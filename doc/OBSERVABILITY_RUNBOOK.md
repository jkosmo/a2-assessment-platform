# Observability Runbook (MVP Baseline)

## Scope
This runbook covers first-response operations for:
- HTTP latency degradation
- LLM evaluation failures
- Assessment queue backlog growth
- Overdue appeal escalation

This baseline is implemented through:
- Correlation ID request logging (`x-correlation-id`)
- Structured operational log events
- Azure Monitor alerts (metric + log alerts)

## Deployed Signals
### Correlation ID
- Request middleware sets or propagates `x-correlation-id`.
- Response includes `x-correlation-id` for every request.
- Request completion log includes correlation id, status code, and duration.

### Structured Events
- `llm_evaluation_failed`
- `assessment_queue_backlog`
- `appeal_sla_backlog`
- `appeal_overdue_detected`
- `http_request`

## Alert Baseline
### Latency Alert
- Signal: App Service metric `AverageResponseTime`
- Window/Frequency: 5m / 5m
- Severity: Sev2

### LLM Failure Alert
- Signal: Log query for `llm_evaluation_failed`
- Window/Frequency: 5m / 5m
- Severity: Sev2

### Queue Backlog Alert
- Signal: Log query for `assessment_queue_backlog` with `pendingJobs >= threshold`
- Window/Frequency: 10m / 10m
- Severity: Sev2

### Appeal Overdue Alert
- Signal: Log query for `appeal_overdue_detected` with `overdueAppeals >= threshold`
- Window/Frequency: 10m / 10m
- Severity: Sev2

## First Response Checklist
1. Confirm service health:
   - `GET /healthz`
2. Check recent deploys in GitHub Actions and App Service deployment history.
3. Pull the correlation id from failing client response/header.
4. Query logs around that correlation id and time window.
5. Determine impact scope:
   - single user/module or broad system issue
6. Apply immediate mitigation:
   - retry transient jobs
   - reduce load/test traffic
   - rollback last deploy if regression is confirmed
7. For appeal-overdue incidents:
   - confirm queue ownership and assign handler
   - acknowledge alert in operations channel/ticket system
   - capture expected resolution timestamp
8. Record incident summary and follow-up issue.

## KQL Queries
Replace `<workspace-id>` and adjust time window as needed.

### LLM Failures (recent)
```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(1h)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has "\"event\":\"llm_evaluation_failed\""
| project TimeGenerated, raw
| order by TimeGenerated desc
```

### Queue Backlog Trend
```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(1h)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has "\"event\":\"assessment_queue_backlog\""
| extend pendingJobs = toint(extract("\"pendingJobs\":([0-9]+)", 1, raw))
| where isnotnull(pendingJobs)
| summarize maxPending = max(pendingJobs), avgPending = avg(pendingJobs) by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

### Slow Requests
```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(1h)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has "\"event\":\"http_request\""
| extend durationMs = todouble(extract("\"durationMs\":([0-9]+)", 1, raw))
| where isnotnull(durationMs)
| summarize p95DurationMs = percentile(durationMs, 95), maxDurationMs = max(durationMs) by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

### Overdue Appeals (recent)
```kusto
union isfuzzy=true AppServiceConsoleLogs, AzureDiagnostics
| where TimeGenerated > ago(1h)
| extend raw = coalesce(tostring(column_ifexists("ResultDescription", "")), tostring(column_ifexists("Message", "")), tostring(column_ifexists("Log_s", "")))
| where raw has "\"event\":\"appeal_overdue_detected\""
| extend overdueAppeals = toint(extract("\"overdueAppeals\":([0-9]+)", 1, raw))
| extend overdueThreshold = toint(extract("\"overdueThreshold\":([0-9]+)", 1, raw))
| extend oldestOverdueHours = todouble(extract("\"oldestOverdueHours\":([0-9.]+)", 1, raw))
| project TimeGenerated, overdueAppeals, overdueThreshold, oldestOverdueHours, raw
| order by TimeGenerated desc
```

## Useful Azure CLI Commands
```bash
# List alerts in resource group
az monitor metrics alert list -g <resource-group> -o table
az monitor scheduled-query list -g <resource-group> -o table

# List App Insights + Log Analytics
az monitor app-insights component list -g <resource-group> -o table
az monitor log-analytics workspace list -g <resource-group> -o table
```

## Follow-up Improvements (Post-MVP)
- Route alerts to Teams/incident system webhook.
- Add SLO dashboard/workbook for latency, queue depth, and failure rates.
- Add synthetic probes for key user journeys.
