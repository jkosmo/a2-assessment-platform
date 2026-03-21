# Assessment Module Extraction Plan

## Scope
This note defines the implementation-oriented design for `#208`.

It applies the boundary contract from `doc/design/INTERNAL_MODULE_BOUNDARY_CONTRACTS.md` to the current assessment hotspot and turns it into a low-risk extraction sequence.

This is still design work.
It does not require functional behavior changes.

## Goal
Move the assessment hotspot toward an explicit `src/modules/assessment/` module without changing runtime behavior.

The extraction should:
- make assessment ownership obvious from the file tree
- reduce direct coupling between routes, worker bootstrap, scripts, and individual assessment internals
- preserve current public behavior for submissions, MCQ, assessment jobs, and worker execution

## Current Assessment Hotspot

The assessment area currently spans:
- transport: `src/routes/assessments.ts`
- worker bootstrap: `src/index.ts`
- scripts: `src/scripts/runAssessmentBatchRegression.ts`
- services:
  - `src/services/assessmentJobService.ts`
  - `src/services/AssessmentJobRunner.ts`
  - `src/services/AssessmentWorker.ts`
  - `src/services/AssessmentInputFactory.ts`
  - `src/services/AssessmentEvaluator.ts`
  - `src/services/AssessmentDecisionApplicationService.ts`
  - `src/services/decisionService.ts`
  - `src/services/llmAssessmentService.ts`
  - `src/services/assessmentDecisionSignals.ts`
  - `src/services/assessmentRedFlagPolicy.ts`
  - `src/services/mcqService.ts`
  - `src/services/secondaryAssessmentService.ts`
- repositories:
  - `src/repositories/assessmentJobRepository.ts`
  - `src/repositories/decisionRepository.ts`
  - `src/repositories/mcqRepository.ts`

The area is already internally decomposed better than before, but the ownership boundary is still horizontal rather than feature-first.

## Extraction Decision
Create `src/modules/assessment/` as the owning feature module for:
- assessment job queueing and execution
- MCQ lifecycle tied to assessment readiness
- LLM evaluation
- assessment decision calculation and write orchestration
- worker runtime class for the assessment queue

Keep these outside the module:
- route registration in `src/routes/assessments.ts` for now
- top-level app/process bootstrap in `src/app.ts` and `src/index.ts`
- shared platform concerns such as env, Prisma runtime, middleware, and observability adapters

## Target Structure

Target structure for the first extraction wave:

```text
src/modules/assessment/
  index.ts
  api/
    enqueueAssessmentJob.ts
    processSubmissionJobNow.ts
    processNextAssessmentJob.ts
    startMcqAttempt.ts
    submitMcqAttempt.ts
    getAssessmentView.ts
  application/
    AssessmentJobRunner.ts
    AssessmentJobService.ts
    AssessmentDecisionApplicationService.ts
    AssessmentWorker.ts
    AssessmentInputFactory.ts
    AssessmentEvaluator.ts
    decisionService.ts
    secondaryAssessmentService.ts
  domain/
    assessmentDecisionSignals.ts
    assessmentRedFlagPolicy.ts
  infrastructure/
    assessmentJobRepository.ts
    decisionRepository.ts
    mcqRepository.ts
  integrations/
    llmAssessmentService.ts
```

This structure is intentionally pragmatic:
- `api/` is the module public surface
- `application/` owns orchestration
- `domain/` owns pure assessment rules and signal logic
- `infrastructure/` owns feature-specific repositories
- `integrations/` owns Azure OpenAI/stub interaction

If we want a flatter shape later, we can simplify after the extraction is stable.
The important part now is explicit ownership and import direction.

## Public Module API

The first public `assessment` API should expose only the entry points already used outside the hotspot:

```ts
enqueueAssessmentJob
processSubmissionJobNow
processNextAssessmentJob
startMcqAttempt
submitMcqAttempt
getAssessmentView
AssessmentWorker
resolveAssessmentDecision
evaluatePracticalWithLlm
```

Rationale:
- routes need queueing, sync processing, MCQ, and assessment read access
- `src/index.ts` needs `AssessmentWorker`
- batch regression scripts need `resolveAssessmentDecision` and `evaluatePracticalWithLlm`

Everything else should be considered module-internal unless deliberately exported later.

## Recommended Mapping

### Module public API entry points
Create:
- `src/modules/assessment/index.ts`
- `src/modules/assessment/api/*`

Map these current imports behind the new public API:
- `src/routes/assessments.ts`
- `src/routes/modules.ts`
- `src/index.ts`
- `src/scripts/runAssessmentBatchRegression.ts`

### Application layer
Move:
- `src/services/assessmentJobService.ts`
- `src/services/AssessmentJobRunner.ts`
- `src/services/AssessmentWorker.ts`
- `src/services/AssessmentInputFactory.ts`
- `src/services/AssessmentEvaluator.ts`
- `src/services/AssessmentDecisionApplicationService.ts`
- `src/services/decisionService.ts`
- `src/services/secondaryAssessmentService.ts`

### Domain layer
Move:
- `src/services/assessmentDecisionSignals.ts`
- `src/services/assessmentRedFlagPolicy.ts`

### Integration layer
Move:
- `src/services/llmAssessmentService.ts`

