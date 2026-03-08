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

## Issue Execution Workflow

### 1. Understand the issue
- Confirm purpose, scope, acceptance criteria, and dependencies.
- Map impacted components and files.
- Identify unknowns, assumptions, and risks.

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
- Version number bumped for this push and `doc/VERSIONS.md` updated.

## Pull Request Checklist
- Linked issue and scope are clear.
- Design decision is documented when required.
- Refactor decision is documented.
- Config updates are included and validated.
- Test coverage impact is described.
- Docs impact is described.
- Rollback considerations are noted.
