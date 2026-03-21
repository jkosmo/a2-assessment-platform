# Post-Architecture Consolidation Plan

## Scope
This note captures the remaining high-value gap work after the latest round of architecture improvements.

It is based on the current codebase posture:
- major structural rescue work is largely complete
- worker separation and core decision-write transactions are in place
- the next phase is consistency hardening, documentation sync, and cleanup of remaining hotspots

This is not a replacement for `#171 EPIC: Feature-modular monolith`.
Instead, it defines the near-term consolidation work that should happen before or alongside any larger future module migration.

## Current Assessment
The repo has moved from "architecture needs rescue" to "architecture needs consolidation".

The most important remaining gaps are:
- documentation drift from current code
- at least one remaining multi-step write flow without a clear transaction boundary
- inconsistent route-level error handling patterns
- `adminContent` route still acting as a validation/mapping hotspot
- incomplete confidence in RBAC coverage and some overly detailed UI contract tests

## Design Decision
Split the remaining work into two tracks:

1. Documentation synchronization
- update operator/developer documents to match the actual process model, appeal flow, and observability model
- reduce documentation drift before it becomes institutionalized

2. Runtime and API consistency hardening
- finish transaction coverage for remaining multi-step writes
- standardize route error handling patterns
- reduce route hotspots where mapping and validation still live too high in the stack
- improve confidence in access-control tests

## Relationship to Existing Epics

### `#171 EPIC: Feature-modular monolith`
Still valid for longer-horizon internal modularization work:
- explicit `src/modules/*` ownership
- boundary contracts
- module extraction for assessment, review/appeal, reporting

This consolidation plan does **not** duplicate that epic.

Near-term rule:
- use this plan for behavior-preserving hardening and cleanup
- use `#171` for larger structural extraction once the current hotspots are safer and the docs are current

### Production epics
Production rollout (`#154`) and production backup/recovery (`#218`) remain separate and should not be mixed into this plan.

## Epic A: Documentation Sync With Current Runtime

### Goal
Bring the main operational and lifecycle documents back into sync with the actual code and Azure shape.

### Included documents
- `doc/OPERATIONS_RUNBOOK.md`
- `doc/DOMAIN_LIFECYCLE.md`
- `doc/OBSERVABILITY_RUNBOOK.md`

### Design rules
- docs must describe the current `PROCESS_ROLE=web|worker|all` model, not the earlier single-process assumption
- docs must reflect the actual appeal/manual-review/decision-lineage behavior
- docs must reference current alerts, recovery paths, and KQL patterns without stale placeholders or contradictory naming

### Done when
- the above documents match the implemented process model and route behavior
- stale roadmap language is removed or clearly marked as historical
- cross-links between operations, observability, and lifecycle docs are internally consistent

## Epic B: Runtime and API Consistency Hardening

### Goal
Finish the remaining high-value consistency work without turning it into a large refactor wave.

### Slice 1: Transaction coverage
Priority:
- start with `createSubmissionAppeal`

Design rules:
- any multi-step write flow that creates or updates more than one durable record, or mixes business writes with audit/derived state updates, should be reviewed for a single transaction boundary
- the audit should classify each write flow as:
  - already atomic enough
  - should be wrapped in `prisma.$transaction`
  - should be split before transaction wrapping

### Slice 2: Route error-handling standardization
Design rules:
- route handlers should prefer:
  - validation
  - service call
  - `next(error)` on failure
- expected business failures should be represented as `AppError`
- routes should avoid building ad hoc local 500 responses unless the route truly owns a special-case contract

### Slice 3: `adminContent` route slimming
Design rules:
- do not attempt full module migration yet
- extract validation, request-to-service mapping, and serialization out of the route file first
- keep behavior stable while shrinking route responsibilities

This is intentionally a pre-modularization step and should remain compatible with the later `#171` path.

### Slice 4: Access-control and contract test hardening
Design rules:
- add table-driven RBAC matrix tests for sensitive route families:
  - admin
  - review
  - appeal
  - audit
  - reporting
- keep HTML/workspace contract tests for high-value page wiring and accessibility invariants
- trim low-signal assertions that are brittle because they encode incidental markup shape instead of behavior

## Recommended Sequencing
Recommended order:

1. Documentation sync
- lowest implementation risk
- reduces operator confusion while code changes continue

2. `createSubmissionAppeal` transaction boundary
- smallest high-value integrity fix

3. Audit remaining multi-step write flows
- turns intuition into an explicit checklist

4. Route error-handling standardization
- easiest to scale once the target pattern is written down

5. RBAC matrix tests
- strengthens safety net before more route cleanup

6. `adminContent` route slimming
- do after the above so the extraction lands against a clearer error-handling and test baseline

## Non-Goals For This Plan
- full feature-module extraction across the codebase
- redesign of decision lineage or certification domain model
- broad frontend redesign
- production infrastructure changes unrelated to the consistency/documentation gaps

## Success Criteria
This consolidation phase is complete when:
- the key docs match the current runtime and domain behavior
- all known multi-step critical write flows have explicit transaction decisions
- route error handling follows a more consistent `AppError` + `next(error)` pattern
- `adminContent` is measurably less route-heavy
- RBAC coverage exists for sensitive routes
- HTML/workspace tests are focused on durable behavior rather than incidental markup
