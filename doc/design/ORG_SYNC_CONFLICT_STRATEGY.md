# Org Sync Conflict and Override Strategy

## Scope
Applies to `POST /api/admin/sync/org/delta`.

## Delta model
Each record carries:
- `externalId`
- `email`
- `name`
- optional `department`, `manager`, `activeStatus`

## Conflict strategy (`config/org-sync.json`)
- `merge_by_email` (default):
  - If `externalId` is new but `email` exists, existing user is re-keyed to incoming `externalId`.
  - If incoming `externalId` exists and incoming `email` belongs to another user, sync record fails (safe-stop for that record).
- `skip_conflict`:
  - Potential identity conflicts are skipped and counted as `skippedConflictCount`.

## Override flags
- `allowDepartmentOverwrite`: controls department updates during sync.
- `allowManagerOverwrite`: controls manager updates during sync.
- `defaultActiveStatus`: used when `activeStatus` is omitted on new users.

## Observability and recovery
- Operational events:
  - `org_sync_delta_started`
  - `org_sync_delta_completed`
  - `org_sync_delta_failed_record`
- Audit events:
  - `org_sync_completed`
  - `org_sync_record_failed`

Recovery path:
- Re-run delta after correcting source identity collisions or adjusting conflict strategy.
