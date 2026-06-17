# AGENTS.md — Critical context for Codex and other AI agents

> This file is the Codex equivalent of CLAUDE.md. The two files share the same critical constraints.
> If you are Claude Code, read CLAUDE.md instead — it contains additional orchestration detail.
>
> **Maintained in sync with `CLAUDE.md`.** Any change to the invariants, tenant-split table,
> deploy discipline, or QA checklist sections MUST be applied to both files in the same commit.

---

## ⚠️ CRITICAL: PRODUCTION AND STAGING USE DIFFERENT AZURE TENANTS

**THIS IS THE SINGLE MOST IMPORTANT THING TO KNOW BEFORE TOUCHING ANY AZURE OR INFRA CODE.**

| Environment | Azure Tenant ID | Subscription | Subscription Name |
|-------------|-----------------|--------------|-------------------|
| **staging** | `c6e381fa-eb4b-42ba-b358-fe83e1166c40` | `df46af7a-1806-4bda-a24b-0b3c112bd261` | Betale for forbruk |
| **production** | `a018856e-8cf2-4ec4-bbc8-ab18058027dc` | `5b3f760b-42d4-4d78-812c-c059278d1086` | Pay-As-You-Go (A-2) |

The local Azure CLI defaults to the **staging tenant**. Always switch subscription before querying production:

```powershell
az account set --subscription 5b3f760b-42d4-4d78-812c-c059278d1086  # production
# ... run az commands ...
az account set --subscription df46af7a-1806-4bda-a24b-0b3c112bd261  # back to staging
```

**Prod human account:** `jko@a-2.no` (tenant `a018856e-...`)
**Staging/personal account:** `joakim.kosmo@gmail.com` (tenant `c6e381fa-...`)

---

## ⛔ NEVER RUN THE DEPLOY SCRIPT LOCALLY ON WINDOWS

`scripts/azure/deploy-environment.ps1` must only run on Linux (GitHub Actions).

On Windows, the zip is built with .NET `ZipArchive` which Azure App Service cannot mount — every request returns "Application Error" with no obvious error in deploy logs. The script now throws immediately on Windows.

**To deploy:** `gh workflow run deploy-azure.yml --ref main -f deploy_production=true`

---

## ACS EMAIL PROVISIONING IS SLOW

`Microsoft.Communication/emailServices/domains` takes **20–40 minutes** on first creation. Do not cancel long-running deploys — check ARM operations first.

---

## ⛔ Infra hard invariants — NEVER violate

These rules exist because their violation caused or worsened the May 2026 production incident. Violating any of these can silently break production.

1. **Never** change `enableRbacAuthorization` based on `skipRoleAssignments` or any deploy flag. Key Vault must always use RBAC authorization (`enableRbacAuthorization: true`).
2. **Never** make production deployability depend on deleting or recreating managed identities.
3. **Never** update a credential secret (e.g. `DATABASE-URL`) unless the underlying resource (e.g. PostgreSQL server) is updated with the same credential in the same deploy — or the existing credential is explicitly read and reused.
4. **Never** make a Bicep resource conditional (`= if (condition)`) without adding `dependsOn: [conditionalResource]` to all child resources that previously used it as `parent:`. Switching `parent:` from a deployed resource to an `existing` reference silently removes ARM ordering guarantees.
5. **Never** seed role assignment GUIDs on `App.id` or other mutable values — seed on `principalId` so GUIDs are stable across App Service recreations.
6. **Never** suppress `az role assignment` failures in production.
7. **Never** treat successful ARM validation or a green deploy step as proof of runtime correctness — the MSI sidecar and KV reference resolution can still fail at runtime.
8. **Never** run prod-destructive scripts without asserting the correct subscription and resource group first.
9. **Always** include rollback notes for infra changes in the PR description.
10. **Always** confirm staging `/healthz` is healthy before a production deploy.
11. **Always** propose `az deployment group what-if` output for staging (and prod) before implementing non-trivial Bicep changes. ARM what-if is the only check that catches schema drift before deploy.
12. **Always** apply credential changes atomically: a KV secret and the underlying resource (PostgreSQL server, Storage account, etc.) must be updated in the same deploy, or one must explicitly re-read the existing value. Drift between KV and the underlying resource is silent until the next app restart.

---

## Codex behavior rules

- **Always create a PR against `main`** — never push directly to `main`.
- **Always bump `package.json` version and `doc/VERSIONS.md`** in the same commit as code changes.
- **Documentation is a MANDATORY step (standing order):** a feature is not "done" until its
  docs are updated. Any change to user-facing behavior or API/route surface MUST update **both**
  technical docs (`doc/API_REFERENCE.md`, `doc/route-map.md`, arch notes) **and** user/author
  docs under `doc/`. If they can't land in the same PR, open tracking doc issues (technical +
  user) in the same milestone before the feature is complete.
- **For infra changes**, include in the PR description:
  - Which environments are affected
  - Behavior on first deploy (fresh environment) vs normal deploy
  - Behavior if App Services or Key Vault are recreated
  - Rollback procedure
  - What is no longer IaC-synchronized (if any skip flags are introduced)
- **Never introduce new skip flags** (e.g. `skipRoleAssignments`, `skipPostgresUpdate`) without documenting the drift risk and linking the cleanup issue.
- **Treat ARM validation success as necessary but not sufficient** — always reason about runtime behavior separately.
- **When in doubt about a prod-side constraint**, leave a TODO comment and note it in the PR — do not guess.

---

## Project overview

A2 Assessment Platform — Next.js + Prisma + PostgreSQL on Azure App Service.

- Infrastructure: `infra/azure/main.bicep`
- Deploy script: `scripts/azure/deploy-environment.ps1`
- CI/CD: `.github/workflows/deploy-azure.yml`
- Environments runbook: `doc/AZURE_ENVIRONMENTS.md`

### Pre-merge Bicep what-if (production)

Before merging a PR that touches `infra/azure/*.bicep` or `scripts/azure/deploy-environment.ps1`, run a production what-if to see the ARM diff:

```bash
gh workflow run bicep-whatif-prod.yml -f pr_number=<PR_NUMBER>
```

The diff is posted as a PR comment. Staging what-if runs automatically on PR; prod what-if is manual because the production GitHub environment has approval gates that would block PR-time auto-runs (#419).
