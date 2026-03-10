# Phase 2 Design: Azure OpenAI Assessment Integration

## Context
The assessment pipeline already supports strict structured LLM output validation and asynchronous retries, but only `LLM_MODE=stub` was implemented. To run real module calibration and realistic scoring behavior, the platform needs a production-grade provider path for `LLM_MODE=azure_openai`.

## Problem Statement
Enable real LLM scoring while preserving:
- strict schema validation before decisions
- auditable, deterministic backend decision ownership
- deploy-time environment control for staging/production

## Options Considered
1. Keep stub mode only and postpone provider integration.
2. Add direct Azure OpenAI integration in the existing LLM service boundary.
3. Build a multi-provider abstraction layer first.

## Chosen Approach
Option 2, using the existing `evaluatePracticalWithLlm` boundary:
- implement Azure OpenAI chat-completions call
- enforce JSON-only response contract
- parse and validate response against current `zod` schema
- fail fast on malformed/non-JSON provider responses
- keep decision engine unchanged (LLM remains structured input only)

## Data, API, and Operational Impact
- No database schema changes.
- Runtime env contract expanded with Azure OpenAI settings:
  - endpoint, api key, deployment, api version, timeout, temperature, max tokens
- Azure infrastructure/deploy pipeline updated to pass new settings.
- Assessment job now passes versioned prompt-template content into LLM context.

## Rollout Plan
1. Deploy with `LLM_MODE=stub` unchanged (safe default).
2. Configure staging with Azure OpenAI settings and `LLM_MODE=azure_openai`.
3. Run participant flow smoke test (`submission -> MCQ -> assessment -> result`).
4. Monitor `llm_evaluation_failed` and queue backlog alerts.

## Rollback Plan
- Set `LLM_MODE=stub` and redeploy.
- No data migration rollback needed.
