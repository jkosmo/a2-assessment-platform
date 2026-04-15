# Production Restore Runbook

This document is the production database recovery and restore runbook for the A2 Assessment Platform.

It answers four practical questions:
- when do we use a normal app/config rollback instead of database restore?
- when do we use native PostgreSQL point-in-time restore (PITR)?
- when should vaulted backup or logical export become the preferred path?
- how do we verify that participant-facing assessment history was actually restored?

Related documents:
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
- [AZURE_ENVIRONMENTS.md](AZURE_ENVIRONMENTS.md)
- [OBSERVABILITY_RUNBOOK.md](OBSERVABILITY_RUNBOOK.md)
- [design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md](design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md)
- [INCIDENTS.md](INCIDENTS.md)

## Current Production Baseline

Current production PostgreSQL runtime:
- resource group: `rg-a2-assessment-production`
- server: `a2-assessment-platform-prd-pg-hea5kl`
- FQDN: `a2-assessment-platform-prd-pg-hea5kl.postgres.database.azure.com`
- location: `Norway East`
- version: `16`
- backup retention: `35` days
- geo-redundant backup: `Disabled`
- high availability: `Disabled`

Current recovery-path availability:
- app/config rollback by redeploy: available now
- native PostgreSQL PITR restore: available now
- Azure Backup vaulted backup restore: not yet configured, tracked in `#220`
- logical export safety copy: not yet configured, tracked in `#223`

Important consequence:
- today, the only production database restore path that is actually available is native PostgreSQL PITR
- do not assume vaulted backup or logical-export recovery exists until those issues are completed

## Ownership and Approval Model

Use these operational roles during recovery:

- Incident commander
  - decides whether the event is a deploy rollback, database recovery, or broader incident
  - owns the incident record in [INCIDENTS.md](INCIDENTS.md)

- Restore operator
  - executes the Azure restore actions
  - captures timestamps, commands, and resulting server names

- Data/business approver
  - confirms the selected restore point is acceptable from a business perspective
  - signs off that restored participant history is acceptable for cutover

- Verification operator
  - verifies restored app/data behavior independently from the person who ran the restore

For a small team, one person may hold multiple roles, but approval and verification must still be recorded explicitly in incident notes.

## Recovery Decision Tree

Choose the simplest safe path. Do not improvise a more destructive one.

### Path 0: No database restore
Use a normal production redeploy instead of database restore when:
- the failure is isolated to application code or runtime configuration
- there is no evidence of destructive schema or data change
- participant data is believed intact

Use:
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
- [AZURE_ENVIRONMENTS.md](AZURE_ENVIRONMENTS.md)

### Path 1: Native PITR restore
Use PITR when:
- the incident is recent
- the source PostgreSQL server still exists
- the bad write/corruption window can be bounded to a recent UTC time
- native backup retention still covers the good point-in-time

Typical examples:
- destructive admin action
- application bug that wrote bad results
- bad migration or bad deploy followed by data writes
- accidental row updates/deletes discovered quickly

### Path 2: Vaulted backup restore
Use vaulted backup restore when all of the following become true:
- `#220` has been completed
- restore points actually exist in Azure Backup
- the incident was discovered too late for native PITR to be the safest option
- or the source runtime resource should not be trusted

Current status:
- not available yet in this environment

### Path 3: Logical export / manual reconstruction
Use logical export only when all of the following become true:
- `#223` has been completed
- a relevant pre-change export exists
- PITR or vaulted backup is unavailable or insufficient for the case

Current status:
- not available yet in this environment

### Stop and escalate
Stop and escalate before touching production if any of these are true:
- the incident window is unclear and you do not know what restore timestamp is safe
- there may be legal/reporting implications from losing newer records
- the team cannot yet prove which participant results are affected
- the chosen recovery path is not actually configured in production

## Shared Restore Rules

Apply these rules to every database recovery event:

1. Freeze non-essential production changes.
2. Stop approving unrelated production deploys until recovery direction is chosen.
3. Capture the incident start time and the last known good time in UTC.
4. Record the suspected bad-write window in [INCIDENTS.md](INCIDENTS.md).
5. Never overwrite the source PostgreSQL server in place.
6. Restore to a new server first.
7. Do not repoint production apps to the restored server before verification is complete.

