# Phase 2 Design Note: Recertification Engine and Reminder Flow (#27)

## Context
Issue #27 requires configurable recertification due-date rules, pre-expiry reminder scheduling, and reportable recertification status.

The data model already contains `CertificationStatus` fields (`passedAt`, `expiryDate`, `recertificationDueDate`), but no lifecycle logic currently updates or reports them.

## Chosen approach
- Add recertification policy to `assessment-rules` config:
  - `validityDays`, `dueOffsetDays`, `dueSoonDays`
  - `reminderDaysBefore[]`
- Introduce `recertificationService` to:
  - upsert certification status from final decisions
  - derive runtime status buckets (`ACTIVE`, `DUE_SOON`, `DUE`, `EXPIRED`, `NOT_CERTIFIED`)
  - run reminder schedule for configured offsets
- Integrate status updates at final decision points:
  - automatic completed decisions
  - manual override decisions
  - appeal-resolution decisions
- Extend reporting with recertification status endpoint.
- Add admin-triggerable reminder run endpoint (schedule-compatible for cron/job automation).

## Traceability
- Reminder send/failure is logged to operational logs.
- Reminder outcomes are auditable via `audit_event` entries on `certification_status` entities.

## Rollout/rollback
- Policy is config-first and can be adjusted or disabled by setting reminder offsets to empty.
- No schema migration required.
