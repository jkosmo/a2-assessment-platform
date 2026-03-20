# Domain Lifecycle Reference

Authoritative reference for all domain state machines, decision lineage rules, and RBAC ownership.

---

## Submission Lifecycle

A `Submission` represents one participant attempt at a module version.

```
SUBMITTED
    │
    │  Assessment job created, MCQ attempted
    ▼
PROCESSING
    │
    │  LLM evaluation complete, scores computed
    ▼
SCORED
    │
    ├── automatic pass/fail (no red flags, not borderline) ──────────────────► COMPLETED
    │
    └── manual review required (borderline, red flag, or LLM recommends it)
            │
            ▼
        UNDER_REVIEW
            │
            │  Reviewer claims and overrides
            ▼
        COMPLETED  ◄── or ── REJECTED (edge case: reviewer rejects)
```

| Status | Meaning |
|---|---|
| `SUBMITTED` | Submission received; MCQ may still be in progress |
| `PROCESSING` | Assessment job is running (LLM evaluation in progress) |
| `SCORED` | Scores computed; routing decision pending |
| `UNDER_REVIEW` | Routed to manual review queue |
| `COMPLETED` | Final decision recorded (pass or fail) |
| `REJECTED` | Submission rejected (invalid or unreviewable) |

**Transitions are append-only.** There is no mechanism to move a submission backwards in the lifecycle.

---

## Assessment Job Lifecycle

An `AssessmentJob` is the async unit of work that evaluates a submission.

```
PENDING ──► RUNNING ──► SUCCEEDED
                  │
                  └──► FAILED  (after ASSESSMENT_JOB_MAX_ATTEMPTS retries)
```

| Status | Meaning |
|---|---|
| `PENDING` | Awaiting pickup by the AssessmentWorker |
| `RUNNING` | Claimed by a worker; evaluation in progress |
| `SUCCEEDED` | Evaluation complete; decision recorded |
| `FAILED` | All retry attempts exhausted; requires manual intervention |

A `workerId` is stamped on the job when it moves to `RUNNING` to prevent double-processing. If a worker crashes while `RUNNING`, the job becomes stale (see [OPERATIONS_RUNBOOK.md — Stale Jobs](OPERATIONS_RUNBOOK.md)).

---

## Manual Review Lifecycle

A `ManualReview` is created when a submission is routed to the review queue. One reviewer handles it.

```
OPEN ──► IN_REVIEW ──► RESOLVED
```

| Status | Meaning |
|---|---|
| `OPEN` | In the queue; not yet claimed |
| `IN_REVIEW` | Claimed by a reviewer; awaiting override decision |
| `RESOLVED` | Reviewer has submitted an override; a new `AssessmentDecision` of type `MANUAL_OVERRIDE` has been recorded |

Claiming a review sets `reviewerId` and transitions to `IN_REVIEW`. Only the reviewer who claimed it (or an ADMINISTRATOR) may finalise it.

When resolved, `overrideDecision` (`pass` / `fail`) and `overrideReason` are recorded. The submission moves to `COMPLETED`.

---

## Appeal Lifecycle

An `Appeal` is created by a participant after a submission reaches `COMPLETED` status.

```
OPEN ──► IN_REVIEW ──► RESOLVED
                 │
                 └──► REJECTED
```

| Status | Meaning |
|---|---|
| `OPEN` | Filed; awaiting pickup by an appeal handler |
| `IN_REVIEW` | Claimed by an appeal handler |
| `RESOLVED` | Appeal handler has resolved with `resolutionNote`; a new `AssessmentDecision` of type `APPEAL_RESOLUTION` has been recorded |
| `REJECTED` | Appeal rejected as invalid (no new decision recorded) |

An appeal does not change the `SubmissionStatus` — the submission remains `COMPLETED`. The new decision is appended to the lineage and is the authoritative outcome.

---

## Decision Lineage and Immutability

Each `AssessmentDecision` is **immutable** — decisions are never updated or deleted. A revised outcome is expressed by creating a new decision that references the prior one via `parentDecisionId`.

```
AssessmentDecision (AUTOMATIC, parentDecisionId = null)
    │
    └──► AssessmentDecision (MANUAL_OVERRIDE, parentDecisionId = <above>)
              │
              └──► AssessmentDecision (APPEAL_RESOLUTION, parentDecisionId = <above>)
```

| `decisionType` | Created by | Trigger |
|---|---|---|
| `AUTOMATIC` | Assessment engine | Submission scores processed by the decision engine |
| `MANUAL_OVERRIDE` | Reviewer | Manual review resolved with an override |
| `APPEAL_RESOLUTION` | Appeal handler | Appeal resolved |

The **latest decision** in the chain is the authoritative outcome. `CertificationStatus` always points to `latestDecisionId`.

All decisions include: `totalScore`, `passFailTotal`, `decisionReason`, `finalisedAt`, and the LLM evaluation reference (`redFlagsJson`). Decisions that carry a `finalisedById` have a human actor in the lineage.

---

## RBAC Ownership Model

### Roles

| Role | Description |
|---|---|
| `PARTICIPANT` | Submits assessments, views own results, files appeals |
| `REVIEWER` | Handles manual review queue; may override automatic decisions |
| `APPEAL_HANDLER` | Handles appeal queue; may resolve or reject appeals |
| `SUBJECT_MATTER_OWNER` | Manages module content; views calibration and reports |
| `REPORT_READER` | Read-only access to reporting endpoints |
| `ADMINISTRATOR` | Full access to all routes and all role capabilities |

### Route ownership summary

| Action | Allowed roles |
|---|---|
| Submit work, view own submission/result | PARTICIPANT, REVIEWER, ADMINISTRATOR |
| File an appeal | PARTICIPANT, ADMINISTRATOR |
| View/claim/override manual reviews | REVIEWER, ADMINISTRATOR |
| View/claim/resolve appeals | APPEAL_HANDLER, ADMINISTRATOR |
| Manage module content | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| View calibration workspace | SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| View reports | REPORT_READER, SUBJECT_MATTER_OWNER, ADMINISTRATOR |
| Org sync | ADMINISTRATOR only |

### Claim ownership rule

A review or appeal may only be finalised by the user who claimed it. An `ADMINISTRATOR` can finalise any claimed item regardless of who claimed it. This prevents two handlers working on the same item simultaneously.

### Immutability constraint

Participants cannot modify submissions after creation. Reviewers and appeal handlers can only act on items in the correct status (`OPEN` or `IN_REVIEW`). An item in `RESOLVED` status is closed; reopening is not supported in the current implementation.

---

## CertificationStatus

A `CertificationStatus` record is maintained per `(userId, moduleId)` pair. It is created or updated whenever a new passing `AssessmentDecision` is recorded. It tracks:

- `status` — e.g. `certified`, `expired`, `due_soon`, `due`
- `passedAt` — when the passing decision was first recorded
- `expiryDate` — computed from `passedAt + recertification.validityDays`
- `recertificationDueDate` — when the `due` window begins

If a passing decision is later overridden to a fail (via manual review or appeal), the certification status is updated to reflect the revised outcome.
