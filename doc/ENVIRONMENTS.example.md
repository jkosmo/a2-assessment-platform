# Environment identifiers — template

This repository is **public** (GPL-3). Concrete identifiers for the maintainer's Azure environments
are therefore **not committed**: copy this file to `doc/ENVIRONMENTS.local.md` (gitignored) and fill
in the values for your own subscriptions.

Docs and workflows in this repo refer to the placeholder names below rather than to literal values.

## Why these are kept out, even though they are not secrets

A tenant ID is publicly discoverable for any domain via Entra's OpenID configuration endpoint, and a
subscription ID grants nothing on its own — every Azure operation still requires authentication and
an RBAC assignment. Neither is a credential.

⚠️ The reason to withhold them is **aggregation**. Tenant + subscription + resource-group names +
production hostnames + the name of the human operator account together describe the target
precisely enough to make a phishing message read like it came from inside. That is a real risk in a
way that any single value is not.

The corollary matters as much: **do not treat this file as a security boundary.** If a real
credential ever lands in the repo, rotate it. Scrubbing is not rotation.

## Values

| Placeholder | What it is | Where you find it |
|---|---|---|
| `<STAGING_TENANT_ID>` | Entra tenant for the staging subscription | `az account show --query tenantId` |
| `<STAGING_SUBSCRIPTION_ID>` | Staging subscription | `az account list -o table` |
| `<STAGING_SUBSCRIPTION_NAME>` | Its display name | same |
| `<PROD_TENANT_ID>` | Entra tenant for production | as above, on the prod context |
| `<PROD_SUBSCRIPTION_ID>` | Production subscription | as above |
| `<PROD_SUBSCRIPTION_NAME>` | Its display name | same |
| `<PROD_RESOURCE_GROUP>` | Production resource group | `az group list -o table` |
| `<STAGING_RESOURCE_GROUP>` | Staging resource group | same |
| `<PROD_ADMIN_UPN>` | The human operator account used for production | — |
| `<STAGING_ADMIN_UPN>` | The account used for staging/personal work | — |
| `<ENTRA_SYNC_APP_OBJECT_ID>` | Object ID of the org-sync app registration (#690) | `az ad app show` |
| `<ENTRA_SYNC_SP_OBJECT_ID>` | Its service principal object ID | `az ad sp show` |
| `<ENTRA_SYNC_EXTRA_OBJECT_ID>` | Second object ID used by the sync runbook | same |
| `<DEPLOY_SP_OBJECT_ID>` | Object ID of the GitHub Actions service principal | `az ad sp show` |
| `<PROD_CLIENT_APP_ID>` | SPA app registration (browser sign-in) | Entra → App registrations |
| `<PROD_API_APP_ID>` | API app registration | same |
| `<PROD_API_SP_OBJECT_ID>` | Its enterprise-application object ID — the `resourceId` in app-role assignments | same |
| `<APP_ROLE_ID_ADMINISTRATOR>` | App-role GUID for ADMINISTRATOR, defined on the API app | `az ad app show --id <api> --query appRoles` |
| `<APP_ROLE_ID_SUBJECT_MATTER_OWNER>` | Same, for SUBJECT_MATTER_OWNER | same |
| `<PROD_PG_BACKUP_INSTANCE_ID>` | Backup-instance ID for the production PostgreSQL server | `az dataprotection backup-instance list` |

## What is deliberately still committed

**Hostnames stay.** `a2-assessment-platform-{prd,stg}-app-*.azurewebsites.net` appears in the stage
test suite and in two auth-capture scripts. An `azurewebsites.net` hostname is public DNS — anyone
can enumerate it — so hiding it buys nothing, while removing it would break `npm run test:stage`.
Weigh the trade rather than scrubbing reflexively: the point is to withhold what is not otherwise
discoverable.


**Well-known Azure GUIDs stay in the code**, because they are the same for every tenant on earth and
replacing them with placeholders would make the infrastructure unreadable for anyone reusing this
project:

| GUID | What |
|---|---|
| `4633458b-17de-408a-b874-0445c86b69e6` | Key Vault Secrets User (built-in role) |
| `ba92f5b4-2d11-453d-a403-e96b0029c9fe` | Storage Blob Data Contributor (built-in role) |
| `00000003-0000-0000-c000-000000000000` | Microsoft Graph (well-known application ID) |

`test/environment-identifier-guard.test.js` holds the same allowlist. Adding a new built-in role
means adding it there too — deliberately, so the choice is visible.

## GitHub Actions

Workflows read these from repository **variables**, not from files:

| Variable | Placeholder it replaces |
|---|---|
| `PROD_SUBSCRIPTION_ID` | `<PROD_SUBSCRIPTION_ID>` |

Repository variables and secrets live in repository *settings*, not in the tree, and are not visible
to anyone without write access — including on a public repo. Nothing about this change makes the
deploy depend on committed identifiers.

Set it with:

```bash
gh variable set PROD_SUBSCRIPTION_ID --body "<the id>"
```

⚠️ The staging-only workflows use `PROD_SUBSCRIPTION_ID` in a **safety guard** that aborts if the
runner is authenticated against production. That guard now **fails closed**: if the variable is
missing or empty, the workflow throws rather than continuing. An unset variable used to make the
comparison silently false, which is the "guard that can never fire" pattern this codebase has been
bitten by before (#960).
