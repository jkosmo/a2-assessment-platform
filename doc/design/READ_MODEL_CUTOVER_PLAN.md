## Read Model Cutover Plan

Issue: `#253`

### Goal

Move persistence-shaped response building out of the route layer and into module-owned read models so HTTP routes become thin adapters over feature APIs.

### First Cut Scope

This slice intentionally targets the read paths where route-level shaping is still most visible:

- participant submission history
- participant submission result view
- manual review workspace detail
- appeal workspace detail

Queue endpoints are already closer to the desired shape and are not part of this first cut.

### End-State Rules For This Slice

- routes do request parsing, auth checks, and status codes
- modules own response payload shaping for their feature read paths
- JSON parsing, localization, derived status text, and SLA shaping live in modules
- route files stop reaching into raw Prisma include graphs to build view payloads

### Planned Module APIs

#### Submission

- `getOwnedSubmissionHistoryView({ userId, limit, locale })`
- `getOwnedSubmissionResultView(submissionId, userId)`

These functions return the response payloads consumed by `/api/submissions/history` and `/api/submissions/:submissionId/result`.

#### Review

- `getManualReviewWorkspaceView(reviewId, locale)`

This function owns localized module text plus parsed submission response excerpts for `/api/reviews/:reviewId`.

#### Appeal

- `getAppealWorkspaceView(appealId, locale)`

This function owns workspace shaping and SLA projection for `/api/appeals/:appealId`.

### Non-Goals In This Batch

- reporting DTO cutover
- assessment polling DTO cleanup
- full replacement of every repository-shaped return in the codebase

### Verification

- focused integration coverage for participant results/history
- focused integration coverage for manual review and appeal workspaces
- lint
