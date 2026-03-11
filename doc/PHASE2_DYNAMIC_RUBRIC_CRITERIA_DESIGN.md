# Phase 2 Dynamic Rubric Criteria Design

## Context
Issue #69 asks for configurable rubric criteria so module owners can adapt evaluation criteria without code changes.

The current implementation is tightly coupled to five fixed criterion keys:
- `relevance_for_case`
- `quality_and_utility`
- `iteration_and_improvement`
- `human_quality_assurance`
- `responsible_use`

That coupling currently appears in:
- `src/services/llmAssessmentService.ts`
- participant result rendering in `public/participant.js`
- appeal/manual-review detail rendering
- admin-content default rubric JSON
- tests that assert fixed LLM response keys

## Problem Statement
Fixed criterion keys create unnecessary product friction:
- module owners cannot adapt scoring dimensions to curriculum-specific content
- LLM response validation and prompt contract are not module-driven
- UI result rendering assumes a static criterion list
- future reporting becomes harder if criterion evolution is handled ad hoc in code

The goal is to support up to 5 configurable criteria per module version while preserving:
- backward compatibility for existing modules and historical data
- stable auditability
- versioned content publication
- controlled rollout

## Refactor / Architecture Evaluation
Design work is required before implementation because this change affects:
- content model shape
- LLM contract generation and response validation
- decision logic and total-score calculation
- participant/manual-review/appeal UI rendering
- reporting comparability rules

Refactor work is also justified because criterion-specific logic is currently duplicated across backend and frontend.

## Options Considered

### 1. Hard switch to fully dynamic criteria everywhere
- Pros:
  - maximum flexibility immediately
  - no legacy branch after migration
- Cons:
  - highest blast radius
  - breaks existing tests, prompts, and result rendering at once
  - difficult rollback if production data mixes old/new shapes

### 2. New normalized database tables for criterion definitions
- Pros:
  - strongest explicit data model
  - easier relational querying later
- Cons:
  - unnecessary schema complexity for a versioned JSON-config domain
  - larger migration and repository impact
  - slower delivery for little immediate product value

### 3. Keep criterion definitions versioned inside `RubricVersion.criteriaJson` with a legacy adapter (chosen)
- Pros:
  - reuses existing versioned-content model
  - no new table required for MVP
  - allows additive rollout with legacy compatibility
  - keeps publish/audit behavior aligned with existing rubric versioning
- Cons:
  - reporting logic must normalize legacy and dynamic shapes
  - requires careful runtime validation of stored JSON

## Chosen Approach

### Criterion definition model
Continue storing rubric criteria inside `RubricVersion.criteriaJson`, but standardize on a richer JSON shape for new rubric versions:

```json
{
  "criteria": [
    {
      "key": "relevance_for_case",
      "label": {
        "en-GB": "Relevance for case",
        "nb": "Relevans for oppgaven",
        "nn": "Relevans for oppgåva"
      },
      "weight": 0.2,
      "scale": {
        "min": 0,
        "max": 4
      }
    }
  ]
}
```

Constraints:
- minimum 1 criterion
- maximum 5 criteria
- keys must be stable machine IDs (`[a-z0-9_]+`)
- keys must be unique within a rubric version
- `label.en-GB`, `label.nb`, and `label.nn` are required
- total weight should equal `1.0`
- scale is integer-based for MVP (`min = 0`, `max <= 4`)

### Legacy adapter
Existing rubric JSON values should remain valid.

Legacy shape example:

```json
{
  "relevance_for_case": { "weight": 0.2 },
  "quality_and_utility": { "weight": 0.2 }
}
```

Adapter behavior:
- detect legacy object-with-keyed-criteria shape
- map known legacy keys to existing localized labels
- default scale to `0..4`
- preserve weights from legacy payload
- expose one normalized runtime shape to the rest of the system

This avoids a destructive migration and keeps historical rubric versions readable.

### LLM contract strategy
The LLM contract should be generated from normalized criterion definitions at runtime.

Instead of hardcoding criterion keys in `llmAssessmentService`, build:
- prompt contract text listing current criterion keys and scales
- dynamic Zod schemas for:
  - `rubric_scores`
  - `criterion_rationales`
- computed total validation based on criterion definitions

MVP contract rules:
- one score per configured criterion key
- integer score within configured scale
- one rationale per configured criterion key
- `rubric_total` must equal the sum of raw criterion scores

Weighted score handling:
- keep `rubric_total` as raw total from the model response for traceability
- compute scaled practical score in service logic using configured weights and scales
- this preserves explainability and avoids pushing weighted arithmetic into the prompt