## Native PITR Restore Runbook

This is the primary restore path that is available today.

### When to use it

Use PITR when the incident is recent and bounded in time.

Prefer PITR over app rollback when:
- participant results may already have been written incorrectly
- appeal or manual-review state may already be corrupt
- a deploy rollback would not undo database changes

### Inputs you must capture first

Record these before you restore:
- incident reference
- source server resource ID
- source server name
- target restore timestamp in UTC
- reason for chosen timestamp
- proposed restored server name

Current source server resource ID:

```text
/subscriptions/5b3f760b-42d4-4d78-812c-c059278d1086/resourceGroups/rg-a2-assessment-production/providers/Microsoft.DBforPostgreSQL/flexibleServers/a2-assessment-platform-prd-pg-hea5kl
```

Query current backup window before choosing the restore time:

```powershell
az postgres flexible-server show `
  -g rg-a2-assessment-production `
  -n a2-assessment-platform-prd-pg-hea5kl `
  --query "{server:name, earliestRestoreDate:backup.earliestRestoreDate, retentionDays:backup.backupRetentionDays, geoRedundantBackup:backup.geoRedundantBackup}" `
  -o yaml
```

### Portal path

Azure Portal path:
1. Open `PostgreSQL flexible servers`
2. Open `a2-assessment-platform-prd-pg-hea5kl`
3. Choose `Restore`
4. Select the target point in time
5. Restore to a new server name in the same subscription/resource group unless there is a specific reason not to

### CLI path

Create a restored server at a specific UTC point in time:

```powershell
az postgres flexible-server restore `
  -g rg-a2-assessment-production `
  -n a2-assessment-platform-prd-pg-restore-<yyyymmddhhmm> `
  --source-server /subscriptions/5b3f760b-42d4-4d78-812c-c059278d1086/resourceGroups/rg-a2-assessment-production/providers/Microsoft.DBforPostgreSQL/flexibleServers/a2-assessment-platform-prd-pg-hea5kl `
  --restore-time "<UTC-ISO8601>" `
  --yes
```

Example:

```powershell
az postgres flexible-server restore `
  -g rg-a2-assessment-production `
  -n a2-assessment-platform-prd-pg-restore-202604151030 `
  --source-server /subscriptions/5b3f760b-42d4-4d78-812c-c059278d1086/resourceGroups/rg-a2-assessment-production/providers/Microsoft.DBforPostgreSQL/flexibleServers/a2-assessment-platform-prd-pg-hea5kl `
  --restore-time "2026-04-15T10:30:00Z" `
  --yes
```

Track restore status:

```powershell
az postgres flexible-server show `
  -g rg-a2-assessment-production `
  -n a2-assessment-platform-prd-pg-restore-<yyyymmddhhmm> `
  --query "{name:name,state:state,fqdn:fullyQualifiedDomainName}" `
  -o yaml
```

### Post-restore infrastructure checks

Before any app cutover decision:
1. Confirm the restored server reaches `state: Ready`.
2. Confirm the restored server is in the intended resource group and region.
3. Confirm connectivity works with the PostgreSQL admin user.
4. Confirm the expected database exists.

Example metadata check:

```powershell
az postgres flexible-server db list `
  -g rg-a2-assessment-production `
  -s a2-assessment-platform-prd-pg-restore-<yyyymmddhhmm> `
  -o table
