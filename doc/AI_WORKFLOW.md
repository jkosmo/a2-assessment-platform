# AI Implementation Workflow

## Purpose
This document defines how the AI coding agent should execute implementation work for each GitHub issue in this repository.

Goals:
- Keep delivery fast and pragmatic.
- Reduce long-term complexity.
- Prefer configuration over hardcoded behavior.
- Maintain high quality through automation, testing, and documentation.
- Support safe releases with staging and production environments.

## Scope
This workflow applies to:
- All feature, tech, security, data, ops, and discovery issues.
- MVP and post-MVP work.
- Backend, frontend, integrations, infrastructure, and documentation updates.

## Core Principles
- Design before implementation when risk or complexity justifies it.
- Refactor when touching complex code to lower total complexity.
- Configuration-first: avoid hardcoded business rules, thresholds, IDs, and toggles.
- Small, reviewable changes with clear acceptance criteria.
- Automation-first CI/CD for build, test, security checks, and deployment.
- Human approval gate before production deployment.
- Keep GitHub issue status aligned with the real implementation state.

## Issue Execution Workflow

### 1. Understand the issue
- Confirm purpose, scope, acceptance criteria, and dependencies.
- Map impacted components and files.
- Identify unknowns, assumptions, and risks.
- Compare the issue description with the current codebase before starting implementation.
- If the issue is already partially or fully implemented, update the issue status first instead of continuing from stale assumptions.

### 2. Design and architecture gate
For every issue, explicitly evaluate whether design work is needed before coding.

Create a lightweight design note (in issue comment or doc) if any of these are true:
- New domain model, API contract, or integration boundary is introduced.
- Existing architecture constraints are affected.
- Security, traceability, or compliance behavior changes.
- Change touches multiple modules or has high blast radius.

Design note should include:
- Context and problem statement.
- Options considered and trade-offs.
- Chosen approach and rationale.
- Data, API, and operational impact.
- Rollout and rollback considerations.

### 3. Refactor evaluation gate
Before implementation, evaluate if touched code should be refactored.

Refactor when:
- Logic is duplicated or tightly coupled.
- Functions or classes have unclear responsibility.
- Cyclomatic complexity is high.
- Hardcoded values can be moved to config.

Rule:
- Do opportunistic refactoring in the same issue only when it directly reduces risk and complexity.
- If refactoring is larger than the issue scope, create a separate follow-up issue and document why.

### 4. Implementation plan
Define the minimal change set that satisfies acceptance criteria:
- Code changes.
- Config changes.
- Database or schema changes.
- Infrastructure/pipeline changes.
- Test and documentation updates.

### 5. Implement
- Keep code modular and explicit.
- Avoid hidden side effects.
- Keep business rules in one place.
- Preserve traceability requirements.
- Ensure LLM outputs are treated as structured input, not final decision authority.

### 6. Validate locally and in CI
Run relevant checks before merge:
- Lint and formatting.
- Build/compile.
- Unit tests.
- Integration tests when applicable.
- Security and dependency checks where configured.

### 7. Deployment workflow (CI/CD)
CI/CD should be fully automated except production approval.

Required flow:
1. Pull request triggers CI checks.
2. Merge to main triggers automatic deploy to staging.
3. Smoke tests run in staging.
4. Production deploy requires explicit human approval.
5. Production deployment and post-deploy verification are logged.

Environment policy:
- Staging: AI services and app components can auto-deploy.
- Production: manual approval gate is mandatory before deploy.

### 8. Post-implementation review
For every issue, explicitly evaluate:
- Is new or updated unit testing needed?
- Is integration or end-to-end testing needed?
- Is documentation update needed?

If answer is yes, include the work in the same PR when feasible.
If deferred, create a follow-up issue with reason and priority.

### 9. Issue status hygiene
GitHub issues must reflect the current implementation state, not only the original plan.

Before implementation:
- Verify whether the issue is still fully open, partially implemented, or already complete.
- If the codebase no longer matches the issue description, update the issue body, checklist, or comments with the current status before doing more work.
- If only part of the original scope remains, narrow the issue to the remaining work or split out follow-up issues.

After partial implementation:
- Update the issue with what was completed, what remains, and any acceptance criteria that are now satisfied.
- Link the relevant PR, commit, design note, or deployment evidence.
- If scope changed during implementation, record the reason and the new boundary clearly.

After completion:
- When all acceptance criteria appear implemented but have not yet been confirmed by a human, mark the issue as ready for human verification and keep it open.
- Once a human has verified the implementation, update the issue with the verification result and close it.
- If human verification finds gaps, reopen or keep the issue open and document the remaining work explicitly.

