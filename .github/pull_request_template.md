## Summary
- What is changed and why?

## Linked Issue
- Closes #

## Scope
- In scope:
- Out of scope:

## Design/Architecture Evaluation
- [ ] I evaluated whether design/architecture work is needed before implementation.
- Decision:
- Rationale:
- Link to design note (if applicable):

## Refactor Evaluation
- [ ] I evaluated whether touched code should be refactored to reduce complexity.
- Decision:
- Rationale:
- Follow-up issue (if deferred):

## Configuration-First Check
- [ ] I reviewed hardcoded values and moved evolving rules/settings to configuration where appropriate.
- Config keys/changes:

## Testing Evaluation
- Unit tests: `Added` / `Updated` / `Not needed` (reason)
- Integration tests: `Added` / `Updated` / `Not needed` (reason)
- E2E tests: `Added` / `Updated` / `Not needed` (reason)
- Test evidence (commands/results):

## Documentation Evaluation
- [ ] I evaluated documentation impact.
- Docs updated:
- If not updated, reason + follow-up issue:

## Versioning
- [ ] Version number is bumped for this push.
- [ ] `doc/VERSIONS.md` is updated with this version and summary.

## CI/CD and Deployment
- [ ] CI passed.
- [ ] Change deployed/validated in staging.
- [ ] Production requires human approval and has not been auto-deployed.
- Rollback plan:

## Deployment RCA Guardrails (Required for deploy/runtime changes)
- [ ] I documented one testable root-cause hypothesis before applying the fix.
- [ ] I validated evidence in order: workflow logs -> app settings -> deployed artifact contents -> startup contract -> runtime data-path.
- [ ] I verified deployed artifact contract (entrypoint, runtime scripts, hidden runtime dependencies, prune safety).
- [ ] I verified post-deploy smoke checks (`/healthz` and one critical API path).
- RCA summary (single sentence):
- Evidence links/notes:

## Checklist
- [ ] Acceptance criteria are met.
- [ ] Security/privacy/traceability impacts were reviewed.
- [ ] Observability impact was reviewed.
