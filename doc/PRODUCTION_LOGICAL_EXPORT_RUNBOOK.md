# Production Logical Export Runbook

This document describes the human-controlled pre-change logical export process for risky production operations.

It is not a replacement for:
- native PostgreSQL PITR
- Azure Backup vaulted backup

It exists as a targeted safety copy before changes where we want an exact, operator-approved snapshot of the data just before the change.

Related documents:
- [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)
- [PRODUCTION_RESTORE_RUNBOOK.md](PRODUCTION_RESTORE_RUNBOOK.md)
- [design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md](design/PRODUCTION_POSTGRES_BACKUP_AND_RECOVERY.md)

## Purpose

Use a pre-change logical export when we want:
- a known-good application-level snapshot immediately before a risky production change
- a fallback for selective/manual reconstruction
- an auditable artifact tied to a specific change or incident

This export is a fallback, not the primary production backup mechanism.

## Trigger Conditions

A pre-change logical export is required before these production operations:
- schema-changing deploys where backward compatibility is unclear
- large backfills or repair scripts touching many rows
- destructive admin clean-up or data correction
- manual SQL operations in production
- one-off migration or import steps that could alter assessment history, decisions, appeals, or certification state

A pre-change logical export is usually not required for:
- ordinary app/config-only deploys
- read-only investigations
- routine restarts or redeploys with no schema/data change

When in doubt, take the export.

## Export Format

Current standard:
- tool: `pg_dump`
- format: custom dump (`--format=custom`)
- compression: enabled (`--compress=9`)

Why:
- custom format is restorable with `pg_restore`
- better suited than plain SQL for controlled replay into isolated validation targets
- compact enough for operator-driven storage and later inspection

Required companion artifacts:
- dump file: `*.dump`
- checksum file: `*.sha256`
- manifest file: `*.manifest.json`

## Storage Location

Current production storage location:
- storage account: `a2prdrestorehea5kl`
- container: `logical-exports`

Blob naming convention:
- `<environment>/<change-reference>/<timestamp>/<file>`

## Retention and Access

Minimum retention:
- keep each pre-change export until the related change is verified and the immediate rollback/recovery risk has clearly passed
- for production, default operational retention should be at least `30` days unless a shorter period is explicitly approved in incident/change notes

Access expectations:
- restrict blob access to operators with production recovery responsibility
- do not email or casually copy exports
- use Azure RBAC / login-based upload where possible
- record which change or incident the export belongs to

## Required Evidence

For every export, capture:
- change or incident reference
- why the export was required
- source server and database
- operator who created it
- UTC timestamp
- SHA-256 checksum
- blob prefix / storage location

Record this in the change record or [INCIDENTS.md](INCIDENTS.md) when the export is incident-driven.

## Standard Procedure

### Inputs to confirm first

Before running the export, capture:
- change label
- change/incident reference
- source server name
- database name
- operator identity

Current production defaults:
- server: `a2-assessment-platform-prd-pg-hea5kl`
- database: `a2assessment`
- storage account: `a2prdrestorehea5kl`
- container: `logical-exports`

### Scripted path

Use:
- [scripts/azure/create-logical-export.ps1](/C:/Users/JoakimKosmo/a2-assessment-platform/scripts/azure/create-logical-export.ps1)

Example:

```powershell
.\scripts\azure\create-logical-export.ps1 `
  -EnvironmentName production `
  -ResourceGroup rg-a2-assessment-production `
  -ServerName a2-assessment-platform-prd-pg-hea5kl `
  -DatabaseName a2assessment `
  -AdminUsername a2platformadmin `
  -ChangeLabel "schema-fix" `
  -IncidentOrChangeReference "chg-2026-04-15-schema-fix"
```

What the script does:
1. runs `pg_dump` in custom format
2. creates a SHA-256 checksum
3. writes a small manifest JSON
4. uploads all artifacts to Azure Blob Storage using `az storage blob upload --auth-mode login`

### Validation after export

Before proceeding with the risky change:
1. confirm the dump file exists locally
2. confirm the checksum file exists
3. confirm the manifest exists
4. confirm the upload succeeded to the expected blob prefix
5. if practical, run `pg_restore --list <dumpfile>` locally to confirm the artifact is readable

## Restore Use of a Logical Export

Logical export should be used when:
- a pre-change export exists
- PITR or vaulted backup would roll back too much unrelated data
- we need a narrow, operator-controlled reconstruction path

Preferred recovery pattern:
1. restore the export into an isolated PostgreSQL validation target
2. verify key participant history and reporting paths
3. decide whether to use the restored copy for selective/manual reconstruction or cutover

This follows the same validation philosophy as the isolated restore drill in [design/PRODUCTION_RESTORE_DRILL_2026-04-15.md](design/PRODUCTION_RESTORE_DRILL_2026-04-15.md).

## Practical Boundary

Use this mechanism for:
- risky planned changes
- targeted fallback
- human-auditable recovery support

Do not treat it as:
- a replacement for native backup
- a replacement for vaulted backup
- a reason to skip proper restore drills
