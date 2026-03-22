# Supersede Workflow Consistency Plan

## Scope
This note captures the remaining design work around retake-driven supersede behavior.

It is the design basis for the still-open retake/supersede work, especially the remaining gap behind `#238`.

This is not a new feature proposal from scratch.
The base behavior already exists in code.
The remaining work is to make that behavior more atomic, explicit, and easier to reason about.

## Current State

### What already exists
When a participant creates a new submission for the same module:
- `src/modules/submission/submissionService.ts` creates the new submission
- then calls:
  - `cancelSupersededReviews(...)`
  - `cancelSupersededAppeals(...)`

Review and appeal already support `SUPERSEDED` status:
- `src/modules/review/manualReviewService.ts`
- `src/modules/appeal/appealService.ts`

That means the basic retake cleanup feature is already implemented.

### What is still inconsistent
The retake supersede lifecycle is currently spread across separate module functions:
- submission creates the new submission
- review supersedes open manual reviews
- appeal supersedes open appeals
- audit events are written per entity in loops
- submission-status side effects are handled separately

This leaves three design concerns:

1. No explicit end-to-end transaction boundary
- the new submission and the supersede cleanup do not clearly live in one orchestrated transaction

2. Partial asymmetry between review and appeal cleanup
- review supersede currently also updates submission status on old reviews
- appeal supersede does not mirror the same overall workflow language

3. Audit semantics are entity-local rather than lifecycle-centered
- the system records individual supersede events
- but the retake lifecycle itself is not yet modeled as one explicit orchestration step

## Design Goal
Turn retake cleanup into one explicit workflow:

`create new submission` ->
`supersede eligible old review/appeal items` ->
`write consistent audit trail` ->
`leave in-review ownership untouched where ownership has already been taken, if that remains the chosen business rule`

The key outcome is not new user-facing functionality.
The key outcome is consistency and atomicity.

## Design Decisions

### 1. Treat supersede as a workflow owned by submission creation
The initiating action is a new submission.

Rule:
- the orchestration belongs at the submission boundary
- review and appeal modules should expose narrow supersede commands
- submission should own the higher-level "retake supersession" workflow

This keeps the trigger point explicit and avoids hidden side effects spread across unrelated callers.

### 2. Use one transaction boundary for the write phase
The durable state changes should happen inside one transaction where practical:
- create new submission
- supersede eligible reviews
- supersede eligible appeals
- apply any necessary status updates to affected previous submissions
- write audit events that are part of the durable workflow

Non-transactional side effects should remain outside:
- notifications
- operational logging that does not need rollback symmetry

### 3. Make supersede eligibility explicit
Current open question from the existing issue:
- should only `OPEN` items be superseded?
- or should `IN_REVIEW` also be superseded if no strong human ownership should survive a retake?

Current code supersedes both `OPEN` and `IN_REVIEW`.

Recommended design rule:
- preserve current behavior unless product/operations explicitly wants stricter ownership protection
- if behavior changes, treat that as a product rule change, not a refactor side effect

### 4. Normalize audit semantics
Current audit writes are per superseded entity.

Recommended audit shape:
- keep per-entity supersede audit events
- add one higher-level audit event or metadata convention for the retake orchestration:
  - initiating `submission_created`
  - `supersededBySubmissionId`
  - counts of superseded reviews and appeals

This makes the lifecycle easier to inspect later without removing entity-specific evidence.

### 5. Keep review and appeal module APIs narrow
Recommended public commands:
- `supersedeEligibleReviewsForRetake(...)`
- `supersedeEligibleAppealsForRetake(...)`

These should:
- accept a transaction client where needed
- return affected entity ids or counts
- avoid owning the whole retake orchestration themselves

## Recommended Shape

Suggested workflow split:

```text
submission/createSubmission
  -> create new submission
  -> call review.supersedeEligibleReviewsForRetake(...)
  -> call appeal.supersedeEligibleAppealsForRetake(...)
  -> write aggregated retake/supersede audit metadata
```

Suggested repository shape:
- repositories expose bulk supersede operations
- orchestration code decides how to sequence them
- audit event construction stays above raw repository operations

## Recommended Slices

### Slice 1: clarify issue scope
Goal:
- update `#238` so it reflects current reality

Change:
- note that the base feature exists
- redefine the remaining work as atomicity, audit semantics, and workflow consistency

### Slice 2: extract retake supersede orchestration
Goal:
- make the workflow explicit at the submission boundary

Change:
- create a focused helper/service for retake supersession orchestration
- keep `createSubmission` readable

### Slice 3: make durable writes transactional
Goal:
- move eligible state updates into one transaction boundary

Change:
- submission create + review supersede + appeal supersede happen under one write orchestration

### Slice 4: normalize audit metadata
Goal:
- improve traceability

Change:
- record consistent `supersededBySubmissionId` metadata
- include counts and affected workflow categories where useful

### Slice 5: add focused tests
Goal:
- prove the orchestration is safe

Tests should cover:
- new submission with no prior open items
- new submission superseding prior open review
- new submission superseding prior open appeal
- both review and appeal superseded together
- failure mid-orchestration rolls back durable writes

## Open Product Rule To Confirm During Implementation
This plan does not silently change the business rule for `IN_REVIEW`.

Implementation should explicitly confirm one of these:
- keep current behavior and supersede `OPEN` + `IN_REVIEW`
- narrow behavior to `OPEN` only

Until confirmed, preserve current behavior.

## Non-Goals
- redesigning manual-review or appeal ownership semantics globally
- changing participant-visible retake behavior beyond consistency
- merging review and appeal into one module

## Success Criteria
This work is complete when:
- retake cleanup is modeled as one explicit workflow
- durable state changes have a clear transaction boundary
- audit evidence is easier to read as one lifecycle
- review and appeal supersede behavior is intentionally defined rather than incidental

## References
- `#238` feat: cancel superseded manual reviews and appeals on retake
- `doc/design/GAP_ANALYSIS_DELTA_2026-03-21.md`
