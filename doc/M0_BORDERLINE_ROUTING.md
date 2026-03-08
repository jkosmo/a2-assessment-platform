# M0 Discovery Decision: Borderline Routing and Manual Review Thresholds

## Purpose
Define an initial, explicit routing policy for automatic decision vs. manual review in M0.

## Status
- Decision type: Interim M0 baseline
- Owner: Product + Subject Matter Owner + Compliance (to confirm)
- Last updated: 2026-03-08

## Assumptions
- Manual review must remain exception-based.
- The backend owns final scoring and pass/fail logic.
- LLM can recommend manual review, but cannot finalize outcome.
- All decisions must remain traceable to module/rubric/prompt versions.

## M0 Routing Rules
The backend sets submission status using the following precedence order:

1. **Hard manual review trigger**
- Any `red_flags` item with `severity=high` -> `UNDER_REVIEW`

2. **LLM confidence/manual trigger**
- `manual_review_recommended=true` -> `UNDER_REVIEW`

3. **Borderline score window**
- `total_score` in `[67, 73]` -> `UNDER_REVIEW`

4. **Threshold outcome**
- If not routed to review and thresholds are met:
- `total_score >= 70`
- practical score >= 50%
- MCQ score >= 60%
- no open red flags
- then decision = pass

5. **Else**
- decision = fail

## Decision Authority
- Automatic pass/fail: backend decision engine.
- Under review outcomes: reviewer/appeal handler finalizes.
- Appeals can create a new decision layer (`parentDecisionId` links lineage).

## Configuration-First Mapping
The following values must be stored in configuration (not hardcoded):
- `manual_review.red_flag_severities` (default: `["high"]`)
- `manual_review.score_window.min` (default: `67`)
- `manual_review.score_window.max` (default: `73`)
- `thresholds.total_min` (default: `70`)
- `thresholds.practical_min_percent` (default: `50`)
- `thresholds.mcq_min_percent` (default: `60`)

## Open Questions (create follow-up discovery issue if needed)
- Should `severity=medium` flags also route to manual review for selected modules?
- Should the borderline window be global or module-specific?
- What SLA is required for cases in manual review and appeal queues?
- Should repeated failed attempts trigger manual review automatically?