```

### Data sanity checks

Run data checks against the restored database before considering any cutover.

Minimum domain objects to verify:
- `User`
- `Submission`
- `MCQAttempt`
- `LLMEvaluation`
- `AssessmentDecision`
- `Appeal`
- `ManualReview`
- `CertificationStatus`
- `AuditEvent`
- `AssessmentJob`

Suggested SQL:

```sql
SELECT COUNT(*) AS users FROM "User";
SELECT COUNT(*) AS submissions FROM "Submission";
SELECT COUNT(*) AS decisions FROM "AssessmentDecision";
SELECT COUNT(*) AS appeals FROM "Appeal";
SELECT COUNT(*) AS manual_reviews FROM "ManualReview";
SELECT COUNT(*) AS certification_statuses FROM "CertificationStatus";
SELECT COUNT(*) AS audit_events FROM "AuditEvent";
```

For one known affected participant, verify history end-to-end:

```sql
SELECT u."externalId", u.email, s.id AS submission_id, s."submittedAt", s."submissionStatus"
FROM "User" u
JOIN "Submission" s ON s."userId" = u.id
WHERE u."externalId" = '<participant-external-id>'
ORDER BY s."submittedAt" DESC;
```

```sql
SELECT d.id, d."decisionType", d."totalScore", d."passFailTotal", d."finalisedAt", d."parentDecisionId"
FROM "AssessmentDecision" d
WHERE d."submissionId" = '<submission-id>'
ORDER BY d."finalisedAt" ASC;
```

```sql
SELECT a.id, a."appealStatus", a."createdAt", a."claimedAt", a."resolvedAt", a."resolutionNote"
FROM "Appeal" a
WHERE a."submissionId" = '<submission-id>'
ORDER BY a."createdAt" ASC;
```

```sql
SELECT mr.id, mr."reviewStatus", mr."reviewedAt", mr."overrideDecision", mr."overrideReason"
FROM "ManualReview" mr
WHERE mr."submissionId" = '<submission-id>'
ORDER BY mr."createdAt" ASC;
```

```sql
SELECT cs.id, cs.status, cs."passedAt", cs."expiryDate", cs."recertificationDueDate"
FROM "CertificationStatus" cs
JOIN "Submission" s ON s."userId" = cs."userId" AND s."moduleId" = cs."moduleId"
WHERE s.id = '<submission-id>';
```

What must be true before cutover:
- known participant submissions are present
- decision lineage is intact
- appeal state is present and coherent
- manual-review state is present and coherent
- certification status is consistent with the restored decisions

### App-level verification before cutover

Do not point the live production apps at the restored database first.

Preferred validation:
1. use an isolated app instance or isolated environment against the restored database
2. verify `/healthz`
3. verify one participant path
4. verify one admin/reporting path

If no isolated app validation path is available, record that gap explicitly and limit cutover decisions to cases where SQL/data verification is strong enough to justify it.

### Cutover decision

Only after infrastructure and data verification:
- decide whether production apps should stay on the current database
- or be repointed to the restored database as a controlled incident action

Any cutover decision must record:
- why the chosen restore timestamp is acceptable
- what data is knowingly lost after that restore point
- who approved the cutover

## Vaulted Backup Restore Runbook

This path is planned but not yet available in production.

Status gate:
- do not select this path until `#220` is complete and restore points are visible in Azure Backup

When available, this path should be preferred over PITR when:
- corruption is discovered too late for PITR confidence
- the source runtime resource should not be trusted
- a longer-retained recovery point is required

Expected operator steps once `#220` is complete:
1. locate the protected PostgreSQL instance in Azure Backup
2. choose the restore point
3. restore to isolated target storage/files as supported by Azure Backup
4. reconstruct a PostgreSQL server from the restored output using native PostgreSQL tooling
5. run the same post-restore verification checklist as PITR

Until `#220` is complete, treat this as unavailable.

## Logical Export Recovery Runbook

This path is planned but not yet available in production.

Status gate:
- do not select this path until `#223` is complete and a relevant export exists

Use when:
- a pre-change export exists
- targeted/manual reconstruction is safer than a broader restore
- PITR or vaulted backup is unavailable or would roll back too much unrelated data

Expected operator steps once `#223` is complete:
1. locate the approved pre-change export
2. validate checksum/retention/access context
3. restore into isolated PostgreSQL target
4. verify the same domain objects and participant history as PITR
5. use the restored copy for targeted reconstruction or cutover as explicitly approved

Until `#223` is complete, treat this as unavailable.

## Evidence to Capture

For every restore event, record at minimum:
- incident ID or incident date
- chosen recovery path
- source server
- target restore timestamp
- restored server name
- commands run or portal actions taken
- verification queries and outcomes
- whether production cutover occurred
- what data after the restore point was intentionally abandoned

Add the final record to [INCIDENTS.md](INCIDENTS.md).

## Current Recommendation

For the current production phase:
- use normal redeploy for app/config-only regressions
- use native PITR for actual database recovery
- finish `#220` before claiming an independent long-term restore path exists
- finish `#223` before claiming pre-change logical safety copies exist
- execute `#222` to convert this runbook from planned procedure to rehearsed evidence
