# Appeals Operating Model (MVP)

This document defines runtime operations after an appeal is submitted.

## Purpose
- Ensure predictable case handling for appeals.
- Define ownership, SLA targets, and escalation behavior.
- Make at-risk/overdue appeals visible from system data.

## Lifecycle
1. `appeal_created`
   - Trigger: participant submits appeal via `POST /api/submissions/{submissionId}/appeals`.
   - System effect: appeal is `OPEN`; submission is set to `UNDER_REVIEW`.
2. `appeal_claimed`
   - Trigger: handler/admin claims appeal via `POST /api/appeals/{appealId}/claim`.
   - System effect: appeal is `IN_REVIEW`.
3. `appeal_resolved`
   - Trigger: handler/admin resolves via `POST /api/appeals/{appealId}/resolve`.
   - System effect: new immutable `APPEAL_RESOLUTION` decision is created, appeal is `RESOLVED`, submission returns to `COMPLETED`.

## Ownership and RACI
- Participant:
  - Responsible for submitting appeal rationale.
  - Informed on status and resolution outcome.
- Appeal Handler (`APPEAL_HANDLER`):
  - Responsible for queue triage, claim, and resolution.
  - Accountable for meeting SLA in normal operations.
- Administrator (`ADMINISTRATOR`):
  - Accountable for escalation, reassignment, and SLA breach response.
  - Responsible for operational reporting review.
- Subject Matter Owner / Report Reader:
  - Consulted/informed for trend review and quality governance.

## SLA and SLO Targets
Configured via environment:
- `APPEAL_FIRST_RESPONSE_SLA_HOURS` (default `24`)
- `APPEAL_RESOLUTION_SLA_HOURS` (default `72`)
- `APPEAL_AT_RISK_RATIO` (default `0.75`)

Derived states:
- `ON_TRACK`: appeal age below at-risk thresholds.
- `AT_RISK`: appeal age above `SLA * APPEAL_AT_RISK_RATIO`.
- `OVERDUE`: appeal age above SLA target.
- `RESOLVED`: appeal has `resolvedAt`.

Where available:
- Queue API includes `sla` snapshot.
- Reporting API includes per-row SLA fields and totals:
  - `GET /api/reports/appeals`
  - totals include `onTrackAppeals`, `atRiskAppeals`, `overdueAppeals`.

## Escalation Path
1. At-risk:
   - Daily review by Appeal Handler lead.
   - Re-prioritize queue; assign explicit owner.
2. Overdue:
   - Immediate admin notification.
   - Admin reassigns/claims appeal and sets expected resolution time.
3. Persistent overdue (over 2x resolution SLA):
   - Escalate to service owner and product owner for capacity or process action.

## Participant Communication Points
- Acknowledgement:
  - API response from appeal creation confirms case creation.
- Status visibility:
  - Current status available in appeal/admin endpoints and reporting.
- Resolution communication:
  - Resolution includes `decisionReason` and `resolutionNote`.
  - Participant can verify final decision through result/submission endpoints.

## Minimal Runbook (Staging)
1. Create test appeal as participant.
2. Verify `OPEN` in `GET /api/appeals`.
3. Claim as handler and verify `IN_REVIEW`.
4. Resolve and verify `RESOLVED`.
5. Verify audit sequence includes:
   - `appeal_created`
   - `appeal_claimed`
   - `appeal_resolution_decision_created`
   - `appeal_resolved`
6. Verify reporting:
   - `GET /api/reports/appeals`
   - check SLA fields and totals.

## Staging Escalation Test (Short SLA)
To test escalation behavior quickly in staging:
1. Temporarily set low SLA app settings (for example `1` hour).
2. Create an appeal and leave it unclaimed/resolution pending.
3. Verify report row transitions to `AT_RISK` and then `OVERDUE`.
4. Restore normal SLA settings after test.

## Follow-up Backlog (Post-MVP hardening)
- #44 Track explicit `claimedAt` timestamp for exact first-response SLA.
- #45 Add automatic escalation alerting for overdue appeals.
- #46 Add participant notification channel (email/Teams) for appeal status transitions.
