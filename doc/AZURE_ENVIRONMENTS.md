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
- `AZURE_OPENAI_API_KEY` (required when `LLM_MODE=azure_openai`)
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
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION` (optional, default `2024-10-21`)
- `AZURE_OPENAI_TIMEOUT_MS` (optional, default `30000`)
- `AZURE_OPENAI_TEMPERATURE` (optional, default `0`)
- `AZURE_OPENAI_MAX_TOKENS` (optional, default `1200`)
- `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER` (optional, `max_tokens` | `max_completion_tokens` | `auto`, default `auto`)
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

## Azure OpenAI runtime profiles
Use environment variables to switch model cost/quality profile without code changes.

### Recommended staging profile (`gpt-5-nano`)
- `LLM_MODE=azure_openai`
- `AZURE_OPENAI_DEPLOYMENT=a2-assessment-stage-gpt-5-nano` (or your staging deployment name)
- `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`
- `AZURE_OPENAI_TEMPERATURE=1`
- `AZURE_OPENAI_MAX_TOKENS=4000`
- `AZURE_OPENAI_TIMEOUT_MS=45000`

Why:
- `gpt-5-nano` may reject `temperature=0` and require default behavior.
- Larger token limit avoids empty assistant content on long structured prompts.
- `auto` token parameter supports both `max_completion_tokens` and `max_tokens` model families.

### Recommended production baseline (`balanced`)
- `LLM_MODE=azure_openai`
- `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`
- `AZURE_OPENAI_TEMPERATURE=1` (or model-supported value)
- `AZURE_OPENAI_MAX_TOKENS=2500`
- `AZURE_OPENAI_TIMEOUT_MS=45000`
- `AZURE_OPENAI_DEPLOYMENT=<prod-balanced-deployment>`

### Recommended production high-quality profile (`quality`)
- `LLM_MODE=azure_openai`
- `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`
- `AZURE_OPENAI_TEMPERATURE=1` (or model-supported value)
- `AZURE_OPENAI_MAX_TOKENS=5000`
- `AZURE_OPENAI_TIMEOUT_MS=90000`
- `AZURE_OPENAI_DEPLOYMENT=<prod-quality-deployment>`

## Production onboarding checklist for Azure OpenAI
1. Create production GitHub environment (`production`) if missing.
2. Add required environment secrets:
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_OPENAI_API_KEY`
3. Add production variables:
- `LLM_MODE=azure_openai`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION=2024-10-21`
- `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`
- `AZURE_OPENAI_TEMPERATURE` (model-compatible)
- `AZURE_OPENAI_MAX_TOKENS` (profile-dependent)
- `AZURE_OPENAI_TIMEOUT_MS` (profile-dependent)
4. Trigger `workflow_dispatch` deploy with production approval.
5. Verify:
- `/version` and `/healthz`
- end-to-end submission -> MCQ -> assessment -> result
- `llmEvaluation.modelName` references expected deployment
- no sustained `llm_evaluation_failed` alerts

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
