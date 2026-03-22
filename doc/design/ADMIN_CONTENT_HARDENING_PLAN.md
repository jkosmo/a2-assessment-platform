# Admin Content Hardening Plan

## Scope
This note captures the remaining design work for the admin-content hotspot after the initial move into `src/modules/adminContent/*`.

It is the design basis for:
- `#232` route slimming
- `#237` publish transactionality
- one follow-up issue for service decomposition

This is not a feature redesign.
It is a behavior-preserving hardening plan.

## Current State

### What is already improved
- route-level schemas live in `src/modules/adminContent/adminContentSchemas.ts`
- request-to-command mapping lives in `src/modules/adminContent/adminContentMapper.ts`
- feature ownership exists under `src/modules/adminContent/*`
- routes already call module APIs instead of top-level horizontal services

### What still hurts
- `src/routes/adminContent.ts` still repeats request validation and ad hoc `400` response shaping
- `src/modules/adminContent/adminContentService.ts` is still a large mixed-responsibility file

Current service responsibilities are mixed together:
- command operations:
  - `createModule`
  - `deleteModule`
  - `createRubricVersion`
  - `createPromptTemplateVersion`
  - `createMcqSetVersion`
  - `createModuleVersion`
  - `createBenchmarkExampleVersion`
  - `publishModuleVersion`
  - `publishModuleVersionWithThresholds`
- read/bundle assembly:
  - `listAdminModules`
  - `getModuleContentBundle`
- internal content decoding and shaping:
  - localized text decoding
  - JSON parsing
  - MCQ bundle projection

This means the module is feature-owned, but not yet feature-shaped internally.

## Design Goal
Turn admin-content into a clearer module with three internal responsibilities:

1. Command operations
- create, delete, publish, and versioning mutations

2. Read-model assembly
- list and export/bundle queries shaped for the admin workspace

3. Shared admin-content mappers/decoders
- localized text decode helpers
- safe JSON decode helpers
- bundle projection helpers

The route should become a thin adapter over command/query entry points.

## Target Structure

Recommended target shape:

```text
src/modules/adminContent/
  index.ts
  adminContentSchemas.ts
  adminContentMapper.ts
  adminContentRepository.ts
  commands/
    createModule.ts
    deleteModule.ts
    createRubricVersion.ts
    createPromptTemplateVersion.ts
    createMcqSetVersion.ts
    createModuleVersion.ts
    createBenchmarkExampleVersion.ts
    publishModuleVersion.ts
    publishModuleVersionWithThresholds.ts
  queries/
    listAdminModules.ts
    getModuleContentBundle.ts
  projections/
    contentBundleProjection.ts
    localizedContentDecoders.ts
```

This can be implemented incrementally.
The important boundary is not the exact folder names, but the split between mutation logic and read-model shaping.

## Design Decisions

### 1. Keep schemas and request mappers close to the route
`adminContentSchemas.ts` and `adminContentMapper.ts` are already useful extractions.

Rule:
- keep request validation and HTTP-to-command mapping separate from command execution
- do not move Zod schemas into the service/command files

### 2. Split command and query logic in the service layer
`listAdminModules` and `getModuleContentBundle` should not live in the same implementation file as publish and create commands.

Rule:
- query assembly belongs with query/projection helpers
- write orchestration belongs with commands

### 3. Move decode/projection helpers out of the service entry file
These helpers currently expand the service file without clarifying feature behavior:
- `decodeLocalizedText`
- `safeParseJson`
- `decodeMcqOption`
- `mapMcqSetVersion`

Rule:
- move them into a projection/decoder helper file used by query paths

### 4. Standardize admin-content route error handling around `AppError`
The admin-content route still returns many direct `400` responses for service failures.

Rule:
- keep direct `400` responses for request validation failures
- convert expected domain failures to `AppError`
- prefer `next(error)` for command/query execution failures

This keeps the route consistent with the rest of the API without forcing a full generic route framework.

### 5. Publish transactionality is part of the same hardening track
`publishModuleVersionWithThresholds` already wraps create + publish together using one outer transaction.
The remaining issue is making `publishModuleVersion` reusable with an optional transaction client so the publish path has one consistent write contract.

Rule:
- do not solve `#237` in isolation from the command split
- place publish logic in the command area and make transaction ownership explicit there

## Recommended Slices

### Slice 1: route cleanup
Goal:
- finish `#232`

Changes:
- extract repeated route helpers for:
  - validation response
  - unauthorized response
  - command error forwarding
- route reads primarily as endpoint-to-command wiring

### Slice 2: split read-model assembly from commands
Goal:
- create separate query/projection files

Changes:
- move `listAdminModules`
- move `getModuleContentBundle`
- move localized decode and MCQ projection helpers with them

Expected outcome:
- `adminContentService.ts` shrinks materially or disappears into focused files

### Slice 3: split command files
Goal:
- isolate creation/publish/delete responsibilities

Changes:
- move command functions into focused command files
- centralize common version-number and dependency-validation helpers

### Slice 4: publish transactionality
Goal:
- close `#237`

Changes:
- allow `publishModuleVersion` to run either:
  - standalone with its own transaction
  - inside an outer tx
- make the transaction contract explicit at the command layer

### Slice 5: tests and route consistency cleanup
Goal:
- preserve behavior while reducing structural risk

Changes:
- add or update unit tests for the split command/query files
- keep existing integration behavior unchanged

## Non-Goals
- redesigning the admin-content UX
- changing the admin-content API surface
- changing module publication semantics
- folding calibration into admin-content

## Success Criteria
This hardening track is complete when:
- `src/routes/adminContent.ts` is a clear transport adapter
- read-model assembly no longer lives in the same file as command orchestration
- publish transactionality is explicit and reusable
- admin-content internals are easier to navigate by responsibility

## References
- `#232` Slim admin-content route by extracting validation, mapping, and serialization
- `#237` Refactor publishModuleVersion to support optional tx parameter
- `doc/design/GAP_ANALYSIS_DELTA_2026-03-21.md`
