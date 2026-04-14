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
- Azure Database for PostgreSQL Flexible Server as the runtime datastore.
- Workspace-based Application Insights + Log Analytics workspace.
- Azure Monitor alerts baseline:
- latency metric alert (App Service)
- LLM failure log alert
- assessment queue backlog log alert
- appeal overdue escalation log alert
- Single-instance non-critical app tier with one managed PostgreSQL server per environment.
- App startup runs `scripts/runtime/startup.mjs`, which prefers `prisma migrate deploy` against the injected `DATABASE_URL`.

Current baseline note:
- Azure runtime uses password-based PostgreSQL authentication wired from GitHub Environment secrets into App Service settings.
- Non-production environments may temporarily allow a `prisma db push` compatibility fallback while already-provisioned databases are converged onto the new PostgreSQL migration baseline.
- Microsoft Entra database authentication is still a follow-up hardening step, not part of the current automated baseline.
- Production backup and recovery target architecture is documented in `doc/design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md`.
- Current production decision: prioritize backup/recovery hardening ahead of PostgreSQL HA; HA is intentionally deferred while the service remains a non-critical internal application.
- Current production PostgreSQL profile should be represented explicitly in environment variables/IaC rather than portal-only drift.
- `PROCESS_ROLE`, `PORT`, and `DATABASE_URL` are platform-managed at deploy/runtime and are not expected as user-managed GitHub Environment variables.

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
- `POSTGRES_ADMIN_PASSWORD`
- `PARTICIPANT_NOTIFICATION_WEBHOOK_URL` (optional; required when channel=`webhook`)
- `AZURE_OPENAI_API_KEY` (required when `LLM_MODE=azure_openai`)
- Variables:
- `AZURE_LOCATION`
- `AZURE_RESOURCE_GROUP`
- `AZURE_APP_NAME_PREFIX`
- `AZURE_APP_SERVICE_SKU`
- `AZURE_COST_CENTER`
- `AZURE_OWNER`
- `POSTGRES_ADMIN_USERNAME` (optional, default `a2platformadmin`)
- `POSTGRES_DATABASE_NAME` (optional, default `a2assessment`)
- `POSTGRES_VERSION` (optional, default `16`)
- `POSTGRES_SKU_NAME` (optional, default `Standard_B1ms`)
- `POSTGRES_SKU_TIER` (optional, `Burstable` | `GeneralPurpose` | `MemoryOptimized`, default `Burstable`)
- `POSTGRES_STORAGE_SIZE_GB` (optional, default `32`)
- `POSTGRES_BACKUP_RETENTION_DAYS` (optional, default `7`)
- `POSTGRES_GEO_REDUNDANT_BACKUP` (optional, `Disabled` | `Enabled`, default `Disabled`)
- `POSTGRES_HIGH_AVAILABILITY_MODE` (optional, `Disabled` | `SameZone` | `ZoneRedundant`, default `Disabled`)
- `AUTH_MODE`
- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_AUDIENCE`
- `ENTRA_SYNC_GROUP_ROLES`
- `ENTRA_GROUP_ROLE_MAP_JSON`
- `LLM_MODE`
- `LLM_STUB_MODEL_NAME`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_DEPLOYMENT`
- `AZURE_OPENAI_API_VERSION` (optional, default `2024-10-21`)
- `AZURE_OPENAI_TIMEOUT_MS` (optional, default `120000`)
- `AZURE_OPENAI_TEMPERATURE` (optional, default `0`)
- `AZURE_OPENAI_MAX_TOKENS` (optional, default `1200`)
- `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER` (optional, `max_tokens` | `max_completion_tokens` | `auto`, default `auto`)
- `DEFAULT_LOCALE` (optional, default `en-GB`)
- `ASSESSMENT_JOB_POLL_INTERVAL_MS`
- `ASSESSMENT_JOB_MAX_ATTEMPTS`
- `ASSESSMENT_JOB_LEASE_DURATION_MS` (optional, default `300000`)
- `ASSESSMENT_JOB_STUCK_THRESHOLD_MS` (optional, default `600000`)
- `APPEAL_FIRST_RESPONSE_SLA_HOURS` (optional, default `24`)
- `APPEAL_RESOLUTION_SLA_HOURS` (optional, default `72`)
- `APPEAL_AT_RISK_RATIO` (optional, default `0.75`)
- `OBSERVABILITY_ALERT_EMAIL` (optional)
- `QUEUE_BACKLOG_ALERT_THRESHOLD` (optional, default `5`)
- `LATENCY_ALERT_THRESHOLD_SECONDS` (optional, default `3`)
- `APPEAL_OVERDUE_ALERT_THRESHOLD` (optional, default `1`)
- `APPEAL_SLA_MONITOR_INTERVAL_MS` (optional, default `600000`)
- `PARTICIPANT_NOTIFICATION_CHANNEL` (optional, `disabled` | `log` | `webhook` | `acs_email`, default `log`)
- `PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS` (optional, default `5000`)
- `ACS_EMAIL_SENDER_DISPLAY_NAME` (optional, default `A2 Assessment Platform`; used when `PARTICIPANT_NOTIFICATION_CHANNEL=acs_email`)
- `PARTICIPANT_CONSOLE_CONFIG_FILE` (optional, default `config/participant-console.json`)
- `PARTICIPANT_CONSOLE_DEBUG_MODE` (optional, `auto` | `true` | `false`, default `auto`)
- `BUDGET_CONTACT_EMAIL`
- `MONTHLY_BUDGET_AMOUNT`

