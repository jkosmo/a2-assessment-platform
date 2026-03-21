# Internal Module Boundary Contracts

## Scope
This note defines the target internal module boundaries for the feature-modular monolith work tracked in `#171`, with `#207` as the decision-record issue.

It is intentionally a design contract, not an implementation diff.
The goal is to make later extraction work predictable:
- `#208` assessment migration
- `#209` review and appeal migration
- `#210` reporting migration
- later admin-content, calibration, and access-control cleanup

This note assumes the current repo still uses the horizontal `routes/`, `services/`, and `repositories/` layout.
The contract below defines how those pieces should group into feature modules over time.

## Problem
The current codebase is healthier than before, but the main business flows are still spread across shared horizontal layers.

That creates three recurring problems:
- feature ownership is implicit rather than explicit
- cross-feature imports can grow accidentally because everything lives at the same level
- route, service, and repository cleanup can happen locally without reinforcing a stable module model

We do not need a large architecture rewrite first.
We do need a clear contract for where code should move and what dependencies remain allowed once it moves.

## Decision Summary
Adopt a feature-modular monolith target under `src/modules/`, with:
- thin HTTP routes as adapters
- feature-owned application services and repositories
- a small shared kernel for stable cross-cutting domain primitives
- a platform layer for runtime, auth middleware, Prisma, observability, and process bootstrap

The main rule is:
- business logic should belong to a feature module
- cross-feature access should happen through explicit public module APIs
- repositories stay module-private unless a module intentionally exports a read facade

## Target Top-Level Structure

Target shape over time:

```text
src/
  app.ts
  index.ts
  modules/
    access/
    module-catalog/
    submissions/
    assessment/
    review/
    appeal/
    reporting/
    admin-content/
    calibration/
  shared/
    domain/
    errors/
    i18n/
    utils/
  platform/
    auth/
    db/
    middleware/
    observability/
    process/
    config/
```

This structure is a target, not a prerequisite.
Migration can happen module by module while existing top-level folders still exist.

## Module Contracts

### `access`
Owns:
- application-facing authorization policies beyond raw middleware wiring
- role assignment lookup and access-rule evaluation
- identity-driven org/user sync support

Candidate current files:
- `src/auth/*`
- parts of `src/services/orgSyncService.ts`
- `src/repositories/userRepository.ts`

Public responsibilities:
- expose authorization checks that are more specific than route-level `requireAnyRole`
- expose user/role lookup helpers needed by other modules

Must not own:
- business decisions for review, appeal, assessment, or reporting

### `module-catalog`
Owns:
- participant-facing module discovery
- active version lookup
- completed module listing policy
- module read models needed by participant and operator flows

Candidate current files:
- `src/routes/modules.ts` read endpoints
- `src/services/moduleService.ts`
- `src/services/moduleCompletionPolicyService.ts`
- `src/repositories/moduleRepository.ts`

Public responsibilities:
- list and fetch modules/version metadata
- provide localized module read models
- provide completion-aware availability rules

Must not own:
- submission creation
- assessment execution
- content authoring and publication internals

### `submissions`
Owns:
- participant submission creation
- participant-owned submission history and result views
- attachment intake rules

Candidate current files:
- `src/routes/submissions.ts`
- `src/services/submissionService.ts`
- `src/repositories/submissionRepository.ts`

Public responsibilities:
- create and fetch participant-owned submissions
- expose submission read models required by assessment, review, and appeal

Must not own:
- assessment job execution
- review decisions
- appeal resolution

### `assessment`
Owns:
- assessment job orchestration
- LLM evaluation
- MCQ attempt lifecycle
- machine decision calculation and persistence
- review-triggering and assessment-related notifications

Candidate current files:
- `src/routes/assessments.ts`
- `src/services/AssessmentInputFactory.ts`
- `src/services/AssessmentEvaluator.ts`
- `src/services/AssessmentDecisionApplicationService.ts`
- `src/services/AssessmentJobRunner.ts`
- `src/services/assessmentJobService.ts`
- `src/services/AssessmentWorker.ts`
- `src/services/llmAssessmentService.ts`
- `src/services/decisionService.ts`
- `src/services/mcqService.ts`
- `src/services/secondaryAssessmentService.ts`
- `src/services/assessmentDecisionSignals.ts`
- `src/services/assessmentRedFlagPolicy.ts`
- `src/repositories/assessmentJobRepository.ts`
- `src/repositories/decisionRepository.ts`
- `src/repositories/mcqRepository.ts`

Public responsibilities:
- accept assessment requests from submissions
- publish assessment outcomes and review requirements
- expose assessment read models required by review, appeal, reporting, and calibration

