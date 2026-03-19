# Local Integration Test Suite Design

## Context

The current workflow spends too much time in the loop:

1. make a small patch
2. push
3. wait for CI/CD
4. wait for staging deploy
5. enter test data manually
6. wait for LLM/runtime behavior
7. discover one more gap

This is too slow for bug tracking and too dependent on staging for behavior that should be testable locally.

The platform already has useful unit tests and some integration coverage, but the test strategy still has two gaps:
- important workflow behavior is still first discovered through manual staging verification
- repeated manual tests are not systematically converted into local automated integration coverage

This design proposes a dedicated local integration test suite that sits between unit tests and staging verification.

## Goal

Create a local integration suite that:
- runs against the real Express app and local test database
- covers the highest-value participant/reviewer/admin workflows
- reduces the number of staging deploys needed to find regressions
- turns repeated manual verification scripts into local automated coverage over time
- keeps live-LMM variability separate from deterministic app-level integration tests

## Non-Goals

This suite is not intended to:
- replace live staging verification for browser layout/wording
- replace live Azure OpenAI batch regression
- replace production smoke tests
- prove exact model behavior for nondeterministic prompts

## Design Principles

- Local first: prefer catching regressions before deploy.
- Deterministic by default: use local DB + app + stubbed/provider-controlled responses.
- Workflow-oriented: test end-to-end user journeys through API boundaries, not only isolated helpers.
- Canonical test cases: use stable case IDs and clear expected outcomes.
- Incremental growth: every repeated manual testcase should be evaluated for inclusion.

## Proposed Structure

### 1. Suite split

Keep three layers:

1. Unit tests
   - small, pure logic
   - fast
   - current role preserved

2. Local integration tests
   - real app routes
   - real local test DB
   - deterministic workflow coverage
   - new priority layer

3. Live batch regression
   - real Azure OpenAI
   - nondeterministic
   - manual/pre-deploy gate only

### 2. Local integration test categories

The suite should grow around independent testcase categories:

- `TC-PART-*` participant flows
- `TC-REV-*` manual-review flows
- `TC-APP-*` appeal flows
- `TC-ADM-*` admin-content flows
- `TC-POL-*` assessment policy flows

Each automated integration test should map cleanly to one or more manual testcase IDs.

### 3. Test harness approach

Use the existing stack:
- Vitest
- Supertest
- local PostgreSQL test DB via `.env.test`
- existing `pretest` reset/migrate/seed flow

Prefer tests that:
- call HTTP routes through `app`
- use real repositories/services below the route layer
- assert final persisted state where needed

Avoid:
- broad mocking of the workflow under test
- recreating implementation logic inside assertions

## Proposed Scope

### Phase 1: Highest-value regression pack

Add or consolidate local integration coverage for:

1. Participant submission lifecycle
   - create submission
   - complete MCQ
   - run assessment
   - fetch result/history

2. Assessment traffic-light policy
   - clear red -> automatic fail
   - clear yellow -> under review
   - clear green -> pass
   - insufficient evidence should not become manual review unless a true safety/compliance trigger exists

3. Manual review lifecycle
   - queue visibility
   - claim
   - override/finalize sequencing

4. Appeal lifecycle
   - create appeal
   - claim
   - resolve

5. Admin content core flow
   - create/import draft
   - save draft version
   - publish
   - export/readback

### Phase 2: UI-contract integration coverage

Add API/config/HTML-contract checks for:
- workspace config
- translation presence
- required admin-content controls
- participant result shape

This is not pixel/UI automation, but it prevents many browser regressions before staging.

## Relationship to Live Batch LLM Regression

The local integration suite and the live batch suite solve different problems:

- Local integration suite:
  - deterministic
  - fast
  - should run often
  - verifies app behavior and policy wiring

- Live batch suite:
  - nondeterministic
  - slower and token-consuming
  - should run only when touching LLM contract/policy behavior
  - verifies model-response variability against canonical cases

Rule:
- a policy change is not ready for staging until both:
  - local integration tests are green
  - the live batch suite is acceptable for the affected traffic-light cases

## Testcase Mapping Model

Manual test scripts should be written in the same structure as the integration suite:

- `TC1` / `TC-PART-001`
- `TC2` / `TC-ADM-002`

For each manual testcase, record:
- should automate now
- should automate later
- should remain manual only

Examples:

- `TC-POL-RED-001`
  - Minimal incomplete submission should end in automatic fail
  - automation target: yes

- `TC-ADM-IMPORT-001`
  - Import draft JSON should populate editor correctly
  - automation target: yes

- `TC-UI-COPY-001`
  - Preview label wording looks right in browser
  - automation target: probably no, manual only

## Proposed Repository Additions

### New test files or grouping

Suggested additions:
- `test/integration/participant-flow.integration.test.ts`
- `test/integration/assessment-policy.integration.test.ts`
- `test/integration/manual-review.integration.test.ts`
- `test/integration/appeal-flow.integration.test.ts`
- `test/integration/admin-content.integration.test.ts`

Alternative:
- keep current filenames, but group them explicitly under one integration suite command

### New npm scripts

Suggested scripts:
- `npm run test:integration:core`
- `npm run test:integration:policy`
- `npm run test:integration:admin`

These should allow faster, focused local reruns during bug work instead of full-suite reruns every time.

## Rollout Plan

### Slice 1

- Establish the suite definition and naming
- Create a dedicated issue
- Map current manual/staging regressions to testcase IDs

### Slice 2

- Add the first deterministic policy integration pack
- Ensure red/yellow/green canonical cases are runnable locally

Status:
- Implemented via [assessment-policy.integration.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/assessment-policy.integration.test.ts)
- Current focused command:
  - `npm run test:integration:policy`

### Slice 3

- Add admin-content and manual-review workflows
- Use bug-fix work to opportunistically convert manual testcases into local integration coverage

Status:
- Implemented through focused local commands using existing end-to-end integration tests:
  - `npm run test:integration:review`
  - `npm run test:integration:admin`
- Existing review/appeal tests were stabilized to reuse the shared participant flow helper for seed-module lookup.

### Slice 4

- Update CI to expose focused integration commands clearly
- Keep live batch regression as explicit pre-deploy gate for LLM/policy changes

Current local commands:
- `npm run test:integration:core`
- `npm run test:integration:policy`
- `npm run test:integration:review`
- `npm run test:integration:admin`
- `npm run test:integration:local`
- `npm run test:integration:contracts`

Related testcase map:
- [LOCAL_TESTCASE_MAP.md](C:/Users/JoakimKosmo/a2-assessment-platform/doc/LOCAL_TESTCASE_MAP.md)

## Risks and Trade-Offs

### Risk: suite becomes slow

Mitigation:
- keep focused scripts
- separate core and extended integration packs

### Risk: tests overfit current implementation

Mitigation:
- write tests against route contracts and persisted outcomes
- avoid asserting incidental internals

### Risk: confusion between local integration and live model validation

Mitigation:
- keep separate commands and documentation
- clearly document that live batch regression is still required for model-sensitive changes

## Recommendation

Adopt this as a formal test-strategy improvement issue and implement in slices.

The first implementation slice should focus on deterministic local policy and workflow integration coverage, because that is where current debugging time is being lost.