Do not set these manually in GitHub Environment variables:
- `PROCESS_ROLE` - injected separately for web and worker apps
- `PORT` - provided by App Service
- `DATABASE_URL` - composed and injected by the deployment
- `AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING` / `ACS_EMAIL_SENDER` - provisioned and injected automatically when ACS email notifications are enabled

## Deployment flow
1. Push to `main`:
- Deploys `staging` automatically.
2. Manual dispatch with `deploy_production=true`:
- Deploys `staging` first.
- Waits for `production` environment approval.
- Deploys `production` after approval.

## Redeploy runbook
Redeploy staging:
1. Push the desired commit to `main` or trigger `.github/workflows/deploy-azure.yml`.
2. Confirm the `deploy-staging` job completes.
3. Verify the workflow logs include both `PostgreSQL server` and `PostgreSQL database` outputs.
4. Verify `/healthz`, `/version`, and a minimal participant flow in staging.

Redeploy production:
1. Trigger `.github/workflows/deploy-azure.yml` with `deploy_production=true` and the desired `ref`.
2. Wait for `deploy-staging` to complete first.
3. Approve the `production` GitHub Environment gate.
4. Verify the workflow logs include both `PostgreSQL server` and `PostgreSQL database` outputs.
5. Verify `/healthz`, `/version`, and one end-to-end production smoke path after deploy.

## Teardown runbook
Teardown should remove the whole environment resource group to avoid orphaned cost.

Staging example:
```powershell
az group delete --name rg-a2-assessment-staging --yes --no-wait
```

Production example:
```powershell
az group delete --name rg-a2-assessment-production --yes --no-wait
```

After teardown:
1. Confirm the resource group no longer exists.
2. Confirm budget/alert objects tied to the deleted scope are removed.
3. Recreate the environment only through `deploy-environment.ps1` or the GitHub Actions workflow, never by manual portal drift.

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

## Activating ACS email notifications

When `PARTICIPANT_NOTIFICATION_CHANNEL=acs_email` is set, the Bicep template automatically provisions:
- An Azure Communication Services resource
- An Email Communication Service with AzureManagedDomain (`dataLocation: Europe`)
- App settings: `AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING`, `ACS_EMAIL_SENDER`, `ACS_EMAIL_SENDER_DISPLAY_NAME`

No manual resource creation is required. To activate:
1. Set GitHub Actions variable `PARTICIPANT_NOTIFICATION_CHANNEL=acs_email` for the target environment.
2. Optionally set `ACS_EMAIL_SENDER_DISPLAY_NAME` (default: `A2 Assessment Platform`).
3. Trigger a deploy. ACS resources will be provisioned on the first run.

Note: AzureManagedDomain uses an auto-generated `azurecomm.net` sender address. To use a custom verified domain, replace the domain resource in `infra/azure/main.bicep`.

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

## Cost review runbook
Run cost review at least monthly and after any SKU/config change.

Checklist:
1. Review current spend and forecast for each environment resource group.
2. Confirm budget still matches intended non-critical baseline.
3. Confirm App Service SKU and PostgreSQL SKU/storage are still the intended low-cost tier.
4. Confirm no unexpected always-on, premium, or duplicate resources have appeared.
5. Confirm resource tags (`environment`, `costCenter`, `owner`) remain present for chargeback filtering.
6. If cost drift is found, update environment variables or Bicep parameters and redeploy rather than editing resources manually.

## Manual verification checklist
1. Confirm RG exists per environment.
2. Confirm Web App, App Service Plan, PostgreSQL Flexible Server, and PostgreSQL database deployed in correct RG.
3. Open app URL from workflow logs.
4. Call `/healthz` and `/api/me`.
5. Validate the Web App `DATABASE_URL` app setting points to the provisioned PostgreSQL server.
6. Validate budget object exists (if budget email configured).
7. Validate production deploy is blocked until manual approval.
8. Validate alerts exist in Azure Monitor for latency, LLM failures, queue backlog, and overdue appeals.
