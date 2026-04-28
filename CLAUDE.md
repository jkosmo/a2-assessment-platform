# CLAUDE.md — Critical context for AI agents

## ⚠️ CRITICAL: PRODUCTION AND STAGING USE DIFFERENT AZURE TENANTS

**THIS IS THE SINGLE MOST IMPORTANT THING TO KNOW BEFORE RUNNING ANY `az` CLI COMMANDS.**

| Environment | Azure Tenant ID | Subscription | Subscription Name |
|-------------|-----------------|--------------|-------------------|
| **staging** | `c6e381fa-eb4b-42ba-b358-fe83e1166c40` | `df46af7a-1806-4bda-a24b-0b3c112bd261` | Betale for forbruk |
| **production** | `a018856e-8cf2-4ec4-bbc8-ab18058027dc` | `5b3f760b-42d4-4d78-812c-c059278d1086` | Pay-As-You-Go (A-2) |

### WHY THIS MATTERS

The local Azure CLI defaults to the **staging tenant** (`c6e381fa-...`). If you run `az` commands to inspect production resources without switching subscription first, YOU WILL QUERY THE WRONG TENANT AND GET EMPTY OR MISLEADING RESULTS. This has caused multiple incidents where deployment hangs were misdiagnosed.

### MANDATORY PATTERN FOR PRODUCTION AZ COMMANDS

```powershell
# Always switch to production subscription before querying production resources
az account set --subscription 5b3f760b-42d4-4d78-812c-c059278d1086

# ... run az commands ...

# Switch back to staging when done
az account set --subscription df46af7a-1806-4bda-a24b-0b3c112bd261
```

### HOW TO VERIFY WHICH TENANT YOU ARE ON

```bash
az account show --query "{subscription:id,tenantId:tenantId,name:name}" -o table
```

- Tenant `c6e381fa-...` = staging
- Tenant `a018856e-...` = production

### ENTRA vs AZURE TENANT

`ENTRA_TENANT_ID` in GitHub environment variables is the **application authentication tenant** (for SSO login). The **Azure deployment tenant** is controlled by the `AZURE_TENANT_ID` **secret** in each GitHub environment. These happen to be the same values per environment, but they serve different purposes.

### ACS EMAIL PROVISIONING IS SLOW

Both staging and production have `PARTICIPANT_NOTIFICATION_CHANNEL=acs_email`. The `Microsoft.Communication/emailServices/domains` resource takes **20–40 minutes to provision** on first creation or recreation. This is NORMAL. Do not cancel deploys just because they run 30+ minutes — check the ARM deployment operations first:

```bash
az account set --subscription 5b3f760b-42d4-4d78-812c-c059278d1086  # production
az deployment operation group list \
  --resource-group rg-a2-assessment-production \
  --name <deployment-name> \
  --query "[?properties.provisioningState!='Succeeded'].{resource:properties.targetResource.resourceType,state:properties.provisioningState}" \
  -o table
```

---

## Project overview

A2 Assessment Platform — Next.js + Prisma + PostgreSQL on Azure App Service.

- Infrastructure: `infra/azure/main.bicep`
- Deploy script: `scripts/azure/deploy-environment.ps1`
- CI/CD: `.github/workflows/deploy-azure.yml`
- Environments runbook: `doc/AZURE_ENVIRONMENTS.md`

## Workflow conventions

- Always bump `package.json` version and `doc/VERSIONS.md` in the same commit as code changes.
- Create GitHub issue → specify/plan → implement → test → document, in that order.
- Deploy cadence: staging deploys on push to `main`; production requires manual `workflow_dispatch` with `deploy_production=true`.
