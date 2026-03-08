# M1 Implementation Decisions

## Scope
This document captures implementation decisions for:
- `#13` module overview UI
- `#14` submission API
- `#15` MCQ flow and deterministic scoring
- `#16` LLM stub integration
- `#17` strict structured LLM contract
- `#18` decision engine
- `#19` async assessment orchestration
- `#38` group-to-role mapping
- `#40` dev tenant auth setup automation
- `#39` onboarding and smoke tests

## Architecture Decisions
- Keep backend as the final source of truth for scoring and pass/fail decisions.
- Use strict schema validation for LLM responses before persistence/decision logic.
- Use asynchronous assessment jobs to decouple submission/MCQ flow from LLM + decision execution.
- Keep thresholds/weights/manual-review rules in JSON configuration (`config/assessment-rules.json`) instead of hardcoded logic.
- Support Entra group claims to app-role synchronization behind explicit config flags.

## Refactor Decisions
- Introduced service layer (`submissionService`, `mcqService`, `assessmentJobService`, `decisionService`) to keep route handlers thin and reduce complexity growth.
- Kept existing auth/repository separation and extended it with claim-to-role synchronization instead of embedding role logic in routes.

## Security and Separation
- Dev tenant auth bootstrap is implemented via script; production identity objects are explicitly out of scope.
- App env enforces tenant and audience validation in Entra mode.
- Group-role synchronization can be toggled (`ENTRA_SYNC_GROUP_ROLES`) and configured by JSON string/file.

## Testing Decisions
- Added integration test for end-to-end M1 core flow:
- submission creation
- MCQ start/submit
- assessment queue/run
- result retrieval with decision + evaluation
- Existing M0 tests retained.

## Known Limitations
- `LLM_MODE=azure_openai` is currently scaffolded but intentionally not implemented yet.
- Submission attachment upload is URI-based in this phase; object storage upload pipeline is not implemented yet.
- Worker uses single-process polling; distributed locking strategy is a future hardening step.

