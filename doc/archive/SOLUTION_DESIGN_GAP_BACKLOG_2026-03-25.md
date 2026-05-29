# Solution Design Gap Backlog 2026-03-25

## Scope
This note turns the latest external solution-design assessment into a usable backlog for the current repository state on `2026-03-25`.

It is intentionally selective:
- validate the assessment against the current codebase
- avoid reopening work that is already closed or materially improved
- define a small set of Epics and issue drafts that close the real remaining gaps

## Inputs Reviewed
- external assessment: `a_2_assessment_platform_teknisk_analyse.md`
- existing backlog notes:
  - `doc/design/ARCHITECTURE_AND_REFACTORING_BACKLOG_2026-03-23.md`
  - `doc/design/GAP_ANALYSIS_DELTA_2026-03-21.md`
  - `doc/design/ARCHITECTURE_END_STATE_REFACTOR_PLAN.md`
- current implementation hotspots:
  - `src/modules/submission/submissionService.ts`
  - `src/modules/assessment/decisionService.ts`
  - `src/modules/assessment/AssessmentDecisionApplicationService.ts`
  - `src/modules/review/manualReviewService.ts`
  - `src/modules/appeal/appealService.ts`
  - `src/modules/review/manualReviewReadModels.ts`
  - `src/modules/appeal/appealReadModels.ts`
  - `src/modules/submission/submissionReadModels.ts`
  - `src/repositories/moduleRepository.ts`
  - `src/config/capabilities.ts`
  - `src/app.ts`
  - `src/index.ts`
  - `scripts/runtime/startup.mjs`
  - `doc/API_REFERENCE.md`
  - `doc/GETTING_STARTED.md`
  - `doc/OPERATIONS_RUNBOOK.md`
  - `doc/OBSERVABILITY_RUNBOOK.md`

## Executive Conclusion
The external assessment is directionally correct, but too broad for the current repository.

The codebase no longer needs a large "architecture rescue" program.
It needs a focused backlog around:
- service-orchestration hotspots
- persistence-shaped read models and shared repository leakage
- remaining contract/documentation drift
- runtime/bootstrap semantics and worker-health visibility

Several concerns from the assessment are already materially stronger than implied:
- route-role contracts are already centralized in `src/config/capabilities.ts`
- audit and operational event names are already typed in `src/observability/auditEvents.ts` and `src/observability/operationalEvents.ts`
- unit coverage for decision, review, appeal, worker, and read-model flows is already strong
- admin-content has already been split into commands, queries, repository, projections, and schemas

## What Should Not Become New Epics
- No new generic RBAC epic
- No new generic event-catalog epic
- No new generic "add unit tests" epic
- No new broad "migrate services to modules" epic

Those themes should instead be treated as done or as acceptance criteria inside the remaining targeted work.

## Validated Remaining Gaps

### 1. Service orchestration is still too broad in core flows
Still visible in:
- `src/modules/submission/submissionService.ts`
- `src/modules/assessment/decisionService.ts`
- `src/modules/assessment/AssessmentDecisionApplicationService.ts`
- `src/modules/review/manualReviewService.ts`
- `src/modules/appeal/appealService.ts`

Current symptom:
- state transition, repository access, audit, notifications, and operational logging are still mixed in the same flow functions

### 2. Read models still depend on persistence-shaped repository outputs
Still visible in:
- `src/modules/review/manualReviewReadModels.ts`
- `src/modules/appeal/appealReadModels.ts`
- `src/modules/submission/submissionReadModels.ts`

Current symptom:
- view-model mappers derive types from repository return shapes instead of module-owned DTOs
- workspace reads still expose large persistence graphs upward

### 3. Repository ownership is still partly blurred
Still visible in:
- `src/repositories/moduleRepository.ts`
- `src/repositories/decisionRepository.ts`
- cross-module reads from submission/review/appeal flows

Current symptom:
- some repositories are feature-local, some remain shared utility hubs
- `moduleRepository` in particular still acts as a broad shared query surface

### 4. Capability/source-of-truth work is improved, but not complete
Still visible in:
- `src/config/capabilities.ts`
- `src/app.ts`
- `doc/API_REFERENCE.md`
- `doc/GETTING_STARTED.md`