### Infrastructure layer
Move:
- `src/repositories/assessmentJobRepository.ts`
- `src/repositories/decisionRepository.ts`
- `src/repositories/mcqRepository.ts`

### Keep outside for now
Keep these in current locations in the first wave:
- `src/routes/assessments.ts`
- `src/routes/modules.ts`
- `src/index.ts`
- `src/app.ts`

Reason:
- the goal of `#208` is module extraction, not route/bootstrap redesign

## Compatibility Strategy

Use a compatibility-first extraction.

### Phase 1: create new module home
Add `src/modules/assessment/*` and move or copy implementation there.

### Phase 2: preserve old import paths temporarily
Leave thin forwarding files in the old locations where needed, for example:

```ts
export {
  enqueueAssessmentJob,
  processAssessmentJobsNow,
  processSubmissionJobNow,
  processNextAssessmentJob as processNextJob,
} from "../modules/assessment/index.js";
```

This keeps the extraction reviewable and avoids a single huge import-churn patch.

### Phase 3: move external callers to module entry point
Switch external callers one by one:
- routes
- worker bootstrap
- scripts
- tests

### Phase 4: remove compatibility shims
Only after external callers are stable and tests are green.

## Specific Boundary Decisions

### MCQ stays in `assessment`
Even though MCQ could be seen as its own area, the current code treats MCQ completion as a prerequisite for the assessment queue and decision flow.

For now:
- keep `mcqService` inside `assessment`
- do not split it into a separate module during `#208`

This avoids creating a second boundary before the first one is stable.

### `submissionService` stays outside
`assessment` may consume submission read models, but it should not own participant submission CRUD.

For now:
- keep submission ownership in `submissions`
- let routes continue to fetch owned submission checks through `submissionService`

Later improvement:
- replace direct route composition with a clearer `submissions` public API

### Audit, notifications, and recertification stay shared for now
Current assessment code depends on:
- `recordAuditEvent`
- `notifyAssessmentResult`
- `upsertRecertificationStatusFromDecision`

These should remain outside the assessment module in the first wave.

Reason:
- moving them now would broaden the extraction beyond the assessment hotspot
- they are cross-feature enough that they need a separate shared-or-feature ownership decision later

### Observability stays platform-level
Assessment may call observability adapters such as `logOperationalEvent`, but it must not own those adapters.

## Import Rules During Extraction

While `#208` is in progress:
- external callers should import from `src/modules/assessment/index.ts` where practical
- internal assessment files may import other assessment internals via module-relative paths
- no new feature should import `assessment` repositories directly
- no new route should import deep assessment internals if the module public API already exposes the use case

Treat these as boundary violations:
- importing `assessmentJobRepository` from another feature
- importing `decisionRepository` from another feature
- importing `AssessmentEvaluator` directly from a route or script once a public API exists

## Proposed Sequence

### Slice 1: public API shell
Add:
- `src/modules/assessment/index.ts`
- thin exported wrappers for queueing, MCQ, worker, and assessment view

No behavior changes.

### Slice 2: move orchestration internals
Move:
- `assessmentJobService`
- `AssessmentJobRunner`
- `AssessmentWorker`
- `AssessmentInputFactory`
- `AssessmentEvaluator`
- `AssessmentDecisionApplicationService`

Keep compatibility exports in old paths.

### Slice 3: move decision and MCQ logic
Move:
- `decisionService`
- `mcqService`
- `secondaryAssessmentService`
- `assessmentDecisionSignals`
- `assessmentRedFlagPolicy`
- `llmAssessmentService`

### Slice 4: move repositories
Move:
- `assessmentJobRepository`
- `decisionRepository`
- `mcqRepository`

This comes after the application layer so import churn stays easier to reason about.

### Slice 5: switch external callers
Update:
- `src/routes/assessments.ts`
- `src/routes/modules.ts`
- `src/index.ts`
- `src/scripts/runAssessmentBatchRegression.ts`
- relevant tests

### Slice 6: delete shims
Remove old service/repository forwarding files once callers are clean.

## Risks And Mitigations

### Risk: extraction turns into a repo-wide import storm
Mitigation:
- use compatibility shims first
- move callers in a later slice

### Risk: worker bootstrap breaks
Mitigation:
- keep `AssessmentWorker` public and preserve constructor behavior
- verify startup via existing app bootstrap tests and targeted worker tests

### Risk: scripts and tests depend on deep paths
Mitigation:
- export `resolveAssessmentDecision` and `evaluatePracticalWithLlm` from the module public API early
- update scripts/tests after the public API exists

### Risk: hidden coupling to review/appeal or reporting appears during move
Mitigation:
- treat those as explicit dependencies and document them
- do not solve `#209` inside `#208`

## Done Criteria
`#208` is complete when:
- assessment code has an explicit home under `src/modules/assessment/`
- routes, worker bootstrap, and scripts can depend on a stable module entry point
- feature-specific repositories are no longer living as generic top-level repositories
- compatibility shims are removed or intentionally left with a clear cleanup issue
- no functional behavior changes are introduced

## References
- `#171 EPIC: Feature-modular monolith`
- `#207 Define internal module boundary contracts`
- `#208 Migrate assessment hotspot to src/modules/assessment`
- `doc/design/INTERNAL_MODULE_BOUNDARY_CONTRACTS.md`
