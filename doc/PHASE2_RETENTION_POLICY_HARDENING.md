# Phase 2 Discovery: Retention and Legal Policy Hardening (#36)

## Status
This note is a policy and implementation draft, not final legal approval.

It is intended to reduce ambiguity before legal/privacy review by mapping current data categories to:
- purpose
- proposed retention window
- proposed deletion or anonymisation action
- technical controls
- ownership

## Policy basis
This proposal follows the general storage-limitation model in GDPR Article 5 and Datatilsynet guidance:
- personal data should not be kept longer than necessary for its purpose
- controllers should define deletion deadlines or periodic review cycles
- when full deletion is not necessary, anonymisation or stronger minimisation should be preferred

Practical implication for this platform:
- retain enough evidence to support assessment traceability, appeal handling, and recertification
- stop retaining raw submission content longer than needed once case-handling and challenge windows have expired
- keep aggregated certification state longer than raw assessment evidence

## Current architecture constraints
Current schema and services are audit-first and traceability-first:
- `Submission` stores `rawText`, `reflectionText`, `promptExcerpt`, and optional `attachmentUri`
- `AssessmentDecision`, `LLMEvaluation`, `MCQAttempt`, `MCQResponse`, `ManualReview`, and `Appeal` are linked back to a submission
- `CertificationStatus` is a derived aggregate per `(userId, moduleId)`
- `AuditEvent.metadataJson` can contain user IDs, submission IDs, email addresses, and operational metadata
- foreign keys use `onDelete: Restrict` across the assessment chain, so hard deletion is not currently possible without an explicit archival/pseudonymisation strategy

Conclusion:
- first implementation should prefer controlled anonymisation/pseudonymisation over immediate relational hard-delete for traceability-linked records

## Data categories and draft policy
The periods below are proposed defaults for approval, not legal conclusions.

| Category | Examples in current model | Primary purpose | Proposed retention window | Proposed end-state |
| --- | --- | --- | --- | --- |
| Raw submission evidence | `Submission.rawText`, `reflectionText`, `promptExcerpt`, `attachmentUri` | Assessment evidence, appeal support, quality review | Keep until final decision/appeal resolution + 24 months | Delete raw text and attachment reference, keep minimal derived record |
| Assessment execution detail | `LLMEvaluation`, `MCQAttempt`, `MCQResponse`, assessment job errors | Explain score production and troubleshoot quality drift | Keep until final decision/appeal resolution + 24 months | Pseudonymise where needed; delete low-value execution detail first |
| Human handling records | `ManualReview`, `Appeal`, resolution notes | Case handling, fairness, dispute support | Keep until final resolution + 36 months | Retain structured outcome; redact unnecessary free text if no longer needed |
| Immutable decision lineage | `AssessmentDecision` | Certification decision basis and governance traceability | Keep until certification expiry + 36 months | Retain, but pseudonymise participant identifiers if raw evidence is deleted |
| Aggregated certification status | `CertificationStatus` | Operational certification state and recertification | Keep while certification is active, then expiry + 36 months | Retain or anonymise depending on reporting/business need |
| Audit trail | `AuditEvent` and related audit views | Accountability, incident investigation, control evidence | Keep 36 months with annual review | Retain with metadata minimisation and redact low-value personal fields |
| Operational logs | Azure/App logs, backlog alerts, failure events | Runtime troubleshooting and ops response | 30-90 days depending on signal type | Delete on rolling schedule; export only exceptions needing longer investigation |
| Reporting extracts / CSV exports | User-downloaded files, generated exports | Ad hoc governance and audit support | No server-side persistence by default; if stored, 30 days max | Prefer not to persist server-side at all |

## Draft policy rules by category
### 1. Raw submission evidence
Includes the most sensitive free-text material in the platform.

Draft rule:
- once a submission has no open manual review or appeal, raw evidence should move to a countdown state
- after 24 months, delete or blank:
  - `rawText`
  - `reflectionText`
  - `promptExcerpt`
  - `attachmentUri`

Keep:
- submission identifiers
- module/version references
- timestamps
- final status
- latest decision linkage

Reasoning:
- this preserves minimal outcome traceability without retaining substantive participant text indefinitely

### 2. Assessment execution detail
This category is valuable for calibration and incident analysis, but not forever.

Draft rule:
- keep full `LLMEvaluation`, MCQ attempt/response detail, and assessment job error detail for 24 months after final resolution
- after that, either:
  - delete MCQ response-level detail, or
  - aggregate to score-only evidence if calibration needs remain

### 3. Human handling records
Appeal and manual-review notes may contain sensitive judgment text.

Draft rule:
- retain full structured handling record for 36 months after final resolution
- at review point, assess whether free-text reason fields can be redacted while preserving timestamps, status, and decision references