### UI rendering strategy
Participant, appeal-handler, and manual-review should render criteria dynamically from result payloads rather than from fixed translation keys only.

Display rules:
- if criterion label metadata exists, use localized display label
- otherwise fall back to localized legacy-key map
- otherwise fall back to raw criterion key

### Reporting strategy
Comparability must remain explicit.

Rules:
- existing aggregate score and pass/fail reporting can continue
- criterion-level trend reporting must treat criterion key set as part of the versioned rubric contract
- do not assume cross-module comparability for criterion labels with different keys
- later reporting slices should group by `(moduleId, rubricVersionId, criterionKey)`

## Data / API / Operational Impact

### Data impact
- no new database table required for MVP
- no destructive migration required
- existing `criteriaJson` storage remains the persistence boundary

### API impact
- admin-content rubric create/update validation must accept normalized criterion-definition payload
- module-version read paths should expose normalized criterion metadata where needed
- submission/result APIs should expose criterion labels or enough metadata to render dynamic criteria safely

### Operational impact
- no infra change required
- prompt drift risk increases if criterion definitions are malformed, so validation must be strict
- audit trail remains aligned with rubric version publication

## Rollout / Rollback

### Rollout
Use phased rollout behind config:
- `dynamicRubricCriteria.enabled`
- `dynamicRubricCriteria.maxCriteriaPerVersion`
- optional `dynamicRubricCriteria.allowedScaleMax`

Recommended slices:
1. Runtime normalization + legacy adapter + admin validation
2. Dynamic LLM contract and decision computation
3. Dynamic participant/reviewer/appeal rendering
4. Reporting hardening for criterion-level analytics

### Rollback
- disable dynamic criterion creation in config
- continue reading historical legacy/new rubric versions via adapter
- because storage stays in `criteriaJson`, rollback is additive and non-destructive

## Migration Plan
No immediate data migration is required.

Migration strategy:
1. Introduce normalized parser that accepts both legacy and new criterion JSON shapes.
2. Keep all existing rubric versions untouched.
3. Only newly created rubric versions use the richer criterion-definition shape.
4. Later, if desired, run a one-time backfill that rewrites legacy shapes into normalized JSON, but this should be optional and not part of MVP.

## Complexity and Delivery Slices

### Estimated complexity
- overall: High

### Why high
- touches LLM contract generation
- changes score computation path
- affects admin-content payload validation
- affects participant/reviewer/appeal rendering
- adds reporting semantics around criterion comparability

### Recommended delivery slices

#### Slice A: Model normalization and admin validation
- add normalized criterion-definition parser
- validate max 5 criteria, weights, localized labels, and scales
- adapt admin-content defaults and create-rubric validation

#### Slice B: Dynamic LLM contract and scoring
- generate prompt contract from normalized criteria
- replace fixed Zod schema with dynamic runtime schema
- compute weighted scaled score from normalized criteria
- preserve compatibility for stub and Azure OpenAI modes

#### Slice C: Dynamic UI rendering
- participant result summary uses normalized criterion labels
- appeal-handler/manual-review detail views render dynamic rationales cleanly
- preserve localized fallback behavior for legacy keys

#### Slice D: Reporting hardening
- document/report grouping strategy for dynamic criteria
- add explicit non-comparability guards where criterion sets differ

## Test Strategy

### Unit tests
- criterion-definition parser:
  - accepts legacy shape
  - accepts normalized shape
  - rejects duplicate keys
  - rejects more than 5 criteria
  - rejects missing localized labels
  - rejects invalid weights/scales
- dynamic LLM schema builder:
  - validates score/rationale keys exactly
  - rejects missing or extra keys
  - rejects totals that do not match score sum
- weighted score calculator:
  - handles mixed scales and weights deterministically

### Integration tests
- admin-content rubric version creation with normalized criteria payload
- module version publication using dynamic rubric criteria
- assessment flow end-to-end with dynamic criteria through result API
- manual-review and appeal resolution preserving criterion rationales

### UI / E2E checks
- participant result view renders dynamic criterion labels
- appeal-handler and manual-review detail views show dynamic rationales
- fallback still works for legacy fixed-criterion modules

## Documentation Impact
If implementation proceeds, update:
- `README.md`
- `doc/ARCHITECTURE.md`
- admin-content guidance for rubric JSON shape
- reporting semantics for criterion-level comparisons

## Recommended Next Implementation Issue
Create a scoped implementation slice for:
- normalized rubric criterion-definition schema
- admin-content validation/persistence support
- legacy adapter unit coverage

That keeps the first delivery additive and testable before touching the LLM contract and reporting layers.
