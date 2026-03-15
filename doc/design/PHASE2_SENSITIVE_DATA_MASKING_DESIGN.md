# Phase 2 Design Note: Sensitive Data Detection and Masking (#29)

## Context
Issue #29 requires optional pre-processing before LLM invocation to detect and mask sensitive text, with configurable rules, module-scoped enablement, and auditability.

Current flow sends submission text directly from `assessmentJobService` to `evaluatePracticalWithLlm`.

## Options considered
1. Database model toggle per module version
- Pros: strongly typed and admin-managed in domain model.
- Cons: requires schema migration, admin UI/API changes, larger blast radius.

2. Config-driven policy in assessment rules (chosen)
- Pros: minimal surface area, no migration, fast rollout, easy threshold/rule tuning.
- Cons: module targeting uses config keys (module IDs) and requires deploy/config update for changes.

## Chosen approach
- Add `sensitiveData` section to `assessment-rules.json` + schema:
  - `enabledByDefault`
  - `moduleOverrides` (moduleId -> boolean)
  - `rules` (`id`, regex `pattern`, optional `flags`, `replacement`)
- Add preprocessor service that:
  - detects rule hits across `rawText`, `reflectionText`, `promptExcerpt`
  - conditionally masks payload when module policy resolves to enabled
  - returns structured decision metadata (`maskingEnabled`, `maskingApplied`, `ruleHits`, totals)
- Integrate in `assessmentJobService` before LLM call.
- Emit auditable event with decision metadata per submission assessment run.

## Data/API/ops impact
- No API contract change.
- No schema migration.
- Audit trail gains an additional event for sensitive-data preprocessing.
- LLM request payload hash is computed from the actual payload sent after preprocessing.

## Rollout/rollback
- Safe default: masking disabled unless explicitly enabled by default or per module override.
- Rollback path: set `enabledByDefault=false` and clear overrides/rules, or revert release.
