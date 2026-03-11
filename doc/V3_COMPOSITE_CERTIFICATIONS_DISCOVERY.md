# Version 3 Discovery Note: Composite Certifications from Module Sets (#68)

## Context
The current platform is module-centric end to end:
- participant discovery, submission, MCQ, assessment, decisioning, and completion are keyed by `moduleId`
- certification status and recertification are stored per `(userId, moduleId)`
- reporting groups rows by module and assumes one certification lifecycle per module

Issue #68 asks whether Version 3 should support composite certifications or courses where multiple modules together determine a single certification outcome.

## Problem framing
Composite certification introduces a second lifecycle above the existing module lifecycle:
- participants still submit and pass individual modules
- certification is awarded only after all required modules in a composite are passed
- recertification may apply either to the composite as a whole or per contributing module
- reporting and audit must explain both module-level outcomes and composite-level status

The main architectural constraint is to add this without breaking the current module-based workflows.

## Complexity assessment
| Area | Complexity | Why |
| --- | --- | --- |
| Backend domain/services | High | Existing services are keyed directly on `moduleId`, especially decision finalization, completed history, and recertification. |
| Data schema/migrations | High | New track and requirement entities are needed, plus participant progress and backfill for existing module certifications. |
| API contracts | Medium | Existing module APIs can stay, but additive composite endpoints and response metadata will be needed. |
| Frontend/workspace UX | Medium | Participant flow stays module-based, but available modules, completed history, and result summaries need composite awareness. |
| Reporting/audit | High | Reports, exports, and audit views need to distinguish module pass from composite certification awarded. |
| Ops rollout/backfill | Medium | Composite data can be introduced behind config and empty tables, but backfill and rollback boundaries must be explicit. |

## Existing coupling that matters
- `Submission`, `ModuleVersion`, `MCQSetVersion`, `RubricVersion`, and `AssessmentDecision` are all module-bound.
- `CertificationStatus` is uniquely keyed by `(userId, moduleId)`.
- `recertificationService` derives validity and reminders from a single module pass.
- `/api/modules` and `/api/modules/completed` are the participant-facing discovery/history surfaces.
- reporting and CSV export filter and group by `moduleId`.

This means composite certification should be introduced as a layer above modules, not by replacing modules as the primary assessment unit.

## Architecture options
### Option A: Composite certification as an additive aggregation layer
Add new entities such as:
- `CertificationTrack`
- `CertificationTrackModuleRequirement`
- `ParticipantTrackStatus`
- optional `ParticipantTrackModuleProgress` if derived progress is too expensive to compute on read

Behavior:
- module assessment remains unchanged
- passing a module updates module-level status exactly as today
- a new track service listens to final decisions and recalculates whether the participant has completed all required modules in each affected track
- composite certification, reporting, and future recertification operate from track status

Pros:
- lowest disruption to current APIs and workspaces
- preserves current audit lineage and test suite assumptions
- rollout can start with read-only track progress before composite awarding is enabled

Cons:
- duplicate concepts exist for a period: module certification and composite certification
- some reports must present both module and track views
- recertification policy needs a clear rule when module and track validity differ

### Option B: Replace module-centric certification with a generic requirement graph
Model certifications as configurable requirement graphs where modules are only one possible node type.

Pros:
- most flexible long term
- naturally supports electives, substitutions, and nested programs

Cons:
- much larger schema and service rewrite
- weak fit for the current repo, which is optimized around simple module flows
- higher migration and rollback risk
- likely over-engineered for the first composite-certification use case

## Recommendation
Choose Option A.

Reasoning:
- it fits the existing module-first architecture
- it preserves current submission, MCQ, scoring, review, and appeal workflows
- it creates a clean boundary for later expansion to electives or graph-like policies without paying that complexity now

## Recommended domain boundaries
Config-driven:
- which tracks exist
- which modules are required in each track
- whether a track uses strict all-pass or all-pass-with-validity-window
- whether track recertification is enabled
- whether track completion hides constituent modules from `/api/modules`

Hardcoded in first implementation slice:
- only strict required-module sets, no electives
- no nested tracks
- no partial credit across equivalent modules
- track status derived from final module decisions only

## Proposed data model direction
Recommended new entities:
- `CertificationTrack`
  - id, code, title, description, activeFrom, activeTo
- `CertificationTrackRequirement`
  - trackId, moduleId, sequenceNo, required, validityContributionMode
- `ParticipantTrackStatus`
  - userId, trackId, status, passedAt, expiryDate, recertificationDueDate, latestEvaluatedAt

Recommended status model for tracks:
- `NOT_STARTED`
- `IN_PROGRESS`
- `COMPLETED`
- `EXPIRED`

Recommended rule for first implementation:
- a track is `COMPLETED` when every required module has a latest final decision with pass outcome
- `passedAt` is the latest completion date among required modules
- `expiryDate` is the earliest module expiry among required modules if track recertification is enabled

