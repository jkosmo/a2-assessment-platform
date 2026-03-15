# Phase 2 Calibration Workspace - Phase A Design

## Context
Issue #32 is broad. Issue #67 scopes a first read/analyze slice for `SUBJECT_MATTER_OWNER` and `ADMINISTRATOR` roles without introducing publish/write behavior.

## Problem Statement
SMEs need module-level calibration insight from historical outcomes and benchmark anchors, with filterable context and explicit quality signals.

## Options Considered
1. Reuse existing reporting endpoints only.
- Pros: minimal new surface.
- Cons: reporting payloads are not calibration-oriented and lack benchmark-anchor comparison.

2. Build dedicated calibration read API + workspace page (chosen).
- Pros: clear contract for calibration use-case, focused UI, low risk (read-only), easy to evolve toward full #32.
- Cons: introduces new route/service/files.

## Chosen Approach
- Add dedicated route: `GET /api/calibration/workspace`.
- Add dedicated page: `/calibration`.
- Keep behavior config-driven via `config/participant-console.json`:
  - `calibrationWorkspace.accessRoles`
  - `calibrationWorkspace.defaults`
  - `calibrationWorkspace.signalThresholds`
- Compute calibration signals in a dedicated service:
  - pass rate
  - manual-review signal rate
  - benchmark coverage rate
  - threshold flags
- Record audit event on workspace snapshot load:
  - `entityType=calibration_workspace`
  - `action=calibration_workspace_session_started`

## Data/API/Operational Impact
- No schema migration.
- New API route under existing auth middleware and role guard.
- No write/publish behavior in Phase A.
- New static UI page and i18n bundle.

## Rollout/Rollback
- Rollout is additive and low-risk.
- Rollback can remove `/calibration` and `/api/calibration/*` wiring with no data changes.