Must not own:
- manual review queue management
- appeal queue management
- authoring/publishing of module content

### `review`
Owns:
- manual review queue
- review claim/finalize flows
- reviewer workspace read models

Candidate current files:
- `src/routes/reviews.ts`
- `src/services/manualReviewService.ts`
- `src/repositories/manualReviewRepository.ts`

Public responsibilities:
- list/claim/finalize manual reviews
- expose review workspace state to routes and reporting

Must not own:
- participant appeal creation
- appeal SLA monitoring
- raw assessment execution

### `appeal`
Owns:
- appeal creation
- appeal queue claim/resolve flows
- appeal SLA monitoring and operational signals

Candidate current files:
- `src/routes/appeals.ts`
- appeal creation endpoint currently in `src/routes/submissions.ts`
- `src/services/appealService.ts`
- `src/services/appealSla.ts`
- `src/services/AppealSlaMonitor.ts`
- `src/services/appealSlaMonitorService.ts`
- `src/repositories/appealRepository.ts`

Public responsibilities:
- create participant appeals
- manage handler queue lifecycle
- expose appeal status and SLA information

Must not own:
- module authoring
- report formatting
- direct calibration logic

### `reporting`
Owns:
- operational and governance reporting
- analytics read models
- exports such as CSV
- recertification status reporting and reminder scheduling

Candidate current files:
- `src/routes/reports.ts`
- `src/services/reportingService.ts`
- `src/services/reporting/*`
- `src/services/recertificationService.ts`
- `src/repositories/reportingRepository.ts`
- `src/repositories/certificationRepository.ts`
- parts of `src/repositories/auditRepository.ts` when used only for reporting reads

Public responsibilities:
- expose report/query/export use cases
- consume read models from other modules without owning their write logic

Must not own:
- primary transactional business writes in assessment, review, appeal, or admin-content

### `admin-content`
Owns:
- authoring and publication of modules, module versions, rubrics, prompts, benchmark examples, MCQ sets, and assessment policy
- content bundle export

Candidate current files:
- `src/routes/adminContent.ts`
- `src/services/adminContentService.ts`
- `src/repositories/adminContentRepository.ts`
- feature-specific codecs now under `src/codecs/*` if they are authoring-specific

Public responsibilities:
- publish content snapshots and content read bundles
- expose narrow publication APIs consumed by other modules

Must not own:
- participant submission state
- review queue lifecycle
- report assembly

### `calibration`
Owns:
- calibration workspace query logic
- calibration-specific filters, signals, and threshold analysis

Candidate current files:
- `src/routes/calibration.ts`
- `src/services/calibrationWorkspaceService.ts`
- `src/repositories/calibrationRepository.ts`

Public responsibilities:
- expose calibration workspace snapshots
- consume assessment signals and content publication APIs as explicit dependencies

Must not own:
- low-level content authoring internals
- assessment job execution

## Shared And Platform Boundaries

### `shared/domain`
Allowed only for stable, low-churn concepts used by multiple feature modules.

Examples:
- decision lineage support
- audit-writing abstractions
- shared domain enums/value objects when they are not generated from Prisma
- localized content helpers that are truly cross-feature

Candidate current files:
- `src/services/decisionLineageService.ts`
- parts of `src/services/auditService.ts`
- selected codecs and type helpers

Rule:
- do not move feature logic into `shared` just to avoid choosing an owner

### `shared/errors`
Owns:
- `AppError`
- common validation and domain-error base types

### `platform/*`
Owns infrastructure and runtime plumbing:
- Express bootstrap
- auth token validation
- middleware
- Prisma client/runtime bootstrap
- observability wiring
- process lifecycle and worker bootstrap
- environment/config loading

Candidate current files:
- `src/config/*`
- `src/db/*`
- `src/middleware/*`
- `src/observability/*`
- `src/process/*`

Rule:
- platform code may depend on no feature module internals
- features may depend on platform adapters, but platform must not contain feature business rules

## Dependency Rules

### Allowed import direction
Allowed direction is:

```text
routes/app -> feature public APIs -> feature internals
features -> shared
features -> platform adapters
reporting/calibration -> feature read APIs
platform -> no feature internals
```

### Public API rule
Each feature module should eventually expose a small public API, for example:

```text
src/modules/assessment/index.ts
src/modules/review/index.ts
src/modules/appeal/index.ts
```

Routes and other features should import from those entry points, not from deep internal files.

### Repository rule
Repositories are private to their owning module by default.

Cross-feature data access should happen through:
- a feature-level query function
- a read facade
- or a deliberately shared domain abstraction

