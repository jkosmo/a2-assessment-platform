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

### ⛔ NEVER RUN THE DEPLOY SCRIPT LOCALLY ON WINDOWS

`scripts/azure/deploy-environment.ps1` **must only run on Linux** (i.e. GitHub Actions).

**Why:** On Windows the script falls back to .NET `ZipArchive` to build the deployment package. The resulting zip is not mountable by Azure App Service's Run-From-Package mechanism. The container starts, but `/home/site/wwwroot` contains only `hostingstart.html` — every request returns "Application Error". The root cause is invisible in GitHub Actions logs because the deploy step itself reports success.

**Symptom:** App shows "Application Error"; Kudu `ls /home/site/wwwroot/` returns only `hostingstart.html`; `/home/data/SitePackages/packagename.txt` points to the broken zip.

**Fix:** Trigger deployment via `gh workflow run deploy-azure.yml --ref main -f deploy_production=true`. Never run the deploy script from a Windows shell, even for a "quick fix".

The script now throws immediately if `$IsLinux` and `$IsMacOS` are both false.

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

## AI delegation workflow (Claude orchestrates, Codex/Gemini drafts)

Use `scripts/ai-draft.ps1` to delegate implementation to Codex or Gemini, then Claude QAs.

### When to delegate

| Task size | Action |
|-----------|--------|
| < ~50 lines, single file | Claude handles directly |
| 50–300 lines, well-specified | Delegate with `Tier=medium` |
| Large feature / multi-file | Delegate with `Tier=complex` |
| Security-critical, auth, infra | Delegate with `Tier=security` (but raise scrutiny in QA) |

### Model selection matrix

| Tier | Codex model | Codex effort | Gemini model |
|------|-------------|--------------|--------------|
| simple | o4-mini | low | gemini-2.5-flash |
| medium | o4-mini | high | gemini-2.5-flash |
| complex | o3 | medium | gemini-2.5-pro |
| security | o3 | xhigh | gemini-2.5-pro |

**Agent auto-selection:** Codex for simple/medium (precise file edits, sandbox protection).
Gemini for complex/security (larger context window helps with multi-file analysis).

### Mandatory QA checklist after delegation

After `ai-draft.ps1` finishes, Claude MUST:

1. `git diff HEAD` — read the full diff, verify logic and intent
2. `npx tsc --noEmit` — must be zero errors before proceeding
3. `npx vitest run test/unit/` — no new failures allowed
4. Check specifically for: fabricated constants/hashes, broken YAML in workflows, missing required config flags (e.g. `enableRbacAuthorization`), enum values that don't exist in schema
5. Verify `package.json` and `doc/VERSIONS.md` were bumped

Only after QA passes: commit, push, trigger CI/CD.

### Additional QA for infra changes (Bicep / PowerShell / GitHub Actions)

For any change touching `infra/`, `scripts/azure/`, or `.github/workflows/`, Claude MUST also verify:

**Permission and identity**
- Does this change `enableRbacAuthorization` on Key Vault? It must always be `true`, never coupled to a deploy flag.
- Are role assignment GUIDs seeded on `principalId`, not `App.id` or other mutable values?
- If App Services are deleted and recreated, do the managed identities still have KV access?

**ARM dependency chain**
- If a Bicep resource is made conditional (`= if (condition)`), do all child resources have explicit `dependsOn` on that resource?
- If switching a child resource's `parent:` from a deployed resource to an `existing` reference, is ARM ordering still guaranteed?

**Secret and credential sync**
- If a KV secret (e.g. `DATABASE-URL`) is updated, is the underlying resource (e.g. PostgreSQL) also updated with the same credential — or is the skip path explicitly handled to reuse the existing credential?

**Production safety**
- Does the change behave correctly with `SKIP_ROLE_ASSIGNMENTS=true` (current prod workaround)?
- Does the change behave correctly after `SKIP_ROLE_ASSIGNMENTS` is removed (#404)?
- Do prod-destructive scripts assert the correct subscription before acting?

**ARM validation gap**
- A green ARM deploy does NOT prove runtime correctness. Verify MSI sidecar, KV reference resolution, and `/healthz` on staging before promoting to prod.

---

## ⛔ Infra hard invariants — NEVER violate

These rules exist because their violation caused or worsened the May 2026 production incident.

1. **Never** change `enableRbacAuthorization` based on `skipRoleAssignments` or any deploy flag. Key Vault must always use RBAC authorization.
2. **Never** make production deployability depend on deleting or recreating managed identities.
3. **Never** update a credential secret (e.g. `DATABASE-URL`) unless the underlying resource (e.g. PostgreSQL server) is updated with the same credential in the same deploy — or the existing credential is explicitly read and reused.
4. **Never** make a Bicep resource conditional (`= if (condition)`) without adding `dependsOn: [conditionalResource]` to all child resources that previously used it as `parent:`.
5. **Never** switch a child resource's `parent:` from a deployed resource to an `existing` reference without verifying ARM ordering is preserved via `dependsOn`.
6. **Never** suppress `az role assignment` failures in production.
7. **Never** treat successful ARM validation or a green deploy step as proof of runtime correctness — always verify `/healthz` and smoke test.
8. **Never** run prod-destructive scripts without first asserting the correct subscription (`az account show`) and resource group.
9. **Always** include rollback notes for infra changes in the PR description.
10. **Always** verify staging `/healthz` is healthy before triggering a production deploy.
