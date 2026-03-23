# Architecture And Refactoring Backlog 2026-03-23

## Scope
This note captures the remaining architecture and refactoring work after the latest modularization and consistency-hardening wave.

It is based on:
- the current repository state on `2026-03-23`
- the external assessment provided in the current thread
- current GitHub issue state, where the previous broad post-architecture cleanup epic has already been closed

This note is intentionally selective.
It only turns validated gaps into backlog.

## Current Posture
The codebase is no longer in a "needs major architectural rescue" phase.
It is in a "reinforce boundaries and reduce operational/documentation drift" phase.

The strongest current properties are:
- clear domain modules under `src/modules/*`
- append-only decision lineage for assessment, manual review, and appeals
- better-than-average runtime topology for web/worker separation
- good core flow coverage in tests

The most important remaining weaknesses are:
- direct Prisma usage and transaction orchestration still leaking into module services
- route and capability contracts still duplicated across code, runtime config, tests, and docs
- remaining documentation drift for workspace routes, runtime topology, and env defaults
- worker/runtime details that are robust enough today but still optimistic for future scaling
- event names and payload expectations still encoded as free-form strings

## Important Corrections To The External Assessment

### Already stronger than the assessment implies
- `resolveAssessmentDecision` already has extensive unit coverage in `test/unit/decision-service.test.ts`
- RBAC matrix coverage already exists in `test/unit/rbac-matrix.test.ts`
- a lot of the old `src/services/*` to `src/modules/*` transition has already been cleaned up
- the previous admin-content and supersede hardening workstreams are already closed

### Still valid and worth turning into backlog
- capability/RBAC duplication is real
- docs drift is real
- direct Prisma imports in module services are real
- module read paths still expose too much persistence-shaped data upward
- worker/runtime semantics still deserve one more hardening pass
- bootstrap seed should not be part of normal web startup

## Workstream A: Capability And Contract Source Of Truth

### Problem
Workspace routes, required roles, runtime config, tests, and docs are all describing overlapping parts of the same access model, but from different places.

Current examples:
- route gates in `src/app.ts`
- workspace navigation and required roles in `config/participant-console.json`
- tests in `test/unit/rbac-matrix.test.ts`
- docs in `doc/API_REFERENCE.md`, `doc/GETTING_STARTED.md`, and design/runbook material

This creates drift risk:
- `/review` is the real workspace route, while some docs still describe `/manual-review` and `/appeal-handler`
- capability semantics can diverge between backend enforcement and UI exposure

### Goal
Define one TypeScript-owned capability catalog that becomes the source of truth for:
- route role requirements
- workspace exposure/runtime config
- API/workspace documentation
- RBAC matrix tests where practical

### Design Rules
- one source defines route/workspace identity, path, and allowed roles
- app bootstrapping consumes this source instead of repeating role arrays inline
- runtime-config generation should derive from the same source rather than manually duplicating required roles
- documentation should be generated or partially generated from the same source where practical

## Workstream B: Module Boundary Reinforcement

### Problem
The repo is visibly modular, but the boundaries are not fully enforced yet.

Current symptoms:
- multiple module services still import `prisma` directly
- module services mix:
  - transaction ownership
  - repository calls
  - audit
  - notifications
  - cross-module orchestration
- repositories and services still expose persistence-shaped object graphs upward

### Goal
Strengthen the modular monolith so feature modules have clearer internal layering:
- repositories own persistence details
- module commands own orchestration
- transaction ownership is explicit
- routes consume feature-level DTOs/view models rather than raw persistence shapes

### Design Rules
- direct Prisma usage should live in repositories or explicit per-module transaction scripts
- services may accept a tx-aware repository/command port, but should not all import `prisma` ad hoc
- module public APIs should return module-owned DTO/view models, not include-heavy Prisma graphs
- cross-module calls should stay narrow and intentional

## Workstream C: Runtime And Worker Hardening

### Problem
The worker/runtime shape is already good, but some defaults are still too optimistic for growth:
- `lockedBy` still uses a generic worker identity in parts of the flow
- `AssessmentWorker` uses interval polling without an immediate first tick
- worker health is still mostly process heartbeat
- bootstrap seed still runs as part of normal web startup
- rate limiting still uses in-memory storage

### Goal
Make the runtime more production-credible without redesigning the whole hosting model.

### Design Rules
- job ownership should reflect instance identity
- worker startup should process immediately, not only after the first interval
- worker health should expose meaningful runtime state
- startup should not include non-essential seed side effects
- any remaining single-instance assumptions should be explicit in docs and config

## Workstream D: Event Contract Hardening

### Problem
Audit action names and operational event names are still stringly typed across the codebase.

This makes it too easy to:
- introduce spelling drift
- change event names unintentionally
- lose shared payload expectations across features and runbooks

### Goal
Introduce typed event catalogs for:
- audit events
- operational events

### Design Rules
- centralize canonical event names
- define minimum payload expectations for important events
- use catalogs from feature modules instead of free-form strings

## Workstream E: Documentation Drift Cleanup

### Problem
The docs are broad and useful, but still drift from actual runtime and route behavior.

Verified current examples:
- `doc/API_REFERENCE.md` still refers to `/manual-review` and `/appeal-handler`
- `doc/GETTING_STARTED.md` still points people to old workspace routes
- `.env.example` still documents `AZURE_OPENAI_TIMEOUT_MS=30000` while `src/config/env.ts` defaults to `120000`
- `doc/OPERATIONS_RUNBOOK.md` still mentions old source paths such as `src/services/AssessmentWorker.ts`
- current worker topology now also includes `PseudonymizationMonitor` and `AuditRetentionMonitor`

### Goal
Bring docs back to being trustworthy for onboarding and operations.

### Design Rules
- docs should reflect actual paths and routes in `src/app.ts` and `src/index.ts`
- monitor/runbook docs should describe all active worker monitors
- env defaults should be documented from the real source of truth
- avoid Windows-absolute file references in permanent docs when relative repo paths are sufficient

## Recommended Sequencing

1. Capability and docs source-of-truth
- fastest payoff against drift
- reduces repeated future cleanup

2. Documentation cleanup from the unified capability/runtime source
- makes current architecture easier to onboard into

3. Module boundary reinforcement
- direct Prisma reduction
- DTO/view-model introduction

4. Event contract hardening
- easier once module boundaries are clearer

5. Runtime/worker hardening
- do after the boundaries and docs are clearer, unless a production incident forces it earlier

## Non-Goals
- replacing the modular monolith with microservices
- rewriting Prisma out of the system
- redoing the full UI architecture
- moving every shared concern into a perfect DDD package structure

## Success Criteria
This backlog is complete when:
- route/workspace capability rules come from one source
- docs no longer disagree with actual routes, monitors, or env defaults
- module services no longer casually import Prisma for mixed orchestration
- key feature read paths return module-owned DTOs/view models
- event names and payload expectations are cataloged
- worker startup and health semantics are more explicit and less instance-naive

## References
- `src/app.ts`
- `src/index.ts`
- `src/config/env.ts`
- `config/participant-console.json`
- `doc/API_REFERENCE.md`
- `doc/GETTING_STARTED.md`