## Deploy/Runtime Incident Workflow (RCA-First)
Use this flow for persistent staging/production deployment failures. Do not keep patching the latest visible symptom.

### 1. Single hypothesis first
- Write one testable root-cause hypothesis before changing code.
- State what evidence would confirm or falsify it.

### 2. Evidence order (mandatory)
Collect evidence in this order:
1. Workflow/job logs.
2. Effective runtime/app settings in target environment.
3. Deployed artifact contents (what is actually in the package).
4. Startup contract validation (entrypoint, prestart/start behavior, port/probe assumptions).
5. Runtime data-path verification (DB/API behavior).

### 3. Artifact contract check (for package deployments)
Verify deployment artifact is self-contained and startup-safe:
- Compiled entrypoint exists at expected path.
- Runtime scripts required at startup exist.
- Hidden runtime dependencies are present (for example Prisma `.prisma` artifacts).
- Runtime dependencies remain valid after pruning.

### 4. Change budget per iteration
- Make at most one deployment-affecting change per iteration.
- Re-run deploy and capture outcomes against the same evidence checklist.
- If two consecutive attempts fail, stop and reset with a new hypothesis and evidence matrix.

### 5. Post-deploy smoke gate
A deployment is not considered complete until smoke checks pass:
1. Health endpoint is `200`.
2. Critical API smoke path returns expected baseline data in staging.

### 6. Escalation rule
Escalate when:
- No convergence after 45 minutes, or
- Two hypotheses are contradicted by evidence.

Escalation output must include:
- Current best root-cause statement.
- Evidence collected.
- What was ruled out.
- Smallest next experiment.

## Configuration-First Policy
Move frequently changing behavior to config instead of code:
- Thresholds and scoring parameters.
- Feature flags and rollout toggles.
- Prompt template/version references.
- Module/rubric/MCQ metadata references.
- Timeouts, retry limits, and queue settings.

Do not hardcode:
- Secrets, keys, or environment-specific URLs.
- Business policy values expected to evolve.

## Testing Policy
Testing is mandatory evaluation for each issue.

Verification responsibilities:
- Codex verifies code structure, API behavior, automated tests, and other non-visual runtime behavior that can be checked from the repository or terminal.
- Human verifies UI behavior, layout, wording, interaction clarity, and other browser-observed outcomes.
- For mixed issues, Codex completes backend/API verification first, then the human performs final UI verification before close-out.
- When Codex provides a manual UI test script, the steps must be explicitly numbered so findings can be referenced back by step number.

Minimum expectations:
- Unit tests for core logic changes.
- Integration tests for API, data, and workflow boundaries.
- E2E tests for critical user journeys when UI or cross-service flow changes.

Critical flows that should have strong automated coverage:
- Login and authorization.
- Submission and MCQ scoring.
- LLM response validation and decision calculation.
- Manual review and appeal resolution.
- Reporting output correctness.

## Documentation Policy
Each issue must evaluate documentation impact.

Update relevant docs when behavior changes:
- API contracts.
- Data model and migration notes.
- Config keys and operational settings.
- Runbooks and incident response notes.
- User/admin workflow guidance.
- GitHub issue status, checklist state, and close-out notes when implementation status has changed.

## Versioning Policy
- A version number must be bumped before every push to remote.
- Semantic Versioning (`MAJOR.MINOR.PATCH`) must be used.
- The version bump must be reflected in `doc/VERSIONS.md` with a short change summary.

## Definition of Done (per issue)
- Acceptance criteria met and verified.
- Design/architecture evaluation completed.
- Refactor evaluation completed.
- Hardcoded values reviewed and moved to config where appropriate.
- Required tests implemented and passing.
- CI checks green.
- Staging deploy successful.
- Production approval requirement respected.
- Documentation updated or follow-up issue created.
- GitHub issue updated to reflect actual implementation status.
- If only partially complete, remaining scope is documented and the issue stays open.
- If human-verified complete, verification result is recorded and the issue is closed.
- Version number bumped for this push and `doc/VERSIONS.md` updated.

## Pull Request Checklist
- Linked issue and scope are clear.
- Linked issue status matches the actual implementation state.
- Design decision is documented when required.
- Refactor decision is documented.
- Config updates are included and validated.
- Test coverage impact is described.
- Docs impact is described.
- Rollback considerations are noted.
- For deploy/runtime changes, RCA hypothesis and artifact/startup evidence are included.
