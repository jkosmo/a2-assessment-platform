# Phase 2 Design: Participant Notifications for Appeal Transitions

## Context
Phase-2 issue `#46` requires proactive participant notifications when appeal status changes.
MVP already stores and exposes status in APIs, but no push signal is sent.

## Problem Statement
Participants currently need to poll UI/API to discover appeal progress.
We need an integration-safe mechanism that:
- emits transition notifications for `OPEN`, `IN_REVIEW`, `RESOLVED`, `REJECTED`
- supports stage/prod delivery channel configuration
- does not break appeal handling flow on downstream notification failures

## Options Considered
1. Direct SMTP/email integration in backend
- Pros: direct participant communication
- Cons: provider coupling, secret management, difficult local/test portability

2. Teams-only integration
- Pros: simple for internal operations
- Cons: not participant-centric and not reusable for future channels

3. Channel-abstracted notification pipeline with webhook/log modes (chosen)
- Pros: config-driven, environment-portable, easy to test, supports email/Teams via downstream automation
- Cons: requires external automation service in production for actual outbound messaging

## Chosen Approach
- Add `participantNotificationService` with channel abstraction:
  - `disabled`
  - `log`
  - `webhook`
- Trigger notification dispatch from appeal lifecycle transitions:
  - create appeal (`OPEN`)
  - claim appeal (`IN_REVIEW`)
  - resolve appeal (`RESOLVED`)
- Localize notification subject + next-step guidance for:
  - `en-GB`
  - `nb`
  - `nn`
- Record notification outcomes as audit events for traceability.
- Log send/failure operational events for observability.
- Use non-blocking wrapper so notification pipeline failures do not block core appeal processing.

## Data/API/Operational Impact
- No API contract changes.
- New runtime env settings:
  - `PARTICIPANT_NOTIFICATION_CHANNEL`
  - `PARTICIPANT_NOTIFICATION_WEBHOOK_URL`
  - `PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS`
- Azure deployment config includes these settings for stage/prod.
- Observability adds:
  - `participant_notification_sent`
  - `participant_notification_failed`
  - `participant_notification_pipeline_failed`

## Rollout and Rollback
- Rollout:
  - Stage with `log` mode first.
  - Enable `webhook` in production when endpoint is available.
- Rollback:
  - Set `PARTICIPANT_NOTIFICATION_CHANNEL=disabled` without redeploying code.

## Open Follow-up
- Add participant locale preference persistence and per-user locale selection for notifications.
