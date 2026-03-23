# Capability And RBAC Cutover Plan

## Context
The repository already has a partial capability source of truth in [capabilities.ts](/c:/Users/JoakimKosmo/a2-assessment-platform/src/config/capabilities.ts).

Current `HEAD` state:
- API route role requirements are mostly centralized in `src/config/capabilities.ts`.
- `src/app.ts` already consumes `rolesFor(...)` for most API route mounts.
- Calibration remains intentionally runtime-configurable through `config/participant-console.json`.
- Workspace navigation and visibility still live in `config/participant-console.json`.
- Several workspace pages still carry fallback navigation arrays in frontend code.
- Some tests still assert capability and navigation contracts as duplicated literals rather than deriving them from one canonical source.

So the remaining problem is not "introduce capabilities from scratch". The remaining problem is to finish the cutover and remove the last competing contract definitions.

## Problem statement
Capability and access rules are still split across multiple places:
- `src/config/capabilities.ts`
- `config/participant-console.json`
- workspace frontend fallback arrays in `public/*.js`
- route/config contract tests
- documentation

That creates avoidable drift:
- backend route protection and workspace visibility can diverge
- tests can validate stale literals instead of the real contract
- docs can describe a route/capability surface that no longer matches the app

## Goals
- Establish one canonical TypeScript-owned capability/workspace contract.
- Keep calibration access roles runtime-configurable where that is an intentional product decision.
- Remove duplicated workspace navigation role definitions from JSON and frontend fallbacks.
- Make tests validate the canonical contract, not manually repeated arrays.
- Leave documentation with one live contract to describe.

## Non-goals
- Reworking the whole auth model.
- Replacing every runtime-configurable value with code-owned config.
- Introducing a code generator unless it clearly reduces complexity.

## Options considered

### Option 1: Keep split ownership and document it better
- `capabilities.ts` owns API roles
- `participant-console.json` owns workspace navigation roles
- tests and docs continue to mirror both

Pros:
- lowest code churn

Cons:
- preserves the exact drift problem we are trying to remove
- tests and docs remain vulnerable to stale duplication

Decision:
- rejected

### Option 2: Expand the TypeScript catalog to own both API and workspace contracts
- define API capabilities and workspace entries in one TypeScript module
- generate runtime-safe participant console config from that source plus remaining operational config
- keep only truly runtime-owned values in JSON

Pros:
- one code-owned truth for route/workspace identity and roles
- simplest model for tests and docs
- matches the desired end-state architecture

Cons:
- requires cutover work in config loading, tests, and frontend fallbacks

Decision:
- chosen

## Chosen approach

### 1. Canonical catalog
Introduce or extend a TypeScript-owned catalog that defines:
- capability id
- API route prefix, when applicable
- workspace id/path/label key, when applicable
- required roles
- visibility defaults for shared pages like `/profile`

This catalog becomes the canonical owner for:
- API route protection
- workspace navigation exposure
- route/workspace capability expectations in tests

### 2. Runtime config boundary
`participantConsole.ts` should stop owning workspace role definitions itself.

Instead:
- runtime config should derive workspace navigation from the canonical catalog
- JSON config should retain only genuinely runtime-tunable values such as:
  - draft storage settings
  - review/appeal queue defaults
  - calibration defaults and thresholds
  - identity defaults for mock mode
- calibration access roles remain an explicit exception if we still want them runtime-configurable

If calibration stays runtime-configurable, the catalog should model that explicitly instead of silently bypassing it.

### 3. Frontend cutover
Remove hardcoded fallback navigation arrays from workspace JS files and rely on runtime config plus shared navigation helpers.

This is important because frontend fallback arrays are currently another shadow contract.

### 4. Test cutover
Cut these test surfaces over to the canonical contract:
- RBAC matrix coverage
- participant console runtime-config coverage
- navigation contract assertions where they still duplicate role arrays

Tests may still assert concrete behavior, but the role matrix should come from one source rather than handwritten parallel literals.

### 5. Documentation cutover
Once the catalog is canonical, documentation should describe the live route/workspace contract from that source only.

## Recommended slices

### Slice 1: Complete the canonical catalog boundary
- extend the TypeScript capability model to cover workspaces as well as API routes
- model the calibration exception explicitly
- keep the existing API route behavior working

### Slice 2: Cut runtime config over to the canonical source
- move workspace navigation ownership out of JSON
- keep only operational/runtime tuning in JSON
- update `participantConsole.ts`

### Slice 3: Remove frontend fallback duplication
- remove local workspace-nav arrays from frontend pages
- rely on shared runtime config and shared navigation helpers

### Slice 4: Cut tests over
- make RBAC/runtime-config tests validate the canonical contract
- remove duplicated expected role arrays where feasible

### Slice 5: Docs sync
- update API/workspace docs after the contract is canonical

## Risks and mitigations

### Risk: accidental behavior change in workspace visibility
Mitigation:
- preserve current route ids, paths, and labels during cutover
- verify runtime config snapshots in tests

### Risk: calibration loses intended runtime configurability
Mitigation:
- treat calibration as an explicit contract exception instead of an implicit bypass
- document the exception in code and tests

### Risk: frontend pages depend on local fallback arrays in subtle ways
Mitigation:
- remove fallback arrays only after runtime-config coverage is in place
- keep the cutover small and verifiable page by page

## Acceptance signals
- one canonical TypeScript source owns route/workspace role contracts
- `src/app.ts` and participant console runtime config both derive from it
- workspace JS no longer carries duplicated role arrays
- targeted tests derive from the canonical contract
- docs reflect only the canonical contract

## Recommended starting issue
Start with the capability/RBAC cutover issue first.

Reason:
- it is already partially implemented, so the fastest path is to finish it
- docs and test cleanup become much easier once the contract is singular
- it reduces drift before we take larger runtime and module-boundary refactors
