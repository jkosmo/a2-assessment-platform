# Phase 2 Discovery: Usability Analysis and Moderated UX Testing (#47)

## Status
This document prepares moderated usability testing. It does not claim the sessions have been run.

What this note provides:
- task plan
- moderator script
- evidence capture model
- severity model
- backlog conversion template

What still requires humans:
- recruiting representative participants
- running sessions
- collecting evidence
- creating follow-up implementation issues from observed findings

## Goal
Validate whether the current MVP supports efficient task completion, clear navigation, and reliable recovery across:
- participant assessment flow
- admin/reviewer workflows
- module switching and resume behavior

## Test environments and prerequisites
Use staging if available; otherwise local with seeded baseline data.

Required baseline:
- at least two published modules are available
- at least one manual review exists in queue
- at least one appeal exists or can be created during setup
- one subject matter owner/admin identity is available for content and calibration tasks

Suggested test URLs:
- `/participant`
- `/participant/completed`
- `/manual-review`
- `/appeal-handler`
- `/admin-content`
- `/calibration`

## Participant profile mix
Minimum recommended sample:
- 2 participants who are new to the workflow
- 1 reviewer or quality owner
- 1 subject matter owner or admin-content user

If only one round is possible, prioritize:
- 2 participant sessions
- 1 reviewer/admin session

## Critical tasks
Run 5-8 tasks total. Minimum set below covers the issue scope.

### Participant tasks
1. Load available modules, choose a module, and explain what the next required step is.
2. Create a submission and complete the MCQ flow.
3. Observe assessment progress and retrieve the result without facilitator help.
4. Switch to another module mid-flow, then return and resume the original module correctly.
5. Locate prior completion/history using `/participant/completed` or history on `/participant`.
6. Create an appeal after a completed result and explain what happens next.

### Reviewer/admin tasks
7. Open `/manual-review`, find a relevant case, claim it, and finalize an override.
8. Open `/admin-content`, identify where a rubric/prompt/module version is created and where publication happens.

Optional SME task:
9. Open `/calibration`, load a module snapshot, and explain what quality signals mean and what action you would take.

## Success metrics
Capture at least:
- task success: completed / completed with help / failed
- time on task
- wrong turns or dead ends
- number of clarification prompts asked
- visible hesitation points
- user confidence rating after each task (1-5)

Recommended benchmark:
- participant critical tasks should usually complete without facilitator intervention
- no task should require hidden knowledge about mock identities, debug features, or API semantics

## Moderator script
### Opening
Use this framing:
- "We are testing the product, not you."
- "Please think aloud while you work."
- "If something is confusing, say it immediately."
- "I will avoid helping unless you become blocked."

### Ground rules
- ask users to work from the visible UI only
- do not explain workflow steps unless the participant is fully blocked
- note first-click choices and moments of hesitation
- if blocked, ask: "What are you looking for right now?"

### Closing prompts
After the session, ask:
- "What felt easiest?"
- "What felt most confusing?"
- "Was there any point where you were unsure whether the system had accepted your action?"
- "If you had to do this again tomorrow, what would still feel risky or slow?"

## Evidence capture template
For each task, record:
- participant type
- environment and build version
- task ID
- outcome
- time to completion
- first wrong turn
- observed confusion point
- direct quote
- screenshot or screen recording timestamp
- severity candidate
- recommended change

## Severity model
Use this scale:
- `S1 Critical`: blocks task completion or creates high risk of incorrect irreversible action
- `S2 High`: task can complete, but with major confusion, repeated retries, or facilitator rescue
- `S3 Medium`: noticeable friction, hesitation, or poor information scent, but recoverable
- `S4 Low`: cosmetic or wording issue that does not materially slow completion

## Known focus areas for this product
Prioritize observation around:
- role identity setup clarity in mock-mode workspaces
- whether the participant understands the step indicator and flow gating
- whether module selection and module switching are understandable
- whether result, history, and appeal pathways are discoverable
- whether queue filters/search/status pills are understandable without explanation
- whether admin-content steps 1-6 feel like one coherent workflow
- whether calibration outputs are interpretable by non-developers

## Module-switch scenario script
This is explicitly required by the issue.

Scenario:
1. Start on `/participant`.
2. Load modules and pick Module A.
3. Enter partial submission text but do not finish the full workflow.
4. Switch to Module B.
5. Ask the participant:
   - what they expect to happen to their previous draft/state
   - how they would get back to Module A
6. Have them return to Module A and resume.
7. Record:
   - whether they expected data loss
   - whether the selected module state was visible enough
   - whether draft recovery was understandable
   - whether any unexpected lock/unlock state appeared

## Analysis output format
After running sessions, produce a short findings report with:
- task summary table
- findings ordered by severity
- evidence quotes
- affected roles/pages
- recommended fix
- issue split recommendation

## Backlog conversion template
For each confirmed issue, create a GitHub issue containing:
- summary
- affected role/workspace
- evidence quote or observation
- severity
- reproduction path
- expected behavior
- recommended fix direction

Priority mapping:
- `S1` -> immediate
- `S2` -> next active batch
- `S3` -> scheduled UX debt
- `S4` -> opportunistic cleanup

## Recommended execution sequence
1. Run two participant sessions first.
2. Review findings and confirm whether module switching is still the top UX risk.
3. Run one reviewer/admin session.
4. Aggregate findings into a prioritized backlog.
5. Create follow-up issues only after evidence is captured.

## Recommendation
Use this note as the operating script for the discovery work.

The issue should remain open until:
- sessions are actually run
- at least one participant and one admin/reviewer path are tested end to end
- findings are documented with severity and evidence
- follow-up issues are created and linked
