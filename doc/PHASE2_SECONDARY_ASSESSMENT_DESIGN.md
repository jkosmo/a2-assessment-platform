# Phase 2 Design Note: Secondary LLM Assessment (#31)

## Context
Issue #31 requires an optional second-pass LLM evaluation for low-confidence/ambiguous cases, with configurable triggers, disagreement routing to manual review, and full traceability.

## Chosen approach
- Keep the existing schema/API intact.
- Add configuration to `assessment-rules.json` under `secondaryAssessment`:
  - policy enablement (`enabledByDefault`, `moduleOverrides`)
  - trigger rules (confidence patterns, red-flag severities, manual-review recommendation)
  - disagreement rules (score/rubric deltas and mismatch checks)
- Run primary pass as today, then evaluate whether secondary pass should run.
- If triggered:
  - run secondary pass
  - persist second `LLMEvaluation`
  - compute disagreement signals
  - force manual-review routing on disagreement
- Keep decisions immutable and auditable through additional audit events.

## Tradeoffs
- No DB migration needed, but traceability metadata is stored via audit events and existing evaluation rows rather than new DB columns.
- Secondary pass can be disabled globally/per module for cost/performance control.

## Rollout/rollback
- Safe rollback via config by disabling `secondaryAssessment` globally or per module.
- Code rollback remains straightforward due to isolated service + orchestration points.
