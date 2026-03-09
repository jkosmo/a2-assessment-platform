# Phase 2 Participant Console UX Design Notes

## Issue #51 - Mock-mode role switch dropdown for test console
Date: 2026-03-09

### Design/Architecture gate
- Scope impact: frontend participant console + lightweight config exposure from backend.
- New boundary introduced: participant console runtime config payload for auth-mode-aware UX.
- Options considered:
  1. Hardcode role presets in `public/participant.js` and infer mode from env assumptions.
  2. Expose small config object from backend and keep frontend behavior data-driven.
- Chosen approach: option 2, to keep role presets and mode behavior config-driven and avoid future UI hardcoding.

### Refactor gate
- Existing participant script duplicates literal role assumptions and has no server-driven runtime config.
- Small targeted refactor is justified: add a dedicated participant console config loader and frontend render helper.
- No broad architectural refactor needed in this issue.

### Rollout and rollback
- Rollout: additive UI helper in mock mode only, manual role input preserved.
- Rollback: remove config-driven helper UI path and keep manual role field only.

## Issue #49 - Participant module selection UX hardening
Date: 2026-03-09

### Design/Architecture gate
- Scope impact: participant module list rendering and selected-module summary model.
- New boundary introduced: module selection should carry both machine id and localized display title.
- Options considered:
  1. Keep button list and add small selected marker.
  2. Move to explicit card/list-item rendering with selected badge and keyboard focus state.
- Chosen approach: option 2 for clarity and reduced wrong-module risk while preserving existing API and selection behavior.

### Refactor gate
- Existing selected-module handling stores only id in an input, which weakens readability and future state handling.
- Small targeted refactor is justified: keep selected module as structured state (`id`, `title`) and derive UI summary from that state.
- Broader state management rewrite is out of scope.

### Rollout and rollback
- Rollout: rendering-only UX upgrade with existing module payload.
- Rollback: fallback to prior button list and id-only summary.

## Issue #50 - Module-scoped draft autosave and restore
Date: 2026-03-09

### Design/Architecture gate
- Scope impact: participant UI state lifecycle, local browser persistence, and runtime config exposure.
- New boundary introduced: module-scoped draft persistence contract (text + optional MCQ state) with expiration.
- Options considered:
  1. Session-only in-memory cache.
  2. Local storage with TTL and per-module envelopes.
- Chosen approach: option 2 to satisfy deterministic restore after page reload in same browser and keep behavior configurable by TTL.

### Refactor gate
- Existing participant UI uses direct DOM reads/writes with no module-scoped state abstraction.
- Small targeted refactor is justified: add draft-state helper functions and participant runtime config for storage key/TTL.
- Avoid full framework/state-library migration in this issue.

### Rollout and rollback
- Rollout: additive local draft persistence scoped by module id.
- Rollback: disable persistence path and keep direct field-only behavior.

## Issue #52 - Progressive flow gating in participant UI
Date: 2026-03-09

### Design/Architecture gate
- Scope impact: participant UI action availability model across submission, MCQ, assessment, and appeal phases.
- New boundary introduced: explicit client-side flow state machine for gating and inline explanatory hints.
- Options considered:
  1. Ad-hoc button toggles in each event handler.
  2. Centralized derived gate-state function with deterministic transition inputs.
- Chosen approach: option 2 to keep gating rules testable and avoid divergent UI behavior.

### Refactor gate
- Existing handlers mutate labels/buttons independently with no single source of truth for readiness.
- Small targeted refactor is justified: introduce shared flow-state object and derived gating helper.
- Full finite-state-machine framework is unnecessary for current scope.

### Rollout and rollback
- Rollout: UI-only progressive gating with no API behavior change.
- Rollback: remove gate-state rendering and re-enable current always-visible controls.

## Issue #48 - Appeal handler UI workspace (claim/resolve)
Date: 2026-03-09

### Design/Architecture gate
- Scope impact: participant test console gains a role-based handler workspace that exercises existing appeal APIs.
- New boundary introduced: handler workspace UI model (queue filters, selected appeal detail, claim/resolve actions).
- Options considered:
  1. Minimal raw endpoint buttons with JSON output only.
  2. Structured workspace panel with status filters, selected appeal detail, and action form.
- Chosen approach: option 2 to reduce verification friction and expose status/timestamp transitions clearly.

### Refactor gate
- Existing participant console mixes all actions in one linear flow; appeal handler actions are absent.
- Small targeted refactor is justified: add dedicated workspace state/helpers without changing backend appeal rules.
- Broader role-specific app shell split is out of scope.

### Rollout and rollback
- Rollout: additive test-console section that calls already-existing APIs.
- Rollback: remove workspace section and retain participant appeal-create section only.
