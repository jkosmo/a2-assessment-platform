# Production Restore Drill 2026-04-15

## Scope
This note captures the first isolated production restore drill executed against the production Azure Backup vaulted-backup path.

The purpose of this drill was to move the production recovery posture from:
- configured in theory

to:
- exercised with real production backup data
- timed with real Azure jobs
- evidenced with actual restore artifacts
- rehydrated into an isolated PostgreSQL validation target
- validated through a running application instance against restored data

This drill intentionally avoided any cutover or mutation of the live production application/database.

## Drill Goal
Prove that we can:
- locate a real vaulted recovery point for production PostgreSQL
- trigger a restore from that recovery point
- restore into an isolated Azure target
- capture actual restore timing and generated artifacts
- replay the restored application database into an isolated PostgreSQL server
- boot the application against the restored database and verify real read paths

This drill did **not** aim to:
- repoint the live production app
- overwrite the production database
- perform any production cutover

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

## Isolated Restore Targets
File-restore target:
- storage account: `a2prdrestorehea5kl`
- container: `pgrestore-drill-20260415`
- container URL: `https://a2prdrestorehea5kl.blob.core.windows.net/pgrestore-drill-20260415`

Storage target properties:
- SKU: `Standard_LRS`
- cross-tenant replication: `true`
- HTTPS only: `true`
- public blob access: `false`

Phase-2 validation target:
- PostgreSQL server: `a2-assessment-drill-pg-hea5kl`
- FQDN: `a2-assessment-drill-pg-hea5kl.postgres.database.azure.com`
- resource group: `rg-a2-assessment-production`
- version: `16`
- SKU: `Standard_B1ms`
- app validation port: `4312`

## Restore Method
Chosen method:
- Azure Backup restore as files

Reason:
- safest first drill
- proves the vaulted-backup restore path without touching the running production database
- gives us concrete artifacts that can be replayed into an isolated PostgreSQL validation target

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

Replay into isolated PostgreSQL validation target:

```powershell
pg_restore `
  --host=a2-assessment-drill-pg-hea5kl.postgres.database.azure.com `
  --port=5432 `
  --username=restoreadmin `
  --dbname=postgres `
  --clean --if-exists --create `
  --no-owner --no-privileges `
  --verbose --exit-on-error `
  d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_a2assessment.sql
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

This proved that Azure Backup restore produced isolated SQL artifacts for the production application database.

## Phase 2 Rehydration and App Validation

The restored file set was downloaded locally and inspected before replay:
- `d98a8d0a-89c8-4b84-9c58-c6c8743e8478_database_a2assessment.sql` was confirmed to be a PostgreSQL custom dump
- PostgreSQL client tooling (`psql`, `pg_restore`) was installed locally to replay the dump

Replay result:
- restore completed successfully
- database `a2assessment` was recreated on the isolated validation server
- schema, enum types, tables, indexes, and foreign keys were restored
- production rows for `User`, `Submission`, `AssessmentDecision`, `Appeal`, and `CertificationStatus` were present after replay

Observed restored counts:
- users: `1`
- submissions: `1`
- decisions: `2`
- appeals: `1`
- manual reviews: `0`
- certifications: `1`

Known participant history used for validation:
- participant external ID: `16a6dfa1-351f-40e6-adc5-b8519b9e4eb6`
- participant email: `jko@a-2.no`
- module ID: `cmnyu47pa0000oafg7p89vusz`
- module title (nb): `Hormuzstredet: geografi og strategisk betydning`
- submission ID: `cmnyu6gmt000hoafgxqbxl4ox`

Decision and appeal lineage observed after replay:
- automatic fail decision present with score `44.29`
- appeal-resolution decision present with parent decision reference intact
- resolved appeal present with timestamps and resolution note
- certification status remained `NOT_CERTIFIED`

Isolated app boot:
- application built successfully with `npm run build`
- application started against the restored database with:
  - `AUTH_MODE=mock`
  - `PROCESS_ROLE=web`
  - `LLM_MODE=stub`
  - `PARTICIPANT_NOTIFICATION_CHANNEL=log`
- `/healthz` returned `200`

Participant-path verification:
- `GET /api/me` returned the restored participant identity and existing consent state
- `GET /api/modules/completed` returned the restored module history
- latest completed submission and latest decision matched the restored appeal-resolution state

Admin/reporting-path verification:
- `GET /api/me` with `ADMINISTRATOR,REPORT_READER` mock roles returned the expected elevated roles
- `GET /api/reports/completion` returned report totals based on the restored dataset:
  - total submissions: `1`
  - completed submissions: `1`
  - completion rate: `1`

## What This Drill Proved
- production vaulted backup is not only configured, but usable
- a real recovery point could be selected and restored
- Azure Backup restore permissions, vault identity, and target storage configuration were sufficient
- the restore path completed successfully without touching the live production database
- the production application database payload was emitted as SQL artifacts into an isolated container
- the SQL artifacts can be replayed into an isolated PostgreSQL validation server
- the application can boot successfully against the restored database
- a real participant-history path and a real admin/reporting path both work against the restored data
- decision lineage and appeal state remained intact after rehydration

## What This Drill Did Not Prove
- production cutover to a restored database
- performance behavior of a larger restored dataset under load
- recovery behavior when the incident requires replay of data newer than the selected restore point

## Gaps and Follow-up
Recommended next step:
- keep this drill evidence as the baseline for future cadence-based restore rehearsals
- reuse the same isolated-server pattern when `#223` adds pre-change logical export recovery

## Assessment
This drill materially improves confidence in the production recovery posture:
- vaulted backup path is proven from recovery point to isolated SQL artifacts
- replay into isolated PostgreSQL is proven
- application boot and key read paths are proven against restored production data

This drill now counts as an end-to-end isolated restore rehearsal for the current production backup design.
