# Phase 2 Design Note: HR/LMS Delta Sync for Participant and Org Metadata (#28)

## Context
Issue #28 requires authoritative participant/org synchronization with delta updates, documented conflict strategy, and observability/recovery.

## Chosen approach
- Add admin-only delta sync endpoint:
  - `POST /api/admin/sync/org/delta`
- Use config-driven sync policy (`config/org-sync.json`) for conflict and overwrite behavior.
- Apply idempotent upsert logic on `User` records keyed by `externalId` with optional email-merge strategy.
- Treat `department` as org-unit metadata in current schema.

## Conflict and recovery
- Supported conflict strategies:
  - `merge_by_email` (default)
  - `skip_conflict`
- Per-record failures are captured and reported while allowing remaining records to proceed.
- Operational logs + audit events provide recovery trail for re-run.

## Rollout/rollback
- Additive API; no schema migration.
- Behavior can be tuned through config without code changes.