Current symptom:
- route-role truth is centralized in code
- documentation is still manually maintained and can drift from the capability contract
- calibration remains runtime-configured through `config/participant-console.json`, which is valid but should be explicitly modeled as an override

### 5. Runtime/bootstrap/docs drift still exists
Still visible in:
- `scripts/runtime/startup.mjs`
- `doc/OPERATIONS_RUNBOOK.md`
- `doc/OBSERVABILITY_RUNBOOK.md`

Current symptom:
- `startup.mjs` still imports `bootstrapSeed.mjs` during normal startup flow
- `OPERATIONS_RUNBOOK.md` still describes an outdated startup sequence
- runbooks still contain Windows-absolute links

### 6. Worker health is still too thin for future operations
Still visible in:
- `src/index.ts`
- `src/modules/assessment/AssessmentWorker.ts`

Current symptom:
- worker-only heartbeat exposes only process liveness plus assessment-worker status
- no unified status for appeal SLA, pseudonymization, or retention monitors

## Recommended GitHub Shape

## Epic 1: Reinforce Module Boundaries In Core Flows
Goal:
- shrink orchestration hotspots
- separate command logic from post-commit side effects
- reduce persistence leakage across module boundaries

### Issue 1.1
Title:
- Refactor submission creation into command core plus side-effect handlers

Scope:
- target `src/modules/submission/submissionService.ts`
- isolate submission creation + supersede transaction from operational logging
- keep audit in-transaction where needed, move non-critical logging after commit

Acceptance criteria:
- `createSubmission` no longer mixes command mutation and operational event emission in one function body
- supersede flow remains transactional
- regression coverage stays green

Priority:
- High

### Issue 1.2
Title:
- Split manual-review resolution flow into transaction command and notification adapter

Scope:
- target `src/modules/review/manualReviewService.ts`
- separate override decision + review resolution from participant notification/logging

Acceptance criteria:
- a transaction-focused command owns state changes
- notification failure handling is outside the command core
- public module API stays behaviorally unchanged

Priority:
- High

### Issue 1.3
Title:
- Split appeal resolution flow into transaction command and notification adapter

Scope:
- target `src/modules/appeal/appealService.ts`
- separate resolution decision + appeal resolution from participant notification/logging

Acceptance criteria:
- `resolveAppeal` no longer owns both transactional mutation and outbound notification orchestration
- claim/resolve behavior remains unchanged
- existing appeal tests still cover the same lifecycle

Priority:
- High

### Issue 1.4
Title:
- Collapse assessment decision creation into a single command boundary

Scope:
- target `src/modules/assessment/decisionService.ts`
- target `src/modules/assessment/AssessmentDecisionApplicationService.ts`
- make the transactional command boundary explicit and keep notification/audit layering intentional

Acceptance criteria:
- responsibility split between decision creation and post-decision actions is explicit
- no duplicate orchestration semantics across the two files
- current unit coverage remains intact

Priority:
- Medium

### Issue 1.5
Title:
- Replace persistence-derived workspace view types with module-owned DTOs

Scope:
- target:
  - `src/modules/review/manualReviewReadModels.ts`
  - `src/modules/appeal/appealReadModels.ts`
  - `src/modules/submission/submissionReadModels.ts`
- introduce explicit DTO/view types owned by each module

Acceptance criteria:
- read-model mappers no longer define their input types from repository return types
- route-facing views are based on module-owned DTO contracts
- tests assert DTO/view behavior, not Prisma graph shape

Priority:
- High

### Issue 1.6
Title:
- Narrow shared repositories and move feature-specific queries back to owning modules

Scope:
- start with `src/repositories/moduleRepository.ts`
- identify queries that belong in submission/reporting/module-specific repositories

Acceptance criteria:
- shared repository surface is smaller and explicitly cross-cutting
- feature modules own the queries they depend on most
- no net behavior change at the HTTP layer

Priority:
- Medium

## Epic 2: Finish Contract And Documentation Source-of-Truth Work
Goal:
- make code the canonical owner of route/workspace contracts
- reduce manual duplication in docs and runtime contract descriptions

