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

## Infra changes (required when touching `infra/`, `scripts/azure/`, or `.github/workflows/`)

_Skip this section if no infra files are changed._

**Permission and identity**
- [ ] `enableRbacAuthorization` is NOT coupled to any deploy flag — it is always `true`.
- [ ] Role assignment GUIDs are seeded on `principalId`, not `App.id` or other mutable values.
- [ ] If App Services are deleted and recreated, managed identities still have KV access.

**ARM dependency chain**
- [ ] Conditional Bicep resources (`= if (condition)`) have `dependsOn` on all child resources.
- [ ] Switching `parent:` from a deployed resource to an `existing` reference preserves ARM ordering.

**Secret and credential sync**
- [ ] If a credential secret (e.g. `DATABASE-URL`) is updated, the underlying resource is updated in the same deploy — or the existing credential is explicitly reused.

**Production safety**
- [ ] Change works correctly with `SKIP_ROLE_ASSIGNMENTS=true` (current prod workaround).
- [ ] Change works correctly after `SKIP_ROLE_ASSIGNMENTS` is removed (#404).
- [ ] Prod-destructive scripts assert correct subscription/RG before acting.

**Scenario matrix** _(fill in for Bicep changes)_

| Scenario | Expected result |
|----------|----------------|
| Staging — first deploy (fresh env) | |
| Staging — normal deploy | |
| Staging — App Service recreated | |
| Prod — normal deploy (`SKIP_ROLE_ASSIGNMENTS=true`) | |
| Prod — after #404 (`SKIP_ROLE_ASSIGNMENTS` removed) | |
| Prod — recovery after deleted App Service | |
| Prod — PG `ServerIsBusy` | |

- Rollback procedure:

## Checklist
- [ ] Acceptance criteria are met.
- [ ] Security/privacy/traceability impacts were reviewed.
- [ ] Observability impact was reviewed.
