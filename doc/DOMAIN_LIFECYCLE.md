# Domain Lifecycle Reference

Authoritative reference for:
- submission lifecycle
- assessment job lifecycle
- manual review lifecycle
- appeal lifecycle
- immutable decision lineage
- certification status behavior
- RBAC ownership expectations

## Submission Lifecycle

A `Submission` represents one participant attempt against an active module version.

Primary status progression:

```text
SUBMITTED
  -> PROCESSING
  -> SCORED
  -> COMPLETED
```

Manual-review and appeal routing can move the submission through `UNDER_REVIEW` before it returns to `COMPLETED`.

Current statuses:

| Status | Meaning |
|---|---|
| `SUBMITTED` | Submission has been created |
| `PROCESSING` | Assessment work is in progress |
| `SCORED` | Automatic scoring finished and routing decision is being applied |
| `UNDER_REVIEW` | Human review or appeal handling is in progress |
| `COMPLETED` | Latest authoritative outcome is available |
| `REJECTED` | Reserved status for rejected/unusable submissions |

Important notes:
- the submission status is mutable operational state
- the decision history is immutable
- new authoritative outcomes are expressed by appending decisions, not rewriting old ones

### Submission plus manual review

Typical review path:

```text
SUBMITTED
  -> PROCESSING
  -> SCORED
  -> UNDER_REVIEW
  -> COMPLETED
```

### Submission plus appeal

Current implemented appeal path:

```text
COMPLETED
  -> UNDER_REVIEW   (appeal created)
  -> UNDER_REVIEW   (appeal in review)
  -> COMPLETED      (appeal resolved with new decision)
```

This is important:
- appeal creation currently updates `Submission.submissionStatus` to `UNDER_REVIEW`
- appeal resolution returns the submission to `COMPLETED` through shared decision-lineage logic

## Assessment Job Lifecycle

An `AssessmentJob` is the async unit processed by the worker role.

Current statuses:

```text
PENDING -> RUNNING -> SUCCEEDED
                    -> FAILED
```

| Status | Meaning |
|---|---|
| `PENDING` | Runnable job waiting for pickup |
| `RUNNING` | Claimed by a worker and under lease |
| `SUCCEEDED` | Assessment run completed successfully |
| `FAILED` | Retry budget exhausted or stale-lock recovery failed the job |

Operational details:
- jobs are leased with `lockedAt`, `lockedBy`, and `leaseExpiresAt`
- stale running jobs are automatically reset or failed
- backlog and stuck-job signals are emitted for observability

## Manual Review Lifecycle

A `ManualReview` exists when automatic scoring routes a submission into human review.

Current lifecycle:

```text
OPEN -> IN_REVIEW -> RESOLVED
```

| Status | Meaning |
|---|---|
| `OPEN` | Waiting in the review queue |
| `IN_REVIEW` | Claimed by a reviewer |
| `RESOLVED` | Reviewer finalised an override |

Resolution behavior:
- resolving a manual review appends a new decision of type `MANUAL_OVERRIDE`
- the new decision becomes the latest authoritative outcome
- the submission is moved to `COMPLETED`

Ownership rule:
- the assigned reviewer may finalize it
- `ADMINISTRATOR` may act across ownership boundaries at route level

## Appeal Lifecycle

An `Appeal` is created by the participant after an existing outcome exists.

Current implemented lifecycle:

```text
OPEN -> IN_REVIEW -> RESOLVED
```

Current enum values:
- `OPEN`
- `IN_REVIEW`
- `RESOLVED`
- `REJECTED`

Important implementation note:
- `REJECTED` exists in the model and is understood by reporting/SLA logic
- the current appeal handler HTTP workflow exposes claim and resolve actions, not a dedicated reject action

Claim/ownership behavior:
- claim sets the appeal to `IN_REVIEW`
- claim ownership is currently tracked via `resolvedById`
- `claimedAt` is set on first claim

Resolution behavior:
- appeal resolution appends a new decision of type `APPEAL_RESOLUTION`
- the submission returns to `COMPLETED`
- the new decision becomes the authoritative outcome

## Decision Lineage and Immutability

`AssessmentDecision` is append-only.

Later outcomes are represented by a new decision with `parentDecisionId` pointing at the prior authoritative decision.

Typical lineage:

```text
AUTOMATIC
  -> MANUAL_OVERRIDE
  -> APPEAL_RESOLUTION
```

Current decision types:

| Decision type | Created by |
|---|---|
| `AUTOMATIC` | assessment engine |
| `MANUAL_OVERRIDE` | reviewer workflow |
| `APPEAL_RESOLUTION` | appeal workflow |

Shared lineage behavior is implemented through `appendDecisionWithLineage(...)`.
That helper currently:
- creates the new decision
- sets `parentDecisionId`
- moves the submission to `COMPLETED`
- updates certification status from the new decision
- records decision audit data

This means:
- workflow-specific status changes happen around the decision
- authoritative outcome changes happen through appended decisions, not mutation

## Certification Status

A `CertificationStatus` is maintained per `(userId, moduleId)`.

Current behavior:
- every new authoritative decision updates `latestDecisionId`
- passing decisions produce a recertification lifecycle state
- failing decisions produce `NOT_CERTIFIED`

Current lifecycle values:
- `ACTIVE`
- `DUE_SOON`
- `DUE`
- `EXPIRED`
- `NOT_CERTIFIED`

Fields maintained from the latest authoritative decision:
- `latestDecisionId`
- `status`
- `passedAt`
- `expiryDate`
- `recertificationDueDate`

This is why a later manual override or appeal resolution can replace the effective certification outcome without mutating older decisions.

## RBAC Ownership Model

Current application roles:

| Role | Meaning |
|---|---|
| `PARTICIPANT` | submit work, view own results, create appeals |
| `REVIEWER` | manual review workspace |
| `APPEAL_HANDLER` | appeal workspace |
| `SUBJECT_MATTER_OWNER` | calibration, admin-content, some reporting |
| `REPORT_READER` | reporting read access |
| `ADMINISTRATOR` | broad cross-workflow access |

### Sensitive route families

| Route family | Intended roles |
|---|---|
| participant submissions/results | `PARTICIPANT`, `ADMINISTRATOR`, some reviewer/admin support paths |
| manual review | `REVIEWER`, `ADMINISTRATOR` |
| appeals | `APPEAL_HANDLER`, `ADMINISTRATOR` |
| calibration | `SUBJECT_MATTER_OWNER`, `ADMINISTRATOR` |
| admin content | `SUBJECT_MATTER_OWNER`, `ADMINISTRATOR` |
| reports | `REPORT_READER`, `SUBJECT_MATTER_OWNER`, `ADMINISTRATOR` |
| org sync | `ADMINISTRATOR` |

### Ownership rules inside workflows

- a claimed manual review should only be finalized by the same reviewer unless an admin intervenes
- a claimed appeal should only be resolved by the same handler unless an admin intervenes
- participants cannot alter historical decisions directly

## Domain Invariants

The key invariants that should stay true:

1. Decisions are immutable.
2. Latest authoritative outcome is represented by the newest decision in the lineage.
3. Submission operational state may change, but prior decisions must remain inspectable.
4. Manual review and appeals are separate workflows even when they affect the same submission.
5. Certification status is derived from the latest authoritative decision, not from stale workflow state.
