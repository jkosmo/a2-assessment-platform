# Architecture End-State Refactor Plan

## Scope
This note defines the desired end-state architecture for the next refactoring wave.

It intentionally assumes we do **not** need to optimize for long-lived transitional states.
That means:
- no permanent compatibility shims
- no duplicated sources of truth kept "for now"
- no design that depends on legacy and target structures coexisting indefinitely

We still sequence by risk, but we design for full cutover.

## End-State Principles

### 1. One source of truth per concern
The system should not describe the same capability, route, role requirement, env default, or event contract from multiple places.

End-state rule:
- every cross-cutting concern has one canonical source
- everything else is derived from it

### 2. Modules are real boundaries, not folders
`src/modules/*` should express actual ownership, not just file grouping.

End-state rule:
- module services do not import Prisma directly unless they are explicit transaction scripts
- repositories own persistence interaction
- feature APIs return module-owned DTOs/view models
- cross-module access goes through module public APIs

### 3. Runtime startup should be side-effect-light
Normal app startup should start the app.
It should not opportunistically perform unrelated bootstrap work.

End-state rule:
- bootstrap/seed flows are explicit commands or deploy steps
- runtime processes expose meaningful health and role identity

### 4. Documentation is generated or anchored from code where possible
Permanent docs should describe the live system, not remembered architecture.

End-state rule:
- routes, roles, workspace exposure, and env defaults should be derived from code-owned sources where practical
- docs should not carry their own competing contract definitions

### 5. Event contracts are typed
Audit and operational signals are part of the platform contract.

End-state rule:
- event names come from typed catalogs
- important payload minimums are explicit

## Desired End-State Shape

### Capability and route contract
Introduce one code-owned capability catalog, for example under:

```text
src/platform/capabilities/
  capabilities.ts
  routeContracts.ts
  workspaceContracts.ts
```

That source defines:
- route ids
- route paths
- required roles
- workspace exposure
- navigation visibility
- documentation metadata where useful

Everything else should derive from it:
- route mounting in `src/app.ts`
- runtime workspace config returned by `/participant/config`
- RBAC matrix tests
- API/workspace documentation

`config/participant-console.json` should no longer be the canonical owner of role requirements.
If it still exists, it should hold only presentation/runtime knobs that are not contract truth.

### Module boundary contract
Each business module should follow this internal shape:

```text
src/modules/<feature>/
  index.ts
  commands/
  queries/
  repositories/
  dto/
  domain/
```

End-state rules:
- `commands/` own write orchestration
- `queries/` own read-model assembly
- `repositories/` own Prisma access
- `dto/` own public module shapes
- `domain/` owns pure rules/value logic

No module service file should mix:
- Prisma transaction ownership
- repository details
- audit/event naming
- notification side effects
- transport-facing shaping

### DTO/view-model contract
Routes should consume module-owned output shapes such as:
- `SubmissionResultView`
- `SubmissionHistoryItemView`
- `ReviewWorkspaceView`
- `AppealWorkspaceView`
- `ReportRow`
- `ModuleListItemView`

Routes should not reshape include-heavy persistence graphs.
Serialization should be close to trivial at the route boundary.

### Runtime contract
Worker/runtime end-state:
- worker identity is instance-aware, not `default-worker`
- workers process immediately on startup, then continue on interval
- worker health exposes role, last successful cycle, and queue-relevant status
- startup does not run bootstrap seed as part of normal web startup
- rate-limiting assumptions are explicit and production-suitable

### Documentation contract
Docs should be reorganized around code-owned truth:
- API and workspace route docs derived from route/capability contracts
- env/default docs derived from `src/config/env.ts`
- operations docs aligned to current monitors in `src/index.ts`
- no permanent references to obsolete workspace routes
- no permanent references to dead source paths

### Event contract
Introduce code-owned event catalogs, for example:

```text
src/platform/events/
  auditEvents.ts
  operationalEvents.ts
```

End-state rules:
- feature code imports canonical event names
- important payload fields are typed or constrained through helper factories
- runbooks and queries refer to canonical event names

## What Must Be Removed

The end-state is not complete if the old duplication still exists.

The refactor is only done when we remove:
- duplicated role/capability definitions across app/config/tests/docs
- direct Prisma imports from non-repository module orchestration code, except explicit transaction scripts by design
- routes that still perform module-internal shaping and policy decisions
- docs that point to obsolete routes or source paths
- startup behavior that performs bootstrap seeding as a normal web-start side effect
- ad hoc audit/operational event strings in the targeted refactored areas

## Sequencing By Risk

### Phase 1: establish canonical contracts
Do first:
- capability catalog
- event catalogs
- env/default source alignment

Reason:
- these reduce drift everywhere else

### Phase 2: cut docs and tests over to canonical contracts
Do next:
- route/workspace docs regeneration or direct alignment
- RBAC matrix cutover to shared capability source

Reason:
- we want docs/tests to validate the new truth, not preserve the old duplication

### Phase 3: cut module boundaries over fully
Do next:
- remove direct Prisma imports from targeted module orchestration files
- introduce DTO/view-model boundaries for the first feature paths
- remove persistence-shaped leakage from routes

Reason:
- this is the highest implementation risk and should happen after the contract layer is stable

### Phase 4: cut runtime over fully
Do next:
- remove bootstrap seed from normal startup
- improve worker identity/startup/health semantics

Reason:
- runtime changes are operationally sensitive and should land against clearer docs and module boundaries

## Non-Goals
- multi-month compatibility phases
- keeping JSON/config/docs duplication "temporarily" without an explicit removal point
- rebuilding the application into distributed services
- solving every historical design note at once

## Success Criteria
This refactor wave is complete when:
- one capability source drives routes, runtime config, tests, and docs
- one env source drives env/default docs
- one event catalog drives the targeted audit/ops signals
- targeted modules no longer leak Prisma and persistence shapes upward
- startup is side-effect-light
- docs describe only the live architecture, not legacy leftovers

## References
- `doc/design/ARCHITECTURE_AND_REFACTORING_BACKLOG_2026-03-23.md`
- `doc/design/INTERNAL_MODULE_BOUNDARY_CONTRACTS.md`
