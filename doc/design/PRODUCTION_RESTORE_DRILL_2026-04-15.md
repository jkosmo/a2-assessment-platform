# Production Restore Drill 2026-04-15

## Scope
This note captures the first isolated production restore drill executed against the production Azure Backup vaulted-backup path.

The purpose of this drill was to move the production recovery posture from:
- configured in theory

to:
- exercised with real production backup data
- timed with real Azure jobs
- evidenced with actual restore artifacts

This drill intentionally avoided any cutover or mutation of the live production application/database.

## Drill Goal
Prove that we can:
- locate a real vaulted recovery point for production PostgreSQL
- trigger a restore from that recovery point
- restore into an isolated Azure target
- capture actual restore timing and generated artifacts

This drill did **not** yet aim to:
- repoint the live production app
- overwrite the production database
- claim that restored data has already been rehydrated into a booted validation app

## Production Source
- source server: `a2-assessment-platform-prd-pg-hea5kl`
- resource group: `rg-a2-assessment-production`
- vault: `a2-assessment-platform-prd-bkv-hea5kl`
- backup policy: `a2-assessment-platform-prd-pg-weekly-3m-v1`

## Recovery Point Used
- recovery point id: `010dbdefc0114da398150b112d3f601b`
- recovery point time: `2026-04-15T10:24:47.6778643Z`
- datastore: `VaultStore`
- state: `Completed`

## Isolated Restore Target
- storage account: `a2prdrestorehea5kl`
- container: `pgrestore-drill-20260415`
- container URL: `https://a2prdrestorehea5kl.blob.core.windows.net/pgrestore-drill-20260415`

Storage target properties:
- SKU: `Standard_LRS`
- cross-tenant replication: `true`
- HTTPS only: `true`
- public blob access: `false`

## Restore Method
Chosen method:
- Azure Backup restore as files

Reason:
- safest first drill
- proves the vaulted-backup restore path without touching the running production database
- gives us concrete artifacts that can later be replayed into an isolated PostgreSQL validation target

## Commands Used

Protected datasource and policy:

```powershell
az dataprotection backup-instance show `
  -g rg-a2-assessment-production `
  --vault-name a2-assessment-platform-prd-bkv-hea5kl `
  -n a2-assessment-platform-prd-pg-hea5kl-a2-assessment-platform-prd-pg-hea5kl-50c463e8-38b3-11f1-b542-80b6551ef4aa `
  -o yaml
```

Recovery point lookup:

```powershell
az dataprotection recovery-point list `
  -g rg-a2-assessment-production `
  --vault-name a2-assessment-platform-prd-bkv-hea5kl `
  --backup-instance-name a2-assessment-platform-prd-pg-hea5kl-a2-assessment-platform-prd-pg-hea5kl-50c463e8-38b3-11f1-b542-80b6551ef4aa `
  -o table
```

Restore request initialization:

```powershell
az dataprotection backup-instance restore initialize-for-data-recovery-as-files `
  --datasource-type AzureDatabaseForPostgreSQLFlexibleServer `
  --restore-location norwayeast `
  --source-datastore VaultStore `
  --target-blob-container-url https://a2prdrestorehea5kl.blob.core.windows.net/pgrestore-drill-20260415 `
  --target-file-name prod-pg-vaulted-restore-20260415 `
  --recovery-point-id 010dbdefc0114da398150b112d3f601b
```

Restore permission propagation:

```powershell
az dataprotection backup-instance update-msi-permissions `
  --resource-group rg-a2-assessment-production `
  --vault-name a2-assessment-platform-prd-bkv-hea5kl `
  --datasource-type AzureDatabaseForPostgreSQLFlexibleServer `
  --operation Restore `
  --permissions-scope Resource `
  --restore-request-object @<restore-request-json> `
  --target-storage-account-id /subscriptions/5b3f760b-42d4-4d78-812c-c059278d1086/resourceGroups/rg-a2-assessment-production/providers/Microsoft.Storage/storageAccounts/a2prdrestorehea5kl `
  --yes
```

Restore trigger:

```powershell
az dataprotection backup-instance restore trigger `
  -g rg-a2-assessment-production `
  --vault-name a2-assessment-platform-prd-bkv-hea5kl `
  --backup-instance-name a2-assessment-platform-prd-pg-hea5kl-a2-assessment-platform-prd-pg-hea5kl-50c463e8-38b3-11f1-b542-80b6551ef4aa `
  --restore-request-object @<restore-request-json> `
  --no-wait
```

## Measured Result

Restore job:
- job id: `b54a24a7-0c7d-41b9-9e65-8650e721bc22`
- operation: `Restore`
- status: `Completed`
- start time: `2026-04-15T10:57:37.3897923Z`
- end time: `2026-04-15T10:59:41.529132Z`
- measured duration: `00:02:04.1393397`

Azure-reported restore destination:
- `https://a2prdrestorehea5kl.blob.core.windows.net/pgrestore-drill-20260415`

Data transferred:
- `201469` bytes reported in job details

## Restored Artifacts Observed

Observed blobs in the isolated restore container:
- `backupstarttimestamp`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_a2assessment.sql`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_azure_maintenance.sql`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_azure_sys.sql`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_postgres.sql`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_template1.sql`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_roles.sql`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_schema.sql`
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_tablespaces.sql`

The application database export was present:
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_a2assessment.sql`

This proves that Azure Backup restore produced isolated SQL artifacts for the production application database.

## What This Drill Proved
- production vaulted backup is not only configured, but usable
- a real recovery point could be selected and restored
- Azure Backup restore permissions, vault identity, and target storage configuration were sufficient
- the restore path completed successfully without touching the live production database
- the production application database payload was emitted as SQL artifacts into an isolated container

## What This Drill Did Not Yet Prove
- replay of the restored SQL into an isolated PostgreSQL validation server
- app boot against the restored database
- `/healthz` against a restored runtime
- participant-path and admin/reporting-path verification against restored data
- direct proof that one known participant's submissions, results, completion state, and decision lineage are intact after rehydration

## Gaps and Follow-up
Remaining gap before `#222` can be treated as fully complete:
- rehydrate the restored SQL into an isolated PostgreSQL target
- boot the app against that isolated target
- verify one participant path and one admin/reporting path
- verify one known participant's restored assessment history end-to-end

Recommended next step:
- run a second-phase drill that replays `database_a2assessment.sql` into an isolated PostgreSQL target and validates application boot/read paths against it

## Interim Assessment
This drill materially improves confidence in the production recovery posture:
- vaulted backup path is now proven to the point of recoverable artifacts
- measured restore timing is now based on evidence rather than assumption

But the drill is still only a partial end-to-end recovery rehearsal until restored data has been rehydrated into a running validation environment.
