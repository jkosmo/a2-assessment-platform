# Phase 2 Design Note: Benchmark Example Management per Module (#35)

## Context
Issue #35 requires versioned benchmark anchors that can be linked to module/prompt versions and used in publishable, auditable content workflows.

## Chosen approach
- Reuse `PromptTemplateVersion` versioning as the benchmark anchor carrier.
- Add dedicated admin endpoint to create benchmark example versions:
  - derives from a base prompt template version
  - optionally links to a module version context
  - stores enriched benchmark example payload in `examplesJson`
- Keep existing module-version publication flow unchanged; benchmark prompt versions are linked by setting `promptTemplateVersionId` on a module version.

## Configuration-first controls
- Add `config/benchmark-examples.json` with limits and required fields:
  - `maxExamplesPerVersion`
  - `maxTextLength`
  - `requiredFields`

## Audit and publishability
- Benchmark version creation emits explicit audit event.
- Module versions referencing benchmark prompts are publishable through existing publication endpoint.
