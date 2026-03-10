# Phase 2 Participant Completed Modules Design

## Context
Issue #66 requires a participant-facing overview of completed modules and a stricter available-module list that hides completed modules by default.

## Problem Statement
Participants should focus on remaining work. Completed modules must be visible in a dedicated view and excluded from the default active module list.

## Chosen Approach
- Introduce a central completion policy config:
  - `config/module-completion.json`
  - completion statuses, default filtering behavior, and list limits
- Add a shared policy service:
  - `src/services/moduleCompletionPolicyService.ts`
  - centralizes completed-status classification and include-completed/default-limit rules
- Extend module APIs:
  - `GET /api/modules` now applies config-driven completed filtering by default
  - optional `includeCompleted=true` for debug/admin use
  - `GET /api/modules/completed?limit=<n>` returns participant completed-module history with latest score/status
- Add dedicated participant completed-modules workspace:
  - `/participant/completed`

## Data/API Impact
- No schema changes.
- Additive API route and query behavior.
- Existing clients still receive `modules` from `/api/modules`; additional `filters` metadata is additive.

## Rollout/Rollback
- Additive and low risk.
- Rollback can remove completed-page route and completion filtering logic, restoring prior `/api/modules` behavior.