### 4. Immutable decisions
Decisions are the backbone of auditability and certification basis.

Draft rule:
- retain decisions longer than raw submission content
- default proposal: until certification expiry plus 36 months, or 36 months from final resolution where no certification exists

### 5. Certification status
Certification records are lower-volume, higher-business-value aggregates.

Draft rule:
- keep while certification is active
- after expiry, keep for an additional 36 months for recertification, reporting continuity, and employee-history queries
- after that, anonymise or delete depending on approved business need

### 6. Audit events
Audit logs should survive longer than raw evidence, but metadata must be minimised.

Draft rule:
- keep audit events 36 months by default
- reduce personal detail in `metadataJson` where entity references already exist
- avoid storing email addresses in metadata when `actorId` or `userId` is sufficient

### 7. Operational logs
These should have the shortest retention because they primarily support active operations.

Draft rule:
- 30 days for high-volume console/application logs
- up to 90 days for incident-relevant alert signals if operationally necessary
- longer retention only for exported incident records with a documented case reference

## Technical control model
Recommended first implementation approach:

### A. Config-driven retention policy
Add a runtime config file or env-backed policy block for:
- `submissionEvidenceDays`
- `assessmentExecutionDays`
- `humanHandlingDays`
- `decisionDaysAfterExpiry`
- `certificationDaysAfterExpiry`
- `auditEventDays`
- `operationalLogDays`
- `dryRun`

Why:
- policy changes should not require code edits for every retention adjustment

### B. Retention review state machine
Before any deletion/anonymisation, a record must satisfy:
- no open appeal
- no open manual review
- final decision exists or record is otherwise terminal
- no active legal hold flag

### C. Pseudonymisation-first implementation
Because current foreign keys are `Restrict`, first slice should:
- blank or replace free-text evidence fields
- replace direct identifiers in secondary metadata where possible
- keep relational structure intact

### D. Legal hold capability
Add a hold mechanism before any automated purge:
- entity-level hold table or hold flag keyed by `submissionId` and optionally `userId`
- hold reason, owner, start timestamp, expected review timestamp

Without legal hold, deletion automation is too risky.

### E. Retention job with dry-run mode
Add scheduled job behavior:
- list candidate rows
- produce counts by category
- emit audit/operational event for each run
- support dry-run in staging before destructive actions are enabled

## Proposed ownership model
| Area | Proposed owner |
| --- | --- |
| Policy approval | Data protection/legal + business data owner |
| Business retention need for assessment evidence | Learning/certification owner |
| Technical retention configuration | Engineering |
| Purge job operations and monitoring | Platform/ops owner |
| Legal hold approval and release | Legal/privacy owner |
| Evidence of control effectiveness | Administrator / compliance owner |

## Implementation plan
### Phase 1: Approval-ready policy baseline
- approve category list
- approve target retention windows or approved ranges
- approve ownership and legal-hold process

### Phase 2: Metadata minimisation
- stop writing unnecessary personal fields into `AuditEvent.metadataJson`
- review logging payloads for emails/free text

### Phase 3: Retention engine
- add config-driven retention settings
- add dry-run retention report endpoint/job
- add legal-hold model

### Phase 4: Pseudonymisation/deletion execution
- blank submission free-text fields after approved deadline
- trim low-value execution details
- review whether some audit metadata can be reduced or redacted

### Phase 5: Reporting and evidence
- add admin/compliance report showing:
  - candidates pending purge
  - held records
  - last run outcome
  - rows anonymised/deleted by category

## Recommended follow-up issues
1. Add retention policy config model and dry-run retention report
2. Add legal-hold data model and admin controls
3. Minimise `AuditEvent.metadataJson` payloads across services
4. Implement submission-evidence pseudonymisation job
5. Implement certification/audit review report for compliance owners

## Open decisions requiring human approval
- Are the proposed durations acceptable for the company’s employment, training, and dispute context?
- Is a longer retention window required for specific regulated modules?
- Should expired certification history be anonymised or retained in identifiable form for workforce planning?
- Which owner can place and release a legal hold?
- Does any external HR/LMS integration impose longer or shorter retention periods?

## Recommendation
Approve the model, not the exact numbers, as the next step.

Specifically:
- approve the category split
- approve pseudonymisation-first implementation
- approve legal-hold as a mandatory control
- then let legal/privacy set final durations before engineering automates enforcement

## Source basis
This draft is informed by the storage-limitation and accountability principles described in:
- GDPR Article 5 general principles (official EU text)
- European Data Protection Board guidance on basic GDPR principles
- Datatilsynet guidance on `lagringsbegrensning`

It should be treated as an implementation-ready policy draft pending legal approval, not as legal advice.
