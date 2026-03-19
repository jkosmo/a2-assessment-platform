# Production PostgreSQL Backup and Recovery

## Scope
This note defines the target backup and recovery architecture for the production Azure Database for PostgreSQL Flexible Server deployment.

It is intentionally narrower than the full production rollout plan. The purpose is to answer one question clearly:

- how do we recover if the production database becomes corrupted, deleted, or unavailable?

## Problem Statement
The current repo baseline is sufficient for staging, but it is not yet a production-grade recovery posture.

Current Azure baseline in `infra/azure/main.bicep`:
- PostgreSQL Flexible Server on a small Burstable SKU
- backup retention set to 7 days
- geo-redundant backup disabled
- high availability disabled

This is acceptable for low-cost staging validation, but not for production where:
- data loss has direct operational impact
- logical corruption might not be detected immediately
- restore must be rehearsed, not improvised
- regional incidents and operator mistakes must be considered

## Goals
- recover from accidental deletes, bad deployments, and logical data corruption
- recover from infrastructure-level failure with a documented runbook
- keep recovery options available beyond the short operational window
- ensure restore is possible even if the source server or subscription state is compromised
- make recovery testable through repeatable drills

## Non-Goals
- zero-downtime failover for every incident class
- cross-cloud disaster recovery
- table-level CDC or a full event-sourced persistence redesign

## Recovery Scenarios
The target strategy must cover these scenarios:

1. Operator error
- accidental row updates/deletes
- bad migration or application bug
- mistaken manual admin action

2. Logical corruption
- incorrect writes propagated through normal application paths
- corrupted domain data discovered hours or days later

3. Resource loss
- dropped PostgreSQL server
- broken production deployment that requires database rollback support

4. Infrastructure outage
- zone-level or host-level failure
- regional incident requiring restore to another region

## Option Evaluation

### Option A: Native PostgreSQL Flexible Server backup only
Use the built-in Azure PostgreSQL backup retention and point-in-time restore only.

Pros:
- built in and simple
- good for short-window operational recovery
- lowest implementation effort

Cons:
- short retention window compared to compliance/forensics needs
- restore creates a new server and still requires runbook execution
- does not create an independent long-term backup copy

Assessment:
- required as a baseline
- not sufficient alone for production

### Option B: Native backup plus geo-redundant backup
Keep built-in PITR and add geo-redundant backup at server creation.

Pros:
- improves disaster recovery for regional incidents
- stays close to Azure managed operational model

Cons:
- still not an independent long-term backup strategy
- must be decided at provisioning time
- higher cost than local redundancy only

Assessment:
- strongly recommended for production
- still not sufficient alone

### Option C: Native backup plus Azure Backup vaulted backup
Use native operational backups plus Azure Backup for longer retention and isolated backup storage.

Pros:
- separate security and fault domain
- longer retention window
- stronger posture against source-resource compromise
- complements PITR rather than replacing it

Cons:
- more setup and permissions
- more operational complexity than native backup only
- restore flow is slower and more procedural than PITR

Assessment:
- strong production candidate
- should be part of the target architecture

### Option D: Native backup plus scheduled logical exports
Take scheduled `pg_dump` exports to a protected storage account, optionally with immutability and separate retention.

Pros:
- independent copy under our control
- useful for selective inspection and recovery
- useful before risky schema/data changes

Cons:
- we own more of the backup/restore workflow
- slower restore path
- easiest option to neglect if not automated and tested

Assessment:
- valuable as a supplemental control
- should not replace native backup or vaulted backup

### Option E: HA or read replica as the recovery strategy
Rely on high availability or read replicas as the main protection.

Pros:
- improves availability
- helpful for infrastructure incidents and read scaling

Cons:
- not true backup
- logical corruption replicates forward
- does not solve long-term restore needs

Assessment:
- useful for uptime
- not acceptable as the only recovery control

## Chosen Target Architecture
The production target should combine multiple layers because no single Azure feature covers all failure modes.

