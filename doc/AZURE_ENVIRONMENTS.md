# Azure Environments Runbook

## Scope
Automated provisioning and deployment for:
- `staging`
- `production`

Each environment must use a dedicated resource group and be deployable via CI/CD.

## Artifacts
- Infrastructure template: `infra/azure/main.bicep`
- Deployment script: `scripts/azure/deploy-environment.ps1`
- Cost guardrails script: `scripts/azure/configure-cost-guardrails.ps1`
- CI/CD workflow: `.github/workflows/deploy-azure.yml`
- Observability runbook: `doc/OBSERVABILITY_RUNBOOK.md`
- Environment variable templates:
- `.azure/environments/staging.env.example`
- `.azure/environments/production.env.example`

## Architecture (cost-optimized baseline)
- Azure App Service Linux (Node 22) on small SKU (`B1` default).
- Workspace-based Application Insights + Log Analytics workspace.
- Azure Monitor alerts baseline:
- latency metric alert (App Service)
- LLM failure log alert
- assessment queue backlog log alert
- appeal overdue escalation log alert
- Single-instance non-critical setup.
- SQLite file persisted at `/home/site/data/app.db` (non-critical baseline only).

## Environment separation
- Staging resource group example: `rg-a2-assessment-staging`
- Production resource group example: `rg-a2-assessment-production`
- No shared resource group between environments.

## GitHub setup requirements
Create GitHub Environments:
- `staging`
- `production` (configure required reviewers for manual approval)

For each environment, define variables/secrets used by workflow:
- Secrets:
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `PARTICIPANT_NOTIFICATION_WEBHOOK_URL` (optional; required when channel=`webhook`)
- Variables:
- `AZURE_LOCATION`
- `AZURE_RESOURCE_GROUP`
- `AZURE_APP_NAME_PREFIX`
- `AZURE_APP_SERVICE_SKU`
- `AZURE_COST_CENTER`
- `AZURE_OWNER`
- `AUTH_MODE`
- `ENTRA_TENANT_ID`
- `ENTRA_AUDIENCE`
- `ENTRA_SYNC_GROUP_ROLES`
- `ENTRA_GROUP_ROLE_MAP_JSON`
- `LLM_MODE`
- `LLM_STUB_MODEL_NAME`
- `ASSESSMENT_JOB_POLL_INTERVAL_MS`
- `ASSESSMENT_JOB_MAX_ATTEMPTS`
- `OBSERVABILITY_ALERT_EMAIL` (optional)
- `QUEUE_BACKLOG_ALERT_THRESHOLD` (optional, default `5`)
- `LATENCY_ALERT_THRESHOLD_SECONDS` (optional, default `3`)
- `APPEAL_OVERDUE_ALERT_THRESHOLD` (optional, default `1`)
- `APPEAL_SLA_MONITOR_INTERVAL_MS` (optional, default `600000`)
- `PARTICIPANT_NOTIFICATION_CHANNEL` (optional, default `log`)
- `PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS` (optional, default `5000`)
- `BUDGET_CONTACT_EMAIL`
- `MONTHLY_BUDGET_AMOUNT`

## Deployment flow
1. Push to `main`:
- Deploys `staging` automatically.
2. Manual dispatch with `deploy_production=true`:
- Deploys `staging` first.
- Waits for `production` environment approval.
- Deploys `production` after approval.

## Cost guardrails
- Resource tags: `environment`, `costCenter`, `owner`.
- Optional monthly budget + alert via `configure-cost-guardrails.ps1`.
- Budget setup requires suitable billing permissions.

## Manual verification checklist
1. Confirm RG exists per environment.
2. Confirm Web App and App Service Plan deployed in correct RG.
3. Open app URL from workflow logs.
4. Call `/healthz` and `/api/me`.
5. Validate budget object exists (if budget email configured).
6. Validate production deploy is blocked until manual approval.
7. Validate alerts exist in Azure Monitor for latency, LLM failures, queue backlog, and overdue appeals.
