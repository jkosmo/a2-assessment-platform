# V2 Readiness Checklist

This checklist is for deciding whether the current solution is ready to be treated as a coherent Version 2 candidate for internal use.

It is intentionally focused on launch readiness, not future enhancement ideas.

## Recommended release posture
Use this checklist before deciding whether to:
- continue iterating in `0.3.x`
- declare an internal pilot candidate such as `0.4.x`
- bump to a more explicit V2 milestone such as `0.5.0`

Recommended rule:
- do not bump to `0.5.0` only because features exist
- bump when the end-to-end solution has been validated in its real operating setup

## 1. Functional end-to-end readiness
- [ ] Participant can load modules, create submission, complete MCQ, and receive result in staging.
- [ ] Participant can view history and completed modules in staging.
- [ ] Participant can create an appeal after a completed result.
- [ ] Reviewer can claim and finalize a manual review in staging.
- [ ] Appeal handler can claim and resolve an appeal in staging.
- [ ] Subject matter owner/admin can create and publish a module version in staging.
- [ ] Calibration workspace can load a real module snapshot in staging.
- [ ] Core reports and CSV export can be exercised in staging without errors.

## 2. Identity and authorization readiness
- [ ] Entra-based authentication flow has been validated in the target environment.
- [ ] Role access is correct for participant, reviewer, appeal handler, report reader, subject matter owner, and administrator.
- [ ] Unauthorized users are rejected from privileged APIs and workspaces.
- [ ] Environment-specific auth config is documented and reproducible.

## 3. Content and operational readiness
- [ ] At least one realistic module is fully configured and published through the admin-content workflow.
- [ ] Required seed/demo content for testing is available in staging.
- [ ] A named owner exists for module content maintenance.
- [ ] A named owner exists for operational monitoring and deploy approval.

## 4. UX readiness
- [ ] `#47` moderated usability plan has been run, or an explicit decision has been recorded to launch with deferred UX discovery.
- [ ] At least one participant journey has been tested end to end by a non-developer.
- [ ] At least one reviewer/admin journey has been tested end to end by a non-developer or operational owner.
- [ ] Module-switch and resume behavior has been tested and judged acceptable.
- [ ] No high-severity UX blockers remain open for the intended pilot scope.

## 5. Data and policy readiness
- [ ] `#36` retention/deletion draft has an approved interim decision for pilot use.
- [ ] Data owner and operational owner are explicitly named.
- [ ] There is a documented response path for audit/data review questions.
- [ ] There is an agreed interim stance on deletion, retention, and legal hold, even if full hardening is deferred.

## 6. Runtime and deployment readiness
- [ ] Staging deploy from `main` is reliable.
- [ ] Production deploy flow with approval gate is understood and documented.
- [ ] `/healthz` and `/version` are checked as part of release verification.
- [ ] Azure environment runbook has been reviewed by the person who will operate the service.
- [ ] Rollback path is understood for app deployment.

## 7. Observability and support readiness
- [ ] Alerts exist and are routed to a monitored email/channel.
- [ ] Team knows where to inspect operational logs.
- [ ] Team knows how to identify assessment queue backlog, LLM failures, and appeal SLA issues.
- [ ] Runbook owner has validated the basic observability flow in staging.

## 8. SQLite acceptance check
- [ ] Team explicitly accepts SQLite as the current runtime choice for the current user/load profile.
- [ ] Team knows the symptoms that would trigger renewed PostgreSQL work from `#91`.
- [ ] No observed `SQLITE_BUSY`, lock contention, or clear write-path bottleneck has appeared in staging testing.
- [ ] No immediate need exists for horizontal scale-out that would make the current file-backed database unsafe.

## 9. Test and quality gate
- [ ] `npm run lint` passes on the release candidate.
- [ ] `npm test` passes on the release candidate.
- [ ] `npm run build` passes on the release candidate.
- [ ] A short staging smoke test has been run against the deployed build, not only locally.
- [ ] No unresolved Sev-1/launch-blocking defects are known.

## 10. Release decision
Treat the solution as V2-ready when all of the following are true:
- [ ] The core role-based workflows work in staging.
- [ ] The operating model is understood by the people who will run it.
- [ ] The remaining open work is consciously deferred, not unknown.
- [ ] Open items like `#36`, `#47`, and `#91` are either accepted for pilot deferment or explicitly planned outside the release.

## Suggested decision outcomes
### Outcome A: Stay in `0.3.x`
Use when:
- staging validation is incomplete
- identity/runtime ownership is still unclear
- major operational questions are still unresolved

### Outcome B: Move to `0.4.x` internal pilot
Use when:
- the platform works end to end in staging
- remaining gaps are known and acceptable for controlled internal use
- usability and policy items are being managed as controlled follow-up work

### Outcome C: Bump to `0.5.0`
Use when:
- the team wants to mark a clear “Version 2 candidate” milestone
- staging validation is complete
- launch owners accept the operating model
- remaining open issues are clearly non-blocking improvements

## Current recommendation
Based on the current repo state, the most sensible next step is:
1. Run a full staging readiness pass with this checklist.
2. Record any blocking findings.
3. If the pass is clean, promote the next release as an internal pilot candidate.
4. Only then decide whether the milestone should be named `0.4.x` or `0.5.0`.