### Issue 2.1
Title:
- Generate or derive API/workspace documentation from the capability contract

Scope:
- target:
  - `src/config/capabilities.ts`
  - `doc/API_REFERENCE.md`
  - `doc/GETTING_STARTED.md`
- choose either generated markdown or a partial generated section with a checked-in artifact

Acceptance criteria:
- route-role tables are no longer manually duplicated in permanent docs
- workspace URLs and role expectations align with the code-owned contract
- calibration override behavior is explicitly documented

Priority:
- High

### Issue 2.2
Title:
- Remove stale and machine-specific runbook links and startup descriptions

Scope:
- target:
  - `doc/OPERATIONS_RUNBOOK.md`
  - `doc/OBSERVABILITY_RUNBOOK.md`
- replace Windows-absolute links with repo-relative links
- align startup narrative with `scripts/runtime/startup.mjs` and `src/index.ts`

Acceptance criteria:
- no permanent docs contain machine-specific absolute paths
- operations runbook describes the current startup sequence correctly
- worker monitors listed in docs match the live runtime

Priority:
- High

### Issue 2.3
Title:
- Model calibration access as an explicit contract override instead of hidden config drift

Scope:
- target:
  - `src/config/capabilities.ts`
  - `src/config/participantConsole.ts`
  - `config/participant-console.json`
- keep runtime configurability, but make the override path explicit in code/docs

Acceptance criteria:
- calibration is clearly represented as a documented exception to the static capability catalog
- route protection, runtime config, and docs all describe the same rule model

Priority:
- Medium

## Epic 3: Harden Runtime Bootstrap And Worker Operability
Goal:
- remove ambiguous startup side effects
- make worker health meaningful for operations

### Issue 3.1
Title:
- Move bootstrap seed out of normal application startup path

Scope:
- target `scripts/runtime/startup.mjs`
- keep non-production seeding possible, but make it an explicit deploy/init step or dedicated command

Acceptance criteria:
- normal runtime startup does not import bootstrap seed logic
- seeding remains available through an explicit operator/deploy path
- docs describe the new ownership clearly

Priority:
- Medium

### Issue 3.2
Title:
- Expose unified worker health for all active monitors

Scope:
- target:
  - `src/index.ts`
  - `src/modules/assessment/AssessmentWorker.ts`
  - monitor classes that currently have no public status contract

Acceptance criteria:
- worker heartbeat includes structured status for:
  - assessment worker
  - appeal SLA monitor
  - pseudonymization monitor
  - audit retention monitor
- status includes last successful cycle or equivalent useful signal

Priority:
- Medium

### Issue 3.3
Title:
- Define operational acceptance checks for web-role and worker-role startup

Scope:
- add lightweight verification guidance and/or automated coverage around:
  - `PROCESS_ROLE=web`
  - `PROCESS_ROLE=worker`
  - `PROCESS_ROLE=all`

Acceptance criteria:
- startup expectations are explicit for each role
- health/runbook guidance matches actual runtime outputs
- future runtime changes have a clear regression safety net

Priority:
- Medium

## Priority Order
1. Epic 1
- this carries the largest architecture payoff
- it directly addresses the strongest remaining design hotspots

2. Epic 2
- this removes the most visible drift and prevents future contract confusion

3. Epic 3
- this is important, but less urgent than the module-boundary work unless operations pain increases

## Suggested Implementation Rules
- every refactor issue should ship with targeted tests, not a separate testing workstream
- avoid reopening broad closed epics unless a current file proves the gap still exists
- prefer behavior-preserving cuts with smaller PRs over one large architecture branch
- treat DTO/view-model ownership as a real boundary, not just a naming exercise

## Definition Of Done For This Backlog
This gap-closure wave is complete when:
- core submission/review/appeal/assessment flows have explicit command boundaries
- read-model APIs no longer depend on raw repository return types
- shared repositories are smaller and more intentional
- docs no longer manually compete with capability/runtime truth
- bootstrap seed is no longer part of normal app startup
- worker health exposes meaningful status beyond simple process liveness