Direct imports from one feature into another feature's repository should be treated as a boundary violation.

### Route rule
Routes remain transport adapters.
They may:
- validate input
- read auth context
- call feature APIs
- map transport errors to HTTP responses

They should not:
- compose business workflows across multiple feature services
- own serialization or localization logic that naturally belongs in a feature response model
- reach into repositories

### Cross-feature write rule
A feature may trigger another feature's behavior only through that feature's public API.

Examples:
- `submissions` may request an assessment start through `assessment`
- `assessment` may request review-case creation through `review`
- participant appeal creation should move behind the `appeal` module public API even if the route still lives under `/submissions/:id/appeals`
- `calibration` may call a narrow publication API from `admin-content`, but should not import authoring internals

### Reporting rule
`reporting` is allowed to aggregate read models across modules, but should stay read-oriented.
It should not become a backdoor write orchestrator for the rest of the system.

## Recommended Dependency Graph

Recommended business-module dependency posture:

```text
access
  ^ used by all routes and selected feature policies

module-catalog <------ admin-content
       ^                    ^
       |                    |
submissions -----------> assessment -----> review -----> appeal
       ^                    ^                ^             ^
       |                    |                |             |
       +--------------------+----------------+-------------+
                            |
                        reporting
                            ^
                            |
                       calibration
```

Interpretation:
- `admin-content` publishes the source-of-truth content model consumed by `module-catalog` and calibration publication paths
- `submissions` and `module-catalog` are upstream to `assessment`
- `review` depends on assessment outputs
- `appeal` depends on submission/review/decision state
- `reporting` reads across modules but should avoid becoming a dependency magnet for business writes
- `calibration` depends on assessment signals and a narrow content-publication contract

This graph is directional guidance, not a claim that every arrow must become a direct import.
Where possible, prefer narrow public APIs and read-model contracts over broad service-to-service imports.

## Mapping Current Hotspots To The Target Model

### Current `adminContent` hotspot
Current issue:
- `src/routes/adminContent.ts` owns too much validation, mapping, and branching

Boundary implication:
- `admin-content` should own authoring request/response DTO mapping internally
- the route should become a thin adapter over `admin-content` public APIs

### Current review/appeal overlap
Current issue:
- review and appeal already share decision-lineage behavior, but still duplicate some queue/status patterns

Boundary implication:
- keep `review` and `appeal` as separate feature modules
- allow them to share stable domain primitives through `shared/domain`
- do not collapse them into one module just because they both operate on post-assessment decisions

### Current calibration to admin-content coupling
Current issue:
- calibration currently reaches into admin-content publication behavior

Boundary implication:
- keep calibration separate
- expose a narrow admin-content publication API that calibration can call
- avoid calibration importing admin-content internals directly

### Current reporting sprawl
Current issue:
- reporting already behaves like a facade, but still reads across many concepts

Boundary implication:
- let `reporting` depend on read contracts from other modules
- do not let other modules depend on reporting for core business workflows

## Migration Rules

### Phase 1: Boundary-first extraction
Before moving directories:
- agree this note as the contract
- avoid introducing new cross-feature deep imports in the current layout
- prefer new helper extractions that already match future feature ownership

### Phase 2: Extract the hottest modules first
Recommended order:
1. `assessment` via `#208`
2. `review` and `appeal` via `#209`
3. `reporting` via `#210`
4. `admin-content`
5. `calibration`
6. `module-catalog` and `submissions`
7. `access` cleanup if still needed after the above

This order matches current hotspots and the fact that `assessment`, `review`, `appeal`, and `reporting` already have the clearest business seams.

### Phase 3: Shrink the old horizontal folders
Once feature extraction is mature:
- `src/services/`, `src/repositories/`, and `src/routes/` should mainly contain thin compatibility shims or disappear
- feature ownership should be discoverable from the file tree rather than tribal knowledge

## Non-Goals
This decision does not require:
- immediate movement of all files into `src/modules/`
- replacing Express route composition
- replacing Prisma
- introducing distributed services or separate deployable units
- merging review and appeal into one feature

## Success Criteria
`#207` is complete when:
- the target module list is explicit
- allowed dependency directions are explicit
- cross-feature repository access is declared out of bounds
- later migration issues can reference this note instead of redefining boundaries in each issue

## References
- `#171 EPIC: Feature-modular monolith`
- `#207 Define internal module boundary contracts`
- `#208 Migrate assessment hotspot to src/modules/assessment`
- `#209 Migrate review and appeal to feature modules`
- `#210 Migrate reporting to src/modules/reporting`
- `doc/design/POST_ARCHITECTURE_CONSOLIDATION_PLAN.md`