### Layer 1: Production runtime resilience
- Azure Database for PostgreSQL Flexible Server on General Purpose SKU
- high availability enabled
- storage autoscale enabled

Purpose:
- reduce downtime from host/zone failures
- avoid treating backup as the first response to ordinary infrastructure issues

### Layer 2: Native operational recovery
- native PostgreSQL backup retention set to 35 days
- point-in-time restore enabled by default through the service
- geo-redundant backup enabled for production

Purpose:
- recover quickly from recent bad writes, bad deploys, and accidental deletes
- support paired-region restore for major regional incidents

### Layer 3: Independent long-term backup
- Azure Backup vaulted backup enabled for the production database
- retention policy defined separately from native PITR
- backup vault configured with stricter deletion/immutability posture where supported

Purpose:
- keep recoverable copies outside the immediate runtime resource lifecycle
- preserve recovery options for late-discovered corruption or destructive mistakes

### Layer 4: Pre-change logical safety copy
- run a logical export before high-risk production changes:
  - schema-changing deploys
  - large backfills
  - destructive admin repair operations
- store export in protected Azure Storage with explicit retention

Purpose:
- provide a human-auditable fallback for difficult recovery cases
- reduce fear around one-off risky changes

## Target Operational Posture

### RPO/RTO guidance
The exact numbers should be accepted explicitly during production onboarding, but the intended operating posture is:

- recent operational recovery: use native PITR first
- severe logical corruption or late discovery: use vaulted backup or logical export
- infrastructure failure without data corruption: prefer HA/failover over restore

Suggested starting expectations:
- RPO: measured in minutes for PITR-backed incidents
- RTO: tens of minutes to a few hours depending on restore path

These are targets for planning, not guarantees, until restore drills have been executed.

### Restore priority order
1. Use HA/failover for infrastructure-only incidents.
2. Use PITR restore for recent corruption/operator mistakes.
3. Use vaulted backup restore for late-discovered corruption or severe compromise.
4. Use logical export for targeted/manual reconstruction if other paths are insufficient.

### Restore validation
Every restore path must be validated by drill, not assumed.

Minimum drill cadence:
- one initial end-to-end production-like restore rehearsal before go-live
- quarterly restore drill thereafter

Each drill should verify:
- database can be restored into isolated environment
- app can boot against restored data
- `/healthz` responds
- one participant flow and one admin/reporting flow can be exercised

## IaC Implications
Production should no longer use the staging-style database baseline.

The production profile should move toward:
- `POSTGRES_SKU_TIER=GeneralPurpose`
- higher production-appropriate SKU than `Standard_B1ms`
- `POSTGRES_BACKUP_RETENTION_DAYS=35`
- geo-redundant backup enabled
- HA enabled

These should be represented as explicit production environment values, not manual portal drift.

Azure Backup vault resources and protection configuration are expected follow-up infrastructure work and should be tracked separately from the initial production cutover issue.

## Runbook Expectations
Before production go-live, we should have:
- backup policy documented
- restore decision tree documented
- named restore commands and portal paths documented
- ownership defined for who can execute restore
- post-restore verification checklist documented

## Decision Summary
Chosen strategy:
- do not rely on a single mechanism
- combine HA, native PITR, geo-redundant backup, and vaulted backup
- add pre-change logical export for high-risk operations
- require restore drills as part of operational readiness

Rejected as standalone strategy:
- HA only
- read replicas only
- native backup only
- ad hoc manual exports only

## References
- Azure PostgreSQL backup and restore:
  - https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore
- Azure PostgreSQL business continuity:
  - https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity
- Azure PostgreSQL read replicas:
  - https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas
- Azure Backup for PostgreSQL overview:
  - https://learn.microsoft.com/en-us/azure/backup/backup-azure-database-postgresql-overview
- Restore dropped PostgreSQL flexible server:
  - https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/how-to-restore-dropped-server