This keeps the first release deterministic and auditable.

## API impact
Keep current endpoints stable and additive.

Likely additive endpoints:
- `GET /api/tracks`
- `GET /api/tracks/completed?limit=<n>`
- `GET /api/tracks/:trackId`
- `GET /api/reports/composite-certifications`

Likely additive metadata on existing endpoints:
- `/api/modules` may later expose `partOfTrack[]` references
- `/api/modules/completed` may later expose `contributesToTrack[]`
- submission result payloads may later include `trackProgress` summary

Avoid in first slice:
- changing `POST /api/submissions`
- changing MCQ endpoints
- changing manual review or appeal contracts

## UX impact
Participant UX:
- keep entry into work through modules, not tracks
- add optional composite progress summary after module completion and in completed history
- only add track landing page if multiple-track navigation becomes confusing

Workspace UX:
- manual review and appeal remain module-oriented
- admin content eventually needs a simple track configuration surface, but not in the first backend slice
- reporting needs explicit module view versus track view to avoid ambiguity

## Reporting and audit impact
New reporting needs:
- participant progress per track
- completion rate per track
- overdue recertification per track if enabled
- ability to trace which module decisions satisfied which track requirements

Audit expectation:
- keep existing decision and certification audit untouched
- add explicit track-status audit events such as:
  - `track_status_evaluated`
  - `track_completed`
  - `track_expired`

Without explicit track audit events, rollback and support analysis will be weak.

## Risk matrix
| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Composite and module certification rules diverge in unclear ways | High | High | Document strict policy for V1 and reject electives/substitutions initially. |
| Recertification semantics become inconsistent across module and track status | High | High | Keep module recertification unchanged first; add track recertification only in a later dedicated slice. |
| Reporting becomes ambiguous and mixes module rows with track rows | Medium | High | Add separate track report/export endpoints rather than overloading current reports. |
| Backfill produces incorrect `IN_PROGRESS` or `COMPLETED` states | Medium | High | Build idempotent recompute job from historical final decisions and verify on staging snapshots. |
| Participant UX becomes confusing if modules disappear too early | Medium | Medium | Keep module list behavior unchanged until track progress UI is visible and tested. |
| Performance degrades when computing track progress on every read | Medium | Medium | Start with derived read model for small scale; add persisted `ParticipantTrackStatus` if needed. |

## Phased rollout
### Phase 1: Schema and read-only aggregation
- add track tables with no effect on current participant flow
- seed example track definitions
- add internal service that computes track progress from existing final decisions
- expose read-only admin/reporting endpoint for track progress

### Phase 2: Participant visibility
- add participant-facing track progress summaries
- keep module submission flow unchanged
- do not hide modules or change completed-module filtering yet

### Phase 3: Certification awarding
- persist `ParticipantTrackStatus`
- emit track audit events
- expose track completion and track reports

### Phase 4: Optional operational refinement
- add track recertification policy
- add admin track configuration UI
- optionally hide already-satisfied modules from default participant list if policy allows

## Rollback strategy
Safe rollback boundary:
- disable track endpoints and UI
- stop recomputing track status
- leave track tables in place

Unsafe rollback boundary:
- replacing module certification semantics with track-only certification in the same release

Recommendation:
- never make current module certification unreadable during the first composite rollout
- use additive schema and additive APIs so rollback is mostly a feature-disable operation

## Migration and backfill
Recommended strategy:
- create empty track tables first
- add track definitions by seed/config
- run an idempotent recompute job using historical final decisions
- compare recomputed output with expected fixture cases before enabling participant-facing UI

Backfill source of truth:
- final assessment decisions, not submission state alone

## Test strategy impact
Unit:
- track completion rule evaluation
- expiry aggregation rules
- additive API serializers and filters

Integration:
- participant passes required modules across time and gets track completion
- participant passes only subset and remains `IN_PROGRESS`
- later failing/overridden decision recalculates track status correctly
- reporting/export returns separate and traceable track rows

E2E/manual:
- participant can understand module progress versus track progress
- reporting workspace clearly distinguishes module and track data
- rollback toggle disables track UI without breaking module workflows

## Recommended issue split
Yes, implementation should be split.

Suggested sequence:
1. Schema + repository slice for `CertificationTrack*` and `ParticipantTrackStatus`
2. Track progress service that derives completion from final module decisions
3. Reporting/API slice for read-only composite progress endpoints
4. Participant UI slice for composite progress display
5. Audit/event slice for track status transitions
6. Optional recertification slice for track-level validity/reminders
7. Optional admin-content slice for track configuration

## Final recommendation
Composite certifications are feasible, but only if introduced as a new aggregation layer above existing module assessment.

The lowest-risk path is:
- keep modules as the only assessment unit
- add composite tracks as additive configuration and derived status
- separate module reports from track reports
- defer track-level recertification until after read/write track status is stable
