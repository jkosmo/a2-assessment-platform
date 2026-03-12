# Versions

This document tracks release versions and what each version includes.

## Versioning Rules
- Use Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Every push to remote must include a version bump.
- Every version bump must update this document.

## 0.3.112 - 2026-03-12
### Summary
Improved participant submission UX, redesigned the admin content workspace around live/draft module status, and added draft JSON import plus LLM authoring guidance for content owners.

### Included
- Simplified participant submission labels and reduced field-clutter while showing selected-module description:
  - `public/participant.html`
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Redesigned the top of the admin content workspace around module status, human-readable version chains, and clearer action grouping:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added draft JSON import support for both exported module bundles and simpler authoring drafts:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added design and authoring support documents for the new admin-content workflow:
  - `doc/PHASE2_ADMIN_CONTENT_WORKSPACE_V2_DESIGN.md`
  - `doc/MODULE_DRAFT_JSON_AUTHORING_PROMPT.md`
- Updated regression coverage for participant/admin workspace HTML and translations:
  - `test/participant-console-config.test.ts`
  - `test/workspace-validation-accessibility.test.js`
  - `test/admin-content-translations.test.js`
  - `test/participant-translations.test.js`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-validation-accessibility.test.js test/admin-content-translations.test.js test/participant-translations.test.js test/m2-admin-content-publication.test.ts`

## 0.3.111 - 2026-03-11
### Summary
Fixed the participant workspace so published module assignment text and submission guidance are shown before a participant creates a submission.

### Included
- Extended module list responses with localized active-version task and guidance text:
  - `src/repositories/moduleRepository.ts`
- Preserved selected module content in participant state helpers:
  - `public/participant-console-state.js`
- Added an assignment brief block to the participant submission step:
  - `public/participant.html`
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Added regression coverage for participant state, translations, config HTML, and localized module payloads:
  - `test/participant-console-state.test.js`
  - `test/participant-translations.test.js`
  - `test/participant-console-config.test.ts`
  - `test/m2-i18n-baseline.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-state.test.js test/participant-translations.test.js test/participant-console-config.test.ts test/m2-i18n-baseline.test.ts`

## 0.3.110 - 2026-03-11
### Summary
Added admin-content readback/export support for saved module configuration and improved participant MCQ readability with clearer question grouping and option alignment.

### Included
- Added module export/readback support in the admin content backend:
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - `src/repositories/adminContentRepository.ts`
- Added `Load selected content` and `Export selected module` actions in the admin content workspace:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Improved MCQ presentation in the participant workspace with structured question cards and aligned answer options:
  - `public/participant.js`
  - `public/static/shared.css`
- Added regression coverage for module export/readback and participant/admin workspace assets:
  - `test/unit/admin-content-service.test.ts`
  - `test/m2-admin-content-publication.test.ts`
  - `test/admin-content-translations.test.js`
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/m2-admin-content-publication.test.ts test/unit/admin-content-service.test.ts test/admin-content-translations.test.js test/participant-console-config.test.ts`

## 0.3.109 - 2026-03-11
### Summary
Improved the admin content workspace for multilingual module setup by making the module title field JSON-friendly, and added guarded module deletion so empty modules can be cleaned up safely.

### Included
- Replaced the module title input with a multiline textarea in the admin content workspace:
  - `public/admin-content.html`
- Added delete-selected-module action in the admin content workspace UI:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added guarded backend delete support for modules with dependency checks and audit logging:
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - `src/repositories/adminContentRepository.ts`
- Added regression coverage for translations, service behavior, and integration behavior:
  - `test/admin-content-translations.test.js`
  - `test/unit/admin-content-service.test.ts`
  - `test/m2-admin-content-publication.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/m2-admin-content-publication.test.ts test/unit/admin-content-service.test.ts test/admin-content-translations.test.js`

## 0.3.108 - 2026-03-11
### Summary
Added a V2 readiness checklist to support a go/no-go decision on whether the current platform state should stay in `0.3.x`, move to an internal-pilot `0.4.x`, or be promoted to a clearer V2 milestone such as `0.5.0`.

### Included
- Added release-readiness checklist covering:
  - functional end-to-end validation
  - auth/RBAC
  - content ownership
  - UX/usability validation
  - policy and retention readiness
  - deployment/observability
  - SQLite acceptance criteria
  - release decision outcomes
  - `doc/V2_READINESS_CHECKLIST.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.107 - 2026-03-11
### Summary
Updated the PostgreSQL migration backlog stance for `#91`: SQLite remains the chosen runtime for now, with PostgreSQL deferred to `Pri-4 / Version X` unless concrete operational symptoms appear.

### Included
- Extended PostgreSQL migration note with:
  - explicit defer decision for the current small, non-critical workload
  - symptom list that should trigger re-evaluation
  - `doc/POSTGRES_MIGRATION_PLAN.md`
- Updated architecture note to reflect the accepted temporary deferment:
  - `doc/ARCHITECTURE.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.106 - 2026-03-11
### Summary
Progressed `#91` with a repo-specific PostgreSQL migration plan covering Prisma provider alignment, script replacement, CI changes, Azure runtime wiring, rollback boundaries, and phased verification.

### Included
- Added PostgreSQL migration plan:
  - `doc/POSTGRES_MIGRATION_PLAN.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.105 - 2026-03-11
### Summary
Progressed `#47` with a moderated usability test plan covering participant and admin/reviewer journeys, module-switch/resume behavior, evidence capture, severity scoring, and backlog conversion guidance.

### Included
- Added usability test plan:
  - `doc/PHASE2_USABILITY_TEST_PLAN.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.104 - 2026-03-11
### Summary
Progressed `#36` with a retention/deletion policy hardening draft that maps current assessment data categories to proposed retention windows, technical controls, ownership, and implementation slices pending legal approval.

### Included
- Added retention policy hardening draft:
  - `doc/PHASE2_RETENTION_POLICY_HARDENING.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.103 - 2026-03-11
### Summary
Completed `#42` by finishing the Azure environment runbook with explicit redeploy, teardown, and cost-review procedures to match the existing IaC/workflow automation baseline.

### Included
- Extended Azure environment runbook with:
  - redeploy steps for staging and production
  - teardown commands for dedicated staging/production resource groups
  - recurring cost-review checklist
  - `doc/AZURE_ENVIRONMENTS.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.102 - 2026-03-11
### Summary
Progressed `#68` with a discovery note for composite certifications built from module sets, covering architecture options, risk/mitigation, phased rollout, rollback, complexity assessment, and recommended issue splitting.

### Included
- Added composite-certification discovery note:
  - `doc/V3_COMPOSITE_CERTIFICATIONS_DISCOVERY.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.101 - 2026-03-11
### Summary
Progressed `#69` with a design note for dynamic rubric criteria, including options/trade-offs, legacy migration strategy, phased rollout, rollback, complexity assessment, and test strategy.

### Included
- Added dynamic rubric criteria design note:
  - `doc/PHASE2_DYNAMIC_RUBRIC_CRITERIA_DESIGN.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.100 - 2026-03-11
### Summary
Completed `#76` by extending the HTML i18n fallback regression coverage to the `manual-review` workspace and confirming there are no remaining blank `data-i18n` elements across the current workspace HTML pages.

### Included
- Extended workspace HTML fallback regression coverage to include:
  - `public/manual-review.html`
  - `test/workspace-html-fallbacks.test.js`

### Verification
- `npm run lint`
- `npm test -- test/workspace-html-fallbacks.test.js test/participant-console-config.test.ts test/participant-translations.test.js test/workspace-validation-accessibility.test.js`

## 0.3.99 - 2026-03-11
### Summary
Implemented `#79` by adding an accessible step progress indicator to the participant assessment flow so users can see where they are in the sequence from identity to assessment.

### Included
- Added participant-only progress indicator markup and styles:
  - `public/participant.html`
- Updated participant flow rendering so the active/completed/pending step updates as the flow advances:
  - `public/participant.js`
- Added participant translation keys for step labels and progress summary text:
  - `public/i18n/participant-translations.js`
- Added regression coverage ensuring the progress indicator is present only on the participant page:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/participant-translations.test.js test/workspace-html-fallbacks.test.js test/workspace-validation-accessibility.test.js`

## 0.3.98 - 2026-03-11
### Summary
Completed `#73` by locking accessible validation hint and error styling into the shared workspace CSS and adding regression tests for hint/error/ARIA wiring across participant, appeal-handler, and manual-review.

### Included
- Added a shared warning-state helper class alongside the existing hint, error, success, and invalid-field styles:
  - `public/static/shared.css`
- Added regression coverage verifying:
  - hint/error/success/invalid styles remain present in shared CSS
  - `aria-describedby` wiring remains intact for participant and reviewer validation fields
  - runtime code keeps `role="alert"` and invalid-field hooks for validation errors
  - `test/workspace-validation-accessibility.test.js`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js test/workspace-validation-accessibility.test.js`

## 0.3.97 - 2026-03-11
### Summary
Implemented `#74` by replacing default raw JSON output on the participant and appeal-handler pages with toast notifications, while keeping expandable raw response details for admin-content and calibration.

### Included
- Added shared toast assets:
  - `public/static/toast.css`
  - `public/static/toast.js`
- Replaced default participant response logging with toast notifications and moved raw response output behind `?debug=1`:
  - `public/participant.html`
  - `public/participant.js`
- Replaced default appeal-handler response logging with toast notifications and moved raw response output behind `?debug=1`:
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
- Kept admin-content and calibration raw responses as explicit expandable details:
  - `public/admin-content.html`
  - `public/calibration.html`
- Added regression coverage for toast assets, hidden debug output sections, and raw response summaries:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js`

## 0.3.96 - 2026-03-11
### Summary
Implemented `#72` by adding reusable loading and empty-state feedback for data-fetching sections in the participant, appeal-handler, and calibration workspaces.

### Included
- Added shared loading helpers and styles:
  - `public/static/loading.css`
  - `public/static/loading.js`
- Added loading skeletons and empty-state messages to participant data-fetch sections:
  - module loading
  - assessment progress checks
  - submission history
- Added queue loading and empty-state rendering to the appeal-handler queue:
  - `public/appeal-handler.js`
  - `public/appeal-handler.html`
- Added loading and empty-state rendering to calibration signals, outcomes, and benchmark anchors:
  - `public/calibration.js`
  - `public/calibration.html`
- Added participant translation keys for initial and post-load module empty states:
  - `public/i18n/participant-translations.js`
- Added regression coverage for loading assets and workspace page linkage:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js`

## 0.3.95 - 2026-03-11
### Summary
Implemented `#92` by removing the redundant manual queue-load controls from the appeal-handler and manual-review workspaces, keeping queue refresh automatic and filter-driven.

### Included
- Removed redundant queue-load buttons from:
  - `public/appeal-handler.html`
  - `public/manual-review.html`
- Kept queue loading automatic on page load and status-filter changes while preserving guarded reload behavior in:
  - `public/appeal-handler.js`
  - `public/manual-review.js`
- Updated workspace copy so it no longer implies a manual load step:
  - automatic-refresh hint text
  - queue empty-state messages
  - queue updated status messages
- Added markup regression checks ensuring the removed buttons do not reappear:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js`

## 0.3.94 - 2026-03-11
### Summary
Implemented `#88` by adding inline `en-GB` fallback copy to workspace HTML so `data-i18n` content is legible on initial render before JavaScript runs.

### Included
- Updated static workspace HTML with inline English fallback copy:
  - `public/participant.html`
  - `public/admin-content.html`
  - `public/appeal-handler.html`
  - `public/calibration.html`
  - `public/participant-completed.html`
- Added regression coverage:
  - `test/workspace-html-fallbacks.test.js`
- Verified placeholder fallbacks for workspace filters that depend on `data-i18n-placeholder`

### Verification
- `npm run lint`
- `npm test -- test/workspace-html-fallbacks.test.js test/participant-console-config.test.ts`

## 0.3.93 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `recertificationService.ts`, focusing on decision-driven status upserts, lifecycle status derivation, and scheduled reminder delivery with duplicate-send protection.

### Included
- New unit test:
  - `test/unit/recertification-service.test.ts`
- Added service-level unit coverage for:
  - missing-decision validation during recertification upsert
  - passing-decision recertification date/status computation
  - `deriveRecertificationStatus()` due-soon lifecycle behavior
  - reminder-schedule processing with sent/skipped counters and duplicate-send protection

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.92 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `orgSyncService.ts`, focusing on delta-sync outcome counting, create/update behavior, strict conflict failure handling, and org-sync audit/operational logging.

### Included
- New unit test:
  - `test/unit/org-sync-service.test.ts`
- Added service-level unit coverage for:
  - create/update/re-key behavior during delta sync
  - strict conflict failure handling when email and external ID disagree
  - org-sync completion summary counts
  - failed-record audit logging and operational event logging

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.91 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `calibrationWorkspaceService.ts`, targeting snapshot assembly, benchmark-anchor extraction, signal calculation, and calibration audit logging.

### Included
- New unit test:
  - `test/unit/calibration-workspace-service.test.ts`
- Added service-level unit coverage for:
  - missing-module validation
  - outcome mapping from submission data
  - benchmark-anchor extraction from prompt-template example payloads
  - calibration signal and threshold-flag computation
  - calibration workspace access audit logging

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.90 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `adminContentService.ts`, focusing on validation, dependency checks, benchmark prompt enrichment, and publication auditing.

### Included
- New unit test:
  - `test/unit/admin-content-service.test.ts`
- Added service-level unit coverage for:
  - module date validation
  - module creation audit logging
  - module-version dependency mismatch validation
  - benchmark example prompt enrichment and audit logging
  - module-version publication audit metadata including previous active version

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.89 - 2026-03-11
### Summary
Continued `#84` by adding focused unit coverage for `reportingService.ts`, targeting service-layer aggregation, filtering, MCQ quality flagging, and CSV serialization behavior.

### Included
- New unit test:
  - `test/unit/reporting-service.test.ts`
- Added service-level unit coverage for:
  - pass-rate aggregation filtered by requested outcome
  - MCQ quality flagging for easy/low-discrimination questions
  - CSV export escaping for commas, quotes, and null values

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.88 - 2026-03-11
### Summary
Continued `#84` by adding focused unit coverage for `submissionService.ts`, especially the submission-creation path that combines module lookup, document parsing, persistence, audit logging, and operational logging.

### Included
- New unit test:
  - `test/unit/submission-service.test.ts`
- Added service-level unit coverage for:
  - validation failure when no published active module version exists
  - successful submission creation from parsed attachment text
  - propagation of locale, attachment, and submission status into repository persistence
  - audit and operational logging side effects after successful submission creation

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.87 - 2026-03-11
### Summary
Expanded `#84` with the first additional unit-test slice for workflow-heavy services by covering `appealService.ts` and `manualReviewService.ts`.

### Included
- New unit tests:
  - `test/unit/appeal-service.test.ts`
  - `test/unit/manual-review-service.test.ts`
- Added service-level unit coverage for:
  - appeal creation validation when the submission is missing
  - appeal creation happy path with notification failure tolerance
  - appeal claim conflict when a case is already assigned
  - appeal resolution happy path with immutable decision creation and recertification update
  - manual review claim validation for missing/already-assigned cases
  - manual review override validation when no decision exists
  - manual review override happy path with decision creation, completion update, and audit side effects

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.86 - 2026-03-11
### Summary
Refactored background processing for `#90` so the assessment worker and appeal SLA monitor use injectable lifecycle classes instead of module-level singleton state in service files.

### Included
- New background lifecycle classes:
  - `src/services/AssessmentWorker.ts`
  - `src/services/AppealSlaMonitor.ts`
- Service-layer refactor:
  - `src/services/assessmentJobService.ts`
  - removed module-level worker timer/running state
  - exported `processNextJob()` for direct worker execution
  - `src/services/appealSlaMonitorService.ts`
  - removed module-level monitor timer/running state
- Bootstrap update:
  - `src/index.ts`
  - application startup now instantiates `AssessmentWorker` and `AppealSlaMonitor`
  - graceful shutdown stops the instantiated worker and monitor
- Test coverage:
  - `test/unit/assessment-worker.test.ts`
  - `test/unit/appeal-sla-monitor.test.ts`
  - `test/assessment-worker-process-error.test.ts`
  - updated to verify the new instanced worker contract
- Documentation update:
  - `doc/ARCHITECTURE.md`
  - background-processing section now reflects injectable lifecycle ownership

### Verification
- `npm run lint`
- `npm run test:unit`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/assessment-worker-process-error.test.ts test/m2-appeal-sla-monitor.test.ts test/m1-core-flow.test.ts`

## 0.3.85 - 2026-03-11
### Summary
Completed the service-layer repository migration in `#80`, so service files no longer import Prisma directly, and updated the architecture documentation to match the new data-access boundary.

### Included
- New repository:
  - `src/repositories/certificationRepository.ts`
- Additional repositories:
  - `src/repositories/reportingRepository.ts`
  - `src/repositories/calibrationRepository.ts`
  - `src/repositories/adminContentRepository.ts`
- Repository extensions:
  - `src/repositories/decisionRepository.ts`
  - `src/repositories/auditRepository.ts`
  - `src/repositories/userRepository.ts`
  - `src/repositories/appealRepository.ts`
- Service migrations:
  - `src/services/recertificationService.ts`
  - `src/services/orgSyncService.ts`
  - `src/services/appealSlaMonitorService.ts`
  - `src/services/reportingService.ts`
  - `src/services/calibrationWorkspaceService.ts`
  - `src/services/adminContentService.ts`
  - removed direct Prisma access from all remaining service files
  - routed recertification status reads/writes through repository boundaries
  - routed org delta sync user lookup/update/create through `userRepository`
  - routed SLA monitor backlog queries through `appealRepository`
  - routed reporting, calibration, and admin-content reads/writes through dedicated repositories
- Unit coverage:
  - `test/unit/certification-repository.test.ts`
- Documentation update:
  - `doc/ARCHITECTURE.md`
  - updated the data-access section to reflect that services now depend on repositories rather than direct Prisma imports

### Verification
- `npm run lint`
- `npm run test:unit`
- `npm run pretest`
- `npm run test:integration`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/m2-org-sync.test.ts test/m2-recertification-flow.test.ts test/m2-appeal-sla-monitor.test.ts`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/m2-reporting.test.ts`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/m2-calibration-workspace.test.ts test/m2-admin-content-publication.test.ts`

## 0.3.84 - 2026-03-11
### Summary
Clarified the verification split between Codex and the human reviewer in the AI workflow.

### Included
- Workflow documentation update:
  - `doc/AI_WORKFLOW.md`
  - added explicit verification responsibilities:
    - Codex verifies code structure, API behavior, and automated tests
    - human verifies UI behavior and browser-observed outcomes
    - mixed issues follow backend/API verification first, then final human UI verification

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.83 - 2026-03-11
### Summary
Added a permanent architecture overview and clarified the README introduction so the system purpose and core functional scope are easier to understand.

### Included
- Documentation additions:
  - `doc/ARCHITECTURE.md`
  - added a stable architecture reference covering purpose, core domain flow, main components, workspaces, technologies/products/standards, deployment shape, and known architectural debt
- README clarification:
  - `README.md`
  - added explicit sections for solution purpose and core functionality
  - added a direct link to `doc/ARCHITECTURE.md`

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.82 - 2026-03-11
### Summary
Expanded the unit-test path with SLA and decision-service coverage and added dedicated unit/integration Vitest entrypoints.

### Included
- Unit test additions:
  - `test/unit/appeal-sla.test.ts`
  - `test/unit/decision-service.test.ts`
  - `test/unit/submission-repository.test.ts`
  - `test/unit/appeal-repository.test.ts`
  - `test/unit/assessment-job-repository.test.ts`
  - `test/unit/manual-review-repository.test.ts`
  - `test/unit/mcq-repository.test.ts`
  - `test/unit/decision-repository.test.ts`
  - `test/unit/audit-repository.test.ts`
  - added SLA boundary coverage for on-track, at-risk, overdue, and resolved appeals
  - added mocked Prisma coverage for `createAssessmentDecision()`
- Repository migration slice:
  - `src/repositories/submissionRepository.ts`
  - `src/repositories/appealRepository.ts`
  - `src/repositories/assessmentJobRepository.ts`
  - `src/repositories/manualReviewRepository.ts`
  - `src/repositories/mcqRepository.ts`
  - `src/repositories/decisionRepository.ts`
  - `src/repositories/auditRepository.ts`
  - `src/repositories/moduleRepository.ts`
  - `src/services/submissionService.ts`
  - `src/services/appealService.ts`
  - `src/services/assessmentJobService.ts`
  - `src/services/manualReviewService.ts`
  - `src/services/mcqService.ts`
  - `src/services/decisionService.ts`
  - `src/services/auditService.ts`
  - migrated submission, appeal, assessment-job, manual-review, MCQ, decision, and audit data access out of services into repositories
- Test execution split:
  - `vitest.unit.config.ts`
  - `vitest.integration.config.ts`
  - `package.json`
  - added `test:unit` and `test:integration` scripts while leaving `test` unchanged

### Verification
- Focused unit validation planned for the new unit suite and related no-DB tests

## 0.3.81 - 2026-03-11
### Summary
Clarified the AI workflow so GitHub issues must be updated when work is partially implemented and only closed after human verification.

### Included
- Workflow policy updates:
  - `doc/AI_WORKFLOW.md`
  - added explicit issue-status hygiene rules before implementation, after partial implementation, and after completion
  - required the issue tracker to reflect actual implementation status rather than the original plan
  - clarified that human-verified complete issues should be updated and then closed

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.80 - 2026-03-11
### Summary
Refreshed README documentation so the documented workspace routes, manual-review workflow, reviewer defaults, and participant auto-assessment behavior now match the current implementation.

### Included
- README accuracy updates:
  - `README.md`
  - corrected manual-review API action from `POST /api/reviews/:reviewId/resolve` to `POST /api/reviews/:reviewId/override`
  - added the dedicated `/manual-review` workspace route to the documented UI surface
  - added a manual testing section for the reviewer workspace
  - documented `manualReviewWorkspace.queuePageSize` and `identityDefaults.reviewer`
  - corrected participant auto-start documentation to reflect that manual fallback assessment controls remain visible

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.79 - 2026-03-10
### Summary
Separated manual review from appeals into its own reviewer workspace, restored `appeal-handler` to an appeals-only queue, clarified the workspace scope in UI copy, and seeded a pending manual-review case so the reviewer queue is not empty in a standard environment.

### Included
- Dedicated manual review workspace:
  - `public/manual-review.html`
  - `public/manual-review.js`
  - `public/i18n/manual-review-translations.js`
  - added a standalone queue and detail workspace for `/api/reviews`
  - supports reviewer identity, queue filtering, claim, and override flows
- Runtime config and navigation:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - `src/app.ts`
  - added `manual-review` navigation item, `manualReviewWorkspace` runtime config, reviewer identity defaults, and a `/manual-review` page route
- Appeal workspace clarification:
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
  - `public/i18n/appeal-handler-translations.js`
  - removed manual-review queue filtering from `appeal-handler`
  - clarified that appeal handling only covers appeals
  - simplified manual-review context in appeal details so submissions without manual-review history no longer show a full block of placeholder fields
- Appeal queue payload rollback:
  - `src/services/appealService.ts`
  - removed latest-manual-review data from the appeal queue list payload
- Seeded reviewer workflow visibility:
  - `prisma/seed.ts`
  - added explicit reviewer and appeal-handler users with role assignments
  - added one seeded pending `OPEN` manual review with supporting submission, MCQ, LLM evaluation, and decision data
- Tests:
  - `test/participant-console-config.test.ts`
  - `test/m2-manual-review.test.ts`
  - added route/config coverage for `/manual-review`
  - added assertion that seeded environments expose at least one pending manual review in the reviewer queue

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/participant-console-production-config.test.ts test/m2-manual-review.test.ts test/m2-appeal-flow.test.ts`

## 0.3.78 - 2026-03-10
### Summary
Made manual review state visible and filterable in the appeal handler queue so appeal handlers can find appeals tied to submissions that are under manual review.

### Included
- Appeal queue data expansion:
  - `src/services/appealService.ts`
  - queue payload now includes the latest manual review record for each submission in the appeal list
- Appeal handler queue UI:
  - `public/appeal-handler.html`
  - added a dedicated `Manual review status` filter group and a `Manual review` table column
  - expanded the queue toolbar layout to accommodate the extra filter controls
- Appeal handler queue logic:
  - `public/appeal-handler.js`
  - added local filtering by latest manual review status (`None`, `Open`, `In review`, `Resolved`)
  - included manual review status in queue search matching
  - rendered latest manual review status directly in the queue table
- Translation update:
  - `public/i18n/appeal-handler-translations.js`
  - added English fallback copy for the new queue filter, column, and manual review status labels

### Verification
- `npm run lint`
- `npm test -- test/m2-appeal-flow.test.ts test/m2-manual-review.test.ts`

## 0.3.77 - 2026-03-10
### Summary
Exposed manual review data inside the appeal handler detail panel so appeal handlers can see the latest manual treatment for the underlying submission.

### Included
- Appeal handler detail panel update:
  - `public/appeal-handler.js`
  - added a `Manual review` section to the selected appeal details
  - now shows latest manual review ID, status, trigger reason, reviewer ID, timestamps, and override outcome
- Translation update:
  - `public/i18n/appeal-handler-translations.js`
  - added English labels for the new manual review detail fields, used as fallback for other locales

### Verification
- `npm run lint`
- `npm test -- test/m2-appeal-flow.test.ts test/m2-manual-review.test.ts`

## 0.3.76 - 2026-03-10
### Summary
Moved `appeal-handler` resolve validation feedback into the resolve form itself so short input errors no longer surface in the generic system response area.

### Included
- Resolve form UX fix:
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
  - added inline validation message area for resolve fields
  - added client-side minimum-length checks for decision reason and resolution note
  - resolve-related `validation_error` responses now render inline near the form
- Translation update:
  - `public/i18n/appeal-handler-translations.js`
  - added English validation copy for the resolve fields, used as fallback for other locales

### Verification
- `npm run lint`
- `npm test -- test/m2-appeal-flow.test.ts`

## 0.3.75 - 2026-03-10
### Summary
Adjusted the participant assessment UX so auto-started assessments keep manual follow-up controls visible and wait longer before showing a timeout.

### Included
- Participant workspace fallback improvements:
  - `public/participant.js`
  - manual `Check progress` and `Check result` controls remain available even when auto-start after MCQ is enabled
- Assessment wait tuning:
  - `config/participant-console.json`
  - increased `flow.maxWaitSeconds` from `90` to `180`
- Participant copy update:
  - `public/i18n/participant-translations.js`
  - timeout text now points to the visible manual fallback controls below the status area
- Config verification update:
  - `test/participant-console-config.test.ts`
  - updated runtime-config expectation for the longer wait window

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/m1-core-flow.test.ts`

## 0.3.74 - 2026-03-10
### Summary
Extracted the duplicated frontend API/config fetch logic into a shared `api-client` module and migrated all five workspace pages to use it.

### Included
- Shared frontend API client:
  - `public/api-client.js`
  - added shared `apiFetch()`, `getConsoleConfig()`, and `buildConsoleHeaders()`
  - centralized response parsing and non-OK error normalization
  - cached `/participant/config` loading in-module
- Workspace page migration:
  - `public/participant.js`
  - `public/admin-content.js`
  - `public/appeal-handler.js`
  - `public/calibration.js`
  - `public/participant-completed.js`
  - removed local `api()` wrappers from all five files
  - replaced per-page `/participant/config` fetch logic with `getConsoleConfig()`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/participant-console-production-config.test.ts`

## 0.3.73 - 2026-03-10
### Summary
Replaced string-coded service errors with a typed `AppError` hierarchy, removed route-level `error.message` decoding, and centralized HTTP status mapping in shared error middleware.

### Included
- Typed application error model:
  - `src/errors/AppError.ts`
  - added `AppError`, `NotFoundError`, `ConflictError`, `ValidationError`, and `ForbiddenError`
- Shared error middleware:
  - `src/middleware/errorHandling.ts`
  - `src/app.ts`
  - global middleware now maps `AppError` subclasses to their configured HTTP status and API error code
- Service migration away from string-coded domain errors:
  - `src/services/appealService.ts`
  - `src/services/manualReviewService.ts`
  - `src/services/submissionService.ts`
  - `src/services/auditService.ts`
  - `src/services/calibrationWorkspaceService.ts`
  - `src/services/orgSyncService.ts`
  - `src/services/recertificationService.ts`
  - removed string-coded `throw new Error("...")` contracts from the migrated services
- Route cleanup:
  - `src/routes/submissions.ts`
  - `src/routes/appeals.ts`
  - `src/routes/reviews.ts`
  - `src/routes/audit.ts`
  - `src/routes/calibration.ts`
  - removed route-level `error.message === "..."` decoding and delegated typed errors via `next(error)`
- Test coverage:
  - `test/app-error-middleware.test.ts`
  - added explicit middleware mapping tests for 400/403/404/409/500 behavior

### Verification
- `npm run lint`
- `npm test -- test/app-error-middleware.test.ts test/m2-appeal-flow.test.ts test/m2-manual-review.test.ts test/m2-audit-pipeline.test.ts test/m2-calibration-workspace.test.ts`

## 0.3.72 - 2026-03-10
### Summary
Removed direct database access from the assessments route so submission ownership checks and assessment-view queries now stay inside the service layer.

### Included
- Layering cleanup for assessments endpoints:
  - `src/routes/assessments.ts`
  - `src/services/submissionService.ts`
  - removed direct `prisma` import from `assessments.ts`
  - `POST /api/assessments/:submissionId/run` now uses `getOwnedSubmission()`
  - `GET /api/assessments/:submissionId` now uses the new `getSubmissionForAssessmentView()`
- Service extraction:
  - `src/services/submissionService.ts`
  - added `getSubmissionForAssessmentView(submissionId, userId)` for the assessment workspace response shape

### Verification
- `npm run lint`
- `npm test -- test/m1-core-flow.test.ts test/rate-limiting.test.ts`

## 0.3.71 - 2026-03-10
### Summary
Propagated participant locale into stored submissions and the LLM assessment pipeline, so localized module task and guidance context now follows the participant's actual request locale.

### Included
- Submission locale persistence:
  - `prisma/schema.prisma`
  - `prisma/migrations/2026031001_add_submission_locale/migration.sql`
  - `src/services/submissionService.ts`
  - `src/routes/submissions.ts`
  - added `Submission.locale` with default `en-GB`
  - submission creation now stores `request.context.locale ?? env.DEFAULT_LOCALE`
- LLM locale propagation:
  - `src/services/assessmentJobService.ts`
  - replaced hardcoded `en-GB` localization in assessment prompts with the stored submission locale
  - submission locale is normalized before task/guidance text localization
- Test coverage:
  - `test/m2-i18n-baseline.test.ts`
  - added assertion that `/api/submissions` stores `locale`
  - added integration coverage proving Norwegian submission locale reaches the Azure OpenAI request payload as localized task/guidance context

### Verification
- `npm run prisma:generate`
- `npm run lint`
- `npm test -- test/m2-i18n-baseline.test.ts test/m1-core-flow.test.ts`

## 0.3.70 - 2026-03-10
### Summary
Hardened runtime safety and abuse controls, added server-controlled debug-panel gating with Azure environment override support, and documented the new deployment-facing configuration.

### Included
- Runtime/process hardening:
  - `src/index.ts`
  - `src/process/processErrorHandlers.ts`
  - added structured logging for `unhandledRejection` and `uncaughtException`
  - graceful shutdown now stops background workers before exit
- API rate limiting:
  - `src/middleware/rateLimiting.ts`
  - `src/app.ts`
  - `src/routes/assessments.ts`
  - `src/routes/submissions.ts`
  - `src/routes/modules.ts`
  - added:
    - general API limiter
    - tighter limiter for assessment queueing
    - limiter for submission creation
    - limiter for MCQ submission
  - rate-limited responses now return HTTP `429` with `Retry-After`
- Debug output gating for workspace UIs:
  - `src/config/participantConsole.ts`
  - `public/participant.html`
  - `public/participant.js`
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/calibration.html`
  - `public/calibration.js`
  - `public/participant-completed.html`
  - `public/participant-completed.js`
  - `/participant/config` now includes `debugMode`
  - participant and appeal-handler pages hide raw JSON output when debug is disabled
  - admin-content and calibration pages now wrap raw responses in collapsible `<details>`
  - all workspace pages now show a lightweight status line even when raw JSON is hidden
- Azure/app-setting debug override:
  - `src/config/env.ts`
  - `.env.example`
  - `.azure/environments/staging.env.example`
  - `.azure/environments/production.env.example`
  - `README.md`
  - added `PARTICIPANT_CONSOLE_DEBUG_MODE=auto|true|false`
  - supports enabling debug panels in Azure staging while forcing them off in production
- Test coverage:
  - `test/process-error-handlers.test.ts`
  - `test/rate-limiting.test.ts`
  - `test/participant-console-config.test.ts`
  - `test/participant-console-production-config.test.ts`
  - added coverage for process error logging, rate limiting, and debug-mode config behavior

### Verification
- `npm run lint`
- `npm test -- test/process-error-handlers.test.ts test/rate-limiting.test.ts test/participant-console-config.test.ts test/participant-console-production-config.test.ts test/m1-core-flow.test.ts`

## 0.3.69 - 2026-03-10
### Summary
Replaced status multi-select controls with accessible checkbox-pill groups in appeal-handler and calibration workspaces while preserving existing API filter behavior.

### Included
- Replaced native multi-select status filters with pill-based checkbox groups (`#75`):
  - `public/appeal-handler.html`
  - `public/calibration.html`
  - both pages now use `<fieldset>` + `<legend>` + checkbox-pill container instead of `<select multiple>`
- Added shared pill-group styling in workspace stylesheet:
  - `public/static/shared.css`
  - new classes:
    - `.pill-group-fieldset`
    - `.pill-group`
    - `.pill-option`
  - includes checked-state styling and keyboard focus visibility for each pill option
- Updated appeal-handler filter logic for checkbox pills:
  - `public/appeal-handler.js`
  - reads selected statuses from checked checkboxes
  - preserves existing status query behavior (`status=<csv>`)
  - adds arrow-key navigation support between checkbox pills
- Updated calibration filter logic for checkbox pills:
  - `public/calibration.js`
  - reads selected statuses from checked checkboxes
  - preserves existing calibration status query parameter behavior
  - adds arrow-key navigation support between checkbox pills
- Updated status-filter helper text:
  - `public/i18n/participant-translations.js`
  - replaced legacy Ctrl/Cmd-click multi-select guidance with checkbox-based guidance (`en-GB`, `nb`, `nn`)
- Test and documentation updates:
  - `test/participant-console-config.test.ts`
    - validates that status filters are pill groups and that native multi-select ids are removed
    - validates `.pill-group` style presence in shared stylesheet
  - `README.md`
    - updated handler/calibration manual test notes to reflect checkbox pill filters and keyboard usage

### Verification
- `npm run lint`
- `npm test` (80 tests passing, 30 test files)

## 0.3.68 - 2026-03-10
### Summary
Implemented participant-form accessibility and validation UX hardening by adding explicit hint/error/success styles, ARIA hint linking, and field-level validation feedback.

### Included
- Added semantic validation text styles in shared workspace CSS:
  - `public/static/shared.css`
  - new classes:
    - `.hint`
    - `.field-error`
    - `.field-success`
    - `.is-invalid`
  - `.field-error` supports clear left-border error affordance for visual distinction
- Participant form hinting and ARIA linkage:
  - `public/participant.html`
  - added field-specific hint elements and `aria-describedby` links for:
    - `reflectionText`
    - `promptExcerpt`
    - `ack`
  - module selection hint upgraded to hint styling with base hint key metadata
- Participant validation behavior updates:
  - `public/participant.js`
  - submission validation now returns field/hint targets
  - introduced field-level invalid highlighting (`.is-invalid`)
  - introduced role-aware alerting on invalid hints (`role="alert"`)
  - validation summary now toggles between `.field-error` and `.field-success`
  - hint text resets to localized baseline when validation state changes
- Translation updates for new participant hint copy:
  - `public/i18n/participant-translations.js`
  - added:
    - `submission.hint.reflection`
    - `submission.hint.promptExcerpt`
    - `submission.hint.ack`
  - parity maintained for `en-GB`, `nb`, `nn`
- Test coverage updates:
  - `test/participant-console-config.test.ts`
  - validates participant page `aria-describedby` links and new shared CSS class markers
- Documentation:
  - `README.md` updated with participant validation-feedback note in manual flow section

### Verification
- `npm run lint`
- `npm test` (80 tests passing, 30 test files)

## 0.3.67 - 2026-03-10
### Summary
Implemented foundational UX/style refactor items by extracting shared workspace CSS, introducing brand design tokens, adding centered max-width layout containers, and applying semantic button variants across all workspace pages.

### Included
- Shared stylesheet extraction (`#70`):
  - added `public/static/shared.css`
  - all five workspace pages now link `/static/shared.css`
  - moved common rules out of inline `<style>` blocks (`body`, `.card`, `.row`, form controls, `.small`, workspace nav styles, `.button-busy`, `pre`, `.hidden`)
  - included responsive `@media (max-width: 900px)` row-collapse rule in shared stylesheet
- Static asset serving hardening:
  - `src/app.ts`
  - `/static` now serves `public/static` first and falls back to `public` to keep existing script paths stable
- Brand tokenization and card elevation (`#77`):
  - `public/static/shared.css`
  - added tokenized spacing/color/elevation model in `:root`
  - replaced legacy hardcoded color usage in workspace page-specific CSS with token variables
  - switched shared `.card` style from flat border to `box-shadow: var(--shadow-card)`
- Max-width layout container and responsive baseline (`#78`):
  - all five pages now wrap content in `.layout-container`
  - added centered max-width layout (`1100px`) and mobile padding override in shared CSS
  - enabled workspace nav horizontal overflow handling for small screens
- Semantic button variants (`#71`):
  - added `.btn-primary`, `.btn-secondary`, `.btn-danger` in shared CSS
  - mapped static buttons across all five pages to semantic variants
  - participant module selection cards (dynamic buttons) now include semantic secondary button class (`public/participant.js`)
- Tests and docs:
  - `test/participant-console-config.test.ts` extended to verify shared stylesheet linking/serving, layout container presence, tokenized stylesheet markers, and button class coverage
  - `README.md` updated with shared stylesheet/design-token/layout/button-variant notes

### Verification
- `npm run lint`
- `npm test` (80 tests passing, 30 test files)

## 0.3.66 - 2026-03-10
### Summary
Simplified the admin content authoring flow with one bundled save action, improved wording/help text and locale defaults, and extended LLM assessment context with explicit assignment and expected-answer guidance.

### Included
- Admin content flow simplification:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - removed intermediate save buttons in steps 2-4
  - added one combined save action in step 5 (`saveContentBundle`)
  - bundled save now creates rubric + prompt + test + module version in one flow
- Improved admin-content defaults and text clarity:
  - `public/i18n/admin-content-translations.js`
  - default JSON examples are now multiline/pretty-printed for readability
  - clearer helper text and field naming across locales
  - Norwegian wording updated to avoid `MCQ` label in UI copy
  - terminology aligned around `Innlevering`/`innlevering` for participant-facing task wording
- Locale-text parsing flexibility in admin content form:
  - `public/admin-content.js`
  - text fields now support plain text or locale JSON object input in a consistent parser path
- LLM context enrichment for better assessment grounding:
  - `src/services/assessmentJobService.ts`
  - `src/services/llmAssessmentService.ts`
  - assessment calls now include module assignment context (`taskText`) and expected-answer context (`guidanceText`)
- Norwegian charset/message cleanup:
  - `src/i18n/contentMessages.ts`
  - corrected mojibake/encoding artifacts in localized validation messages
- Documentation update:
  - `README.md`
  - reflects single bundled save flow in admin content setup
- Test updates:
  - `test/m2-admin-content-publication.test.ts`
  - `test/admin-content-translations.test.js`
  - `test/llm-assessment-service.test.ts`
  - coverage now includes locale-object payloads, new translation keys, and LLM context propagation

### Verification
- `npm run lint`
- `npm test` (79 tests passing, 30 test files)

## 0.3.65 - 2026-03-10
### Summary
Improved admin content usability with clearer field naming and helper guidance, and added explicit multi-locale content authoring support (including MCQ locale-aware answer matching).

### Included
- Admin content UX text revision and helper guidance:
  - `public/admin-content.html`
  - `public/i18n/admin-content-translations.js`
  - clearer section names, field labels, and instructional helper text
  - explicit guidance for plain text vs locale-JSON content format
  - clarified which field is participant-facing module task text
- Added inline locale-JSON content support:
  - `src/i18n/content.ts`
  - supports content values in format:
    - `{"en-GB":"...","nb":"...","nn":"..."}`
  - locale resolution now supports:
    - plain text + dictionary lookup
    - inline locale JSON values
  - added localized variant matching helper for answer equivalence
- Extended admin content API text-field flexibility:
  - `src/routes/adminContent.ts`
  - text inputs now accept plain text or locale JSON object for:
    - module create fields (`title`, `description`, `certificationLevel`)
    - prompt template fields (`systemPrompt`, `userPromptTemplate`)
    - MCQ fields (`title`, `stem`, `options`, `correctAnswer`, `rationale`)
    - module version fields (`taskText`, `guidanceText`)
  - values are serialized consistently for storage
- Fixed locale-aware MCQ correctness matching:
  - `src/services/mcqService.ts`
  - answer validation now accepts translated variants (not only exact source string)
- Documentation updates:
  - `doc/I18N.md`
  - `README.md`
  - added explicit admin content localization format and behavior
- Automated tests added/updated:
  - new `test/content-localization.test.ts`
  - updated `test/m2-i18n-baseline.test.ts` to verify localized MCQ submit correctness
  - updated `test/admin-content-translations.test.js` for new helper-label coverage

### Verification
- `npm run lint`
- `npm test` (79 tests passing, 30 test files)

## 0.3.64 - 2026-03-10
### Summary
Implemented admin content workspace enablement with end-to-end UI/API support for creating base modules and managing versioned rubric/prompt/MCQ/module content from a dedicated role-scoped page.

### Included
- Added base module creation to admin content API:
  - `POST /api/admin/content/modules`
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - validates optional validity dates and emits `module_created` audit event
- Added dedicated admin content workspace UI:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
  - route `GET /admin-content` in `src/app.ts`
  - supports:
    - module creation
    - module loading/selection
    - rubric/prompt/MCQ version creation from JSON fields
    - module-version creation and publish
- Extended shared role-aware workspace navigation/config:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - added `navigation.items[]` entry for `/admin-content`
  - added `identityDefaults.contentAdmin`
  - updated fallback nav in:
    - `public/participant.js`
    - `public/participant-completed.js`
    - `public/appeal-handler.js`
    - `public/calibration.js`
  - added shared i18n nav key `nav.adminContent` in `public/i18n/participant-translations.js`
- Added design/documentation updates:
  - `doc/PHASE2_ADMIN_CONTENT_WORKSPACE_DESIGN.md`
  - `README.md` updated with new UI/API/config/testing details
- Added/updated automated tests:
  - new translation parity test:
    - `test/admin-content-translations.test.js`
  - extended admin content integration coverage:
    - `test/m2-admin-content-publication.test.ts`
    - now creates module via API and verifies `module_created` audit event
    - includes date validation failure case for module create
  - updated runtime config/page route coverage:
    - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test` (77 tests passing, 29 test files)

## 0.3.63 - 2026-03-10
### Summary
Implemented issue #66 with a dedicated participant completed-modules workspace, config-driven completion policy, and default filtering of completed modules from the active module list.

### Included
- Added central completion-policy config:
  - `config/module-completion.json`
  - keys:
    - `completedSubmissionStatuses`
    - `hideCompletedInAvailableByDefault`
    - `defaultCompletedHistoryLimit`
    - `maxCompletedHistoryLimit`
- Added completion config/policy runtime support:
  - `src/config/moduleCompletion.ts`
  - `src/services/moduleCompletionPolicyService.ts`
  - centralizes completed-status classification and include/limit resolution
- Updated module repository behavior:
  - `src/repositories/moduleRepository.ts`
  - `/api/modules` available list now excludes completed modules by default (config-driven)
  - added `listCompletedModulesForUser(...)` for module-level completion history with latest score/status
- Extended modules API:
  - `src/routes/modules.ts`
  - `GET /api/modules` now supports `includeCompleted=true|false` (explicit filter metadata in response)
  - new `GET /api/modules/completed?limit=<n>`
- Added participant completed-modules UI:
  - `public/participant-completed.html`
  - `public/participant-completed.js`
  - `public/i18n/participant-completed-translations.js`
  - new route `GET /participant/completed` in `src/app.ts`
- Navigation + i18n updates:
  - `config/participant-console.json`
  - `public/participant.js`
  - `public/appeal-handler.js`
  - `public/calibration.js`
  - `public/i18n/participant-translations.js` (`nav.completedModules`)
- Design/documentation updates:
  - `doc/PHASE2_PARTICIPANT_COMPLETED_MODULES_DESIGN.md`
  - `README.md` updated with new API/UI/config documentation
- Test updates:
  - new tests:
    - `test/m2-completed-modules.test.ts`
    - `test/module-completion-policy.test.ts`
    - `test/participant-completed-translations.test.js`
  - updated route/config coverage:
    - `test/participant-console-config.test.ts`
  - updated existing seed-module tests to use `includeCompleted=true` where required for deterministic baseline lookup:
    - `test/m0-foundation.test.ts`
    - `test/m1-core-flow.test.ts`
    - `test/m2-audit-pipeline.test.ts`
    - `test/m2-i18n-baseline.test.ts`
  - increased timeout for two long-running integration tests to stabilize full suite execution:
    - `test/m2-participant-results-history.test.ts`
    - `test/m2-reporting.test.ts`

### Verification
- `npm run lint`
- `npm test` (73 tests passing, 28 test files)

## 0.3.62 - 2026-03-10
### Summary
Implemented issue #67 (Phase A of #32) with a new read-only calibration workspace for SMEs/admins, including module-scoped historical outcomes, benchmark-anchor visibility, config-driven quality signals, and access auditing.

### Included
- New calibration workspace UI:
  - `public/calibration.html`
  - `public/calibration.js`
  - `public/i18n/calibration-translations.js`
  - route `GET /calibration` in `src/app.ts`
- New calibration API (read/analyze only):
  - `src/routes/calibration.ts`
  - `GET /api/calibration/workspace`
  - role-gated via config-driven access roles (`SUBJECT_MATTER_OWNER`, `ADMINISTRATOR`)
- New calibration data service:
  - `src/services/calibrationWorkspaceService.ts`
  - returns:
    - filtered module outcomes (`status`, `date`, `moduleVersion`)
    - benchmark anchor summary from prompt template examples
    - aggregate quality signals and threshold flags
  - records audit event:
    - `entityType=calibration_workspace`
    - `action=calibration_workspace_session_started`
- Config-driven calibration model extension:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - new keys:
    - `calibrationWorkspace.accessRoles`
    - `calibrationWorkspace.defaults`
    - `calibrationWorkspace.signalThresholds`
    - `identityDefaults.calibrationOwner`
  - shared top-nav config expanded with `nav.calibration`
- Shared navigation + i18n updates:
  - `public/participant.js`
  - `public/appeal-handler.js`
  - `public/i18n/participant-translations.js`
- Documentation:
  - `doc/PHASE2_CALIBRATION_WORKSPACE_PHASE_A_DESIGN.md`
  - `README.md` (new UI/API endpoints and config keys)
- Automated tests:
  - `test/m2-calibration-workspace.test.ts`
  - `test/calibration-translations.test.js`
  - updated `test/participant-console-config.test.ts` for expanded runtime config contract

### Verification
- `npm run lint`
- `npm test` (66 tests passing, 25 test files)

## 0.3.61 - 2026-03-10
### Summary
Implemented issue #65 with a shared, config-driven top navigation for role-specific workspaces, including role-aware menu visibility and i18n labels.

### Included
- Added config-driven workspace navigation model:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - new `navigation.items[]` runtime config (id/path/labelKey/requiredRoles)
- Added shared navigation resolution helpers:
  - `public/participant-console-state.js`
  - `sanitizeWorkspaceNavigationItems(...)`
  - `resolveWorkspaceNavigationItems(...)`
  - supports fallback menu behavior when configured items are invalid/missing
- Wired shared top nav into participant and appeal-handler pages:
  - `public/participant.html`
  - `public/appeal-handler.html`
  - `public/participant.js`
  - `public/appeal-handler.js`
  - both pages now render a top navigation bar based on current roles and locale
- i18n label support for navigation:
  - `public/i18n/participant-translations.js`
  - added `nav.participant` and `nav.appealHandler` in `en-GB`, `nb`, and `nn`
- Test coverage updates:
  - `test/participant-console-state.test.js`
    - added tests for navigation sanitization, role-based visibility, and fallback behavior
  - `test/participant-console-config.test.ts`
    - validates `/participant/config` includes `navigation` contract

### Verification
- `npm run lint`
- `npm test` (61 tests passing, 23 test files)

## 0.3.60 - 2026-03-10
### Summary
Refined participant assessment/result UX by removing redundant next-check messaging, improving localization coverage for additional OpenAI guidance text, and updating MCQ wording in Norwegian locales.

### Included
- Participant progress messaging:
  - `public/participant.js`
  - Removed UI display of `Next status check in ...` countdown during automatic assessment polling.
  - Progress now relies on clear status + prominent elapsed-seconds indicator.
- Extended localization mapping for OpenAI response text:
  - `public/participant.js`
  - Added normalization/mapping support for additional confidence variant:
    - `Low confidence in alignment due to sparse content; assessment based on limited cues.`
  - Added mapping coverage for additional improvement-advice phrases:
    - governance scope / risk owners / cadence
    - risk categories
    - QA checklist + independent review
    - data/privacy/retention/security controls
    - quality thresholds
    - iteration + versioning
    - escalation procedures + decision rights
    - artifacts/evidence
    - responsible AI + misuse safeguards
    - failure-mode examples + mitigations
- Translation resource updates:
  - `public/i18n/participant-translations.js`
  - Added matching translation keys in `en-GB`, `nb`, and `nn`.
  - Updated Norwegian MCQ wording:
    - section label: `Flervalgstest`
    - submit button: `Send test`
- Translation test coverage:
  - `test/participant-translations.test.js`
  - Added assertions for newly introduced translation keys.

### Verification
- `npm run lint`
- `npm test` (58 tests passing, 23 test files)

## 0.3.59 - 2026-03-10
### Summary
Fixed participant MCQ action state so `Send MCQ` becomes enabled immediately after MCQ questions are loaded.

### Included
- Participant UI flow-state fix:
  - `public/participant.js`
  - `renderQuestions()` now triggers `renderFlowGating()` after MCQ questions are rendered/cleared.
  - This ensures button enablement is recalculated from the updated `currentQuestions` state.

### Verification
- `npm run lint`
- `npm test` (58 tests passing, 23 test files)

## 0.3.58 - 2026-03-10
### Summary
Forenklet deltakerflyten videre ved å skjule ugyldige handlinger i riktig fase, gjøre nedtelling tydeligere, og forbedre konsistens/lokalisering i resultatoppsummering for manuell vurdering og OpenAI-råd.

### Included
- Participant UI flow gating hardening:
  - `public/participant.js`
  - `Opprett innlevering` skjules etter første vellykkede innlevering og vises igjen først etter reset.
  - `Send MCQ` skjules etter første vellykkede MCQ-innsending.
  - `Slett innlevering, og start på nytt` vises først når vurderingsresultat er mottatt (`UNDER_REVIEW`/`COMPLETED`/`SCORED`).
- Assessment progress visibility improvements:
  - `public/participant.html`
  - `public/participant.js`
  - lagt til tydelig, stor sekundteller under framdriftsstatus under automatisk vurdering.
- Result consistency + localization improvements:
  - `public/participant.js`
  - viser `Sendt til manuell vurdering` som beslutningstekst når status er `UNDER_REVIEW`, for å unngå konflikt mellom beslutning og begrunnelse.
  - utvidet lokalisering av kjente OpenAI confidence/improvement-tekster (nb/nn/en) med robust normalisering av strengmatching.
- Translation resource updates:
  - `public/i18n/participant-translations.js`
  - nye nøkler for manuell-vurdering-beslutning, lav konfidens og ekstra forbedringsråd.
- Added translation regression tests:
  - `test/participant-translations.test.js`
  - validerer nøkkelparitet mellom `en-GB`, `nb`, `nn` og at nye nøkler finnes i alle språk.

### Verification
- `npm run lint`
- `npm test` (58 tests passing, 23 test files)

## 0.3.57 - 2026-03-10
### Summary
Documented Azure OpenAI staging/production configuration profiles and operationalized the current staging runtime profile for `gpt-5-nano`.

### Included
- Documentation updates for OpenAI operations:
  - `doc/AZURE_ENVIRONMENTS.md`
  - added recommended runtime profiles for:
    - staging (`gpt-5-nano`)
    - production balanced
    - production quality
  - added production onboarding checklist for Azure OpenAI variables/secrets and verification steps
- README update:
  - `README.md`
  - added explicit `gpt-5-nano` compatibility guidance (`temperature=1`, `max tokens=4000`, token parameter `auto`)
- Staging environment runtime configuration applied:
  - `AZURE_OPENAI_TEMPERATURE=1`
  - `AZURE_OPENAI_MAX_TOKENS=4000`
  - `AZURE_OPENAI_TIMEOUT_MS=45000`
  - `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`

### Verification
- `npm run lint`
- `npm test` (56 tests passing, 22 test files)

## 0.3.56 - 2026-03-10
### Summary
Hardened Azure OpenAI token-limit compatibility by adding config-driven token parameter strategy (`max_tokens` / `max_completion_tokens` / `auto`) with automatic fallback for model-specific unsupported-parameter responses.

### Included
- Added new Azure OpenAI env/config key:
  - `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER`
  - supported values: `max_tokens`, `max_completion_tokens`, `auto`
  - default: `auto`
- Implemented token-parameter strategy in Azure adapter:
  - `src/services/llmAssessmentService.ts`
  - request now uses configured token key
  - `auto` mode tries modern-first (`max_completion_tokens`) and retries with `max_tokens` when provider returns `unsupported_parameter`
- Updated runtime/deploy configuration wiring:
  - `src/config/env.ts`
  - `.env.example`
  - `.azure/environments/staging.env.example`
  - `.azure/environments/production.env.example`
  - `infra/azure/main.bicep`
  - `scripts/azure/deploy-environment.ps1`
  - `.github/workflows/deploy-azure.yml`
- Documentation updates:
  - `README.md`
  - `doc/AZURE_ENVIRONMENTS.md`
  - `doc/PHASE2_AZURE_OPENAI_INTEGRATION.md`
- Test coverage updates:
  - `test/llm-assessment-service.test.ts`
  - verifies `max_tokens` path, `max_completion_tokens` path, and `auto` fallback retry behavior

### Verification
- `npm run lint`
- `npm test` (56 tests passing, 22 test files)
- `npm run build`

## 0.3.55 - 2026-03-10
### Summary
Implemented Azure OpenAI assessment-provider integration for `LLM_MODE=azure_openai` with strict structured-output validation, versioned prompt-template context wiring, and deploy/runtime configuration support.

### Included
- Implemented Azure OpenAI adapter in LLM service:
  - `src/services/llmAssessmentService.ts`
  - added provider call for `chat/completions` deployment endpoint
  - added timeout handling, provider-error surfacing, JSON extraction/parsing hardening, and existing `zod` schema validation reuse
  - retained `stub` mode behavior unchanged
- Expanded env contract for Azure OpenAI runtime config:
  - `src/config/env.ts`
  - `.env.example`
  - keys:
    - `AZURE_OPENAI_ENDPOINT`
    - `AZURE_OPENAI_API_KEY`
    - `AZURE_OPENAI_DEPLOYMENT`
    - `AZURE_OPENAI_API_VERSION`
    - `AZURE_OPENAI_TIMEOUT_MS`
    - `AZURE_OPENAI_TEMPERATURE`
    - `AZURE_OPENAI_MAX_TOKENS`
  - added fail-fast validation when `LLM_MODE=azure_openai`
- Assessment orchestration updates:
  - `src/services/assessmentJobService.ts`
  - LLM call now includes versioned prompt-template context (`systemPrompt`, `userPromptTemplate`, `examplesJson`)
  - persisted `LLMEvaluation.modelName` now records configured Azure deployment in `azure_openai` mode
- Azure deploy/runtime configuration wiring:
  - `infra/azure/main.bicep`
  - `scripts/azure/deploy-environment.ps1`
  - `.github/workflows/deploy-azure.yml`
  - `.azure/environments/staging.env.example`
  - `.azure/environments/production.env.example`
- Documentation:
  - added design note `doc/PHASE2_AZURE_OPENAI_INTEGRATION.md`
  - updated `README.md`, `doc/AZURE_ENVIRONMENTS.md`, and `doc/M1_IMPLEMENTATION_DECISIONS.md`
- Test coverage:
  - added `test/llm-assessment-service.test.ts` for Azure adapter success/failure parsing paths

### Verification
- `npm run lint`
- `npm test` (54 tests passing, 22 test files)

## 0.3.54 - 2026-03-09
### Summary
Implemented issue #28 with an admin-driven HR/LMS delta sync pipeline for users/org metadata, configurable conflict strategy, and audit/observability-based recovery tracing.

### Included
- Added org sync config model:
  - `config/org-sync.json`
  - `src/config/orgSync.ts`
  - config-driven conflict and overwrite behavior
- Added org sync service:
  - `src/services/orgSyncService.ts`
  - delta upsert for user identity/org metadata
  - conflict handling strategies (`merge_by_email`, `skip_conflict`)
  - per-record failure capture and recoverable run summaries
  - observability events + audit events for run completion/failure
- Added admin API endpoint:
  - `POST /api/admin/sync/org/delta`
  - route implementation in `src/routes/orgSync.ts`
  - wired in `src/app.ts` (admin-only access)
- Documentation:
  - `doc/PHASE2_ORG_SYNC_DESIGN.md`
  - `doc/ORG_SYNC_CONFLICT_STRATEGY.md` (explicit conflict/override strategy)
  - README updated with endpoint and config references
- Test coverage:
  - `test/m2-org-sync.test.ts` (delta create/update, conflict handling, audit signal)

### Verification
- `npm run lint`
- `npm test` (50 tests passing, 21 test files)

## 0.3.53 - 2026-03-09
### Summary
Implemented issue #35 by adding benchmark example/anchor version management per module with prompt/module linking, configuration-based validation, and auditable publish flow integration.

### Included
- Added benchmark example config:
  - `config/benchmark-examples.json`
  - `src/config/benchmarkExamples.ts`
  - configurable limits/required fields for benchmark payloads
- Added benchmark version management API:
  - `POST /api/admin/content/modules/:moduleId/benchmark-example-versions`
  - route implementation: `src/routes/adminContent.ts`
- Added benchmark creation service:
  - `src/services/adminContentService.ts`
  - creates a new versioned prompt template from a base prompt template
  - supports optional link to a module version context
  - validates benchmark examples against config limits/required fields
  - stores enriched benchmark-anchor metadata in prompt examples payload
  - emits audit event `benchmark_example_version_created`
- Publish/linkage integration:
  - benchmark prompt versions are linked to module versions through existing `promptTemplateVersionId`
  - module versions referencing benchmark prompts are publishable via existing publish endpoint
- Design note and tests:
  - `doc/PHASE2_BENCHMARK_EXAMPLES_DESIGN.md`
  - expanded `test/m2-admin-content-publication.test.ts` to cover benchmark version creation, linkage, publish, and audit
- Documentation:
  - README updated with benchmark admin endpoint and config guidance

### Verification
- `npm run lint`
- `npm test` (49 tests passing, 20 test files)

## 0.3.52 - 2026-03-09
### Summary
Implemented issue #30 by adding an advanced analytics reporting layer with semantic KPI model endpoints, trend/cohort analysis, and configurable data-quality checks.

### Included
- Added analytics model configuration:
  - `config/reporting-analytics.json`
  - `src/config/reportingAnalytics.ts`
  - config includes KPI catalog metadata, trend/cohort dimensions, and data-quality thresholds
- Reporting service analytics extensions (`src/services/reportingService.ts`):
  - `getAnalyticsSemanticModel`
  - `getAnalyticsTrendsReport`
  - `getAnalyticsCohortsReport`
  - `getReportingDataQualityReport`
- New analytics API endpoints (`src/routes/reports.ts`):
  - `GET /api/reports/analytics/semantic-model`
  - `GET /api/reports/analytics/trends`
  - `GET /api/reports/analytics/cohorts`
  - `GET /api/reports/analytics/data-quality`
- CSV export support added for analytics report types:
  - `type=analytics-trends`
  - `type=analytics-cohorts`
- Design note:
  - `doc/PHASE2_ADVANCED_REPORTING_DESIGN.md`
- Test coverage:
  - expanded `test/m2-reporting.test.ts` for semantic model, trends, cohorts, data quality, and analytics CSV export
- Documentation:
  - README updated with analytics endpoints and config model details

### Verification
- `npm run lint`
- `npm test` (49 tests passing, 20 test files)

## 0.3.51 - 2026-03-09
### Summary
Implemented issue #27 with a config-driven recertification engine, pre-expiry reminder scheduling, and reportable recertification status.

### Included
- Added recertification policy config:
  - `config/assessment-rules.json`
  - `src/config/assessmentRules.ts`
  - keys:
    - `recertification.validityDays`
    - `recertification.dueOffsetDays`
    - `recertification.dueSoonDays`
    - `recertification.reminderDaysBefore[]`
- Added recertification service:
  - `src/services/recertificationService.ts`
  - upserts `CertificationStatus` from final decisions
  - derives lifecycle statuses (`ACTIVE`, `DUE_SOON`, `DUE`, `EXPIRED`, `NOT_CERTIFIED`)
  - executes reminder schedule with dedupe by `asOfDate` + reminder offset
  - logs and audits reminder outcomes
- Integrated certification updates into final-decision points:
  - `src/services/decisionService.ts` (automatic completed decisions)
  - `src/services/manualReviewService.ts` (manual override decisions)
  - `src/services/appealService.ts` (appeal resolution decisions)
- Added reporting and reminder endpoints:
  - `GET /api/reports/recertification`
  - `POST /api/reports/recertification/reminders/run?asOf=<ISO-date>`
  - implementation in `src/routes/reports.ts` and `src/services/reportingService.ts`
- Added design note + tests:
  - `doc/PHASE2_RECERTIFICATION_DESIGN.md`
  - `test/m2-recertification-flow.test.ts`
  - README updated with recertification config/endpoint guidance

### Verification
- `npm run lint`
- `npm test` (49 tests passing, 20 test files)

## 0.3.50 - 2026-03-09
### Summary
Implemented issue #34 by adding PDF/DOCX document parsing in submission intake with fallback handling, parser-quality logging, and clear user-facing parse errors.

### Included
- Added parser service for attachment intake:
  - `src/services/documentParsingService.ts`
  - supports format detection for PDF/DOCX (`mimeType` + filename fallback)
  - parses attachment payload from `attachmentBase64`
  - fallback behavior:
    - if parsing fails and `rawText` exists -> uses `rawText`
    - if parsing fails and no fallback text -> returns clear parse error
  - parser quality metadata (`status`, `format`, `quality`, `extractedChars`, `reason`)
- Submission API input support:
  - `src/routes/submissions.ts`
  - `POST /api/submissions` now accepts optional:
    - `attachmentBase64`
    - `attachmentFilename`
    - `attachmentMimeType`
- Submission pipeline integration:
  - `src/services/submissionService.ts`
  - parsed/fallback text is resolved before submission persistence
  - parser outcome added to submission audit metadata
  - operational parser-quality signal logged via `submission_document_parse`
- Dependencies:
  - added parsing libraries: `pdf-parse`, `mammoth`
- Tests/docs:
  - added unit tests: `test/document-parsing.test.ts`
  - updated audit integration test: `test/m2-audit-pipeline.test.ts`
  - design note: `doc/PHASE2_DOCUMENT_PARSING_DESIGN.md`
  - README updated with parser behavior and new submission fields

### Verification
- `npm run lint`
- `npm test` (48 tests passing, 19 test files)

## 0.3.49 - 2026-03-09
### Summary
Implemented issue #31 by adding config-driven secondary LLM assessment with trigger/disagreement rules, manual-review routing on disagreement, and end-to-end traceability.

### Included
- Added `secondaryAssessment` policy in assessment rules config:
  - `config/assessment-rules.json`
  - `src/config/assessmentRules.ts`
  - `enabledByDefault`, `moduleOverrides`
  - configurable `triggerRules` and `disagreementRules`
- Added secondary-assessment policy service:
  - `src/services/secondaryAssessmentService.ts`
  - evaluates when second pass should run
  - evaluates disagreement between primary/secondary outcomes
- Assessment orchestration updates:
  - `src/services/assessmentJobService.ts`
  - runs primary pass + optional secondary pass
  - stores separate LLM evaluations for each pass
  - emits audit events:
    - `secondary_assessment_triggered`
    - `secondary_assessment_completed`
  - forces manual-review routing when disagreement rules are hit
- Decision pipeline update:
  - `src/services/decisionService.ts`
  - supports forced manual-review reason for secondary-pass disagreement routing
- LLM stub support for pass context:
  - `src/services/llmAssessmentService.ts` now accepts `assessmentPass` context (`primary` / `secondary`)
- Tests/docs:
  - new unit tests: `test/secondary-assessment.test.ts`
  - updated integration assertions: `test/m2-audit-pipeline.test.ts`
  - design note: `doc/PHASE2_SECONDARY_ASSESSMENT_DESIGN.md`
  - README updated with secondary-assessment config guidance

### Verification
- `npm run lint`
- `npm test` (44 tests passing, 18 test files)

## 0.3.48 - 2026-03-09
### Summary
Implemented issue #29 with config-driven sensitive-data detection/masking before LLM evaluation, including per-module enablement and audit traceability.

### Included
- Added sensitive-data masking policy config in assessment rules:
  - `config/assessment-rules.json`
  - `src/config/assessmentRules.ts`
  - `sensitiveData.enabledByDefault`
  - `sensitiveData.moduleOverrides` (`moduleId -> enabled`)
  - `sensitiveData.rules[]` (`id`, regex `pattern/flags`, `replacement`)
- Added preprocessing service:
  - `src/services/sensitiveDataMaskingService.ts`
  - detects rule hits across submission text fields
  - conditionally masks payload before LLM call
  - returns structured decision metadata (`maskingEnabled`, `maskingApplied`, `ruleHits`, totals, fields)
- Integrated preprocessing into assessment pipeline:
  - `src/services/assessmentJobService.ts`
  - audit event `sensitive_data_preprocessed` recorded per assessment with metadata
  - LLM request payload hash now reflects the actual (possibly masked) payload
- Tests and docs:
  - new unit tests: `test/sensitive-data-masking.test.ts`
  - updated integration coverage: `test/m2-audit-pipeline.test.ts`
  - design note: `doc/PHASE2_SENSITIVE_DATA_MASKING_DESIGN.md`
  - README updated with `sensitiveData` configuration guidance

### Verification
- `npm run lint`
- `npm test` (41 tests passing, 17 test files)

## 0.3.47 - 2026-03-09
### Summary
Implemented issue #33 by adding MCQ quality analytics reporting with configurable difficulty/discrimination thresholds and low-quality item flags.

### Included
- New MCQ quality report endpoint:
  - `GET /api/reports/mcq-quality`
  - `src/routes/reports.ts`
  - supports existing report filters (`moduleId`, `dateFrom`, `dateTo`, `orgUnit`) and optional status filter (`FLAGGED`, `OK`).
- MCQ quality analytics logic:
  - `src/services/reportingService.ts`
  - computes per-question metrics from completed MCQ responses:
    - `attemptCount`
    - `correctCount`
    - `difficulty` (proportion correct)
    - `discrimination` (point-biserial against attempt percent score)
  - flags low-quality items via configurable rules:
    - `TOO_DIFFICULT`
    - `TOO_EASY`
    - `LOW_DISCRIMINATION`
    - `INSUFFICIENT_SAMPLE`
  - exposes totals for flagged and per-flag category counts.
- Config-driven thresholds:
  - `src/config/assessmentRules.ts`
  - `config/assessment-rules.json`
  - added `mcqQuality` config:
    - `minAttemptCount`
    - `difficultyMin`
    - `difficultyMax`
    - `discriminationMin`
- CSV export support:
  - `GET /api/reports/export?type=mcq-quality&format=csv`
  - `src/routes/reports.ts`
- Documentation and tests:
  - `README.md` API list updated with `/api/reports/mcq-quality`.
  - `test/m2-reporting.test.ts` expanded to validate:
    - `mcq-quality` report response
    - `mcq-quality` CSV export.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.46 - 2026-03-09
### Summary
Delivered additional participant/appeal workspace simplifications: auto-loaded appeal queue, localized status filter labels, streamlined participant controls, and automatic MCQ start on submission.

### Included
- Appeal-handler UX simplification:
  - `public/appeal-handler.js`
  - Auto-loads appeal queue on page load using configured default statuses (`OPEN`, `IN_REVIEW`) without clicking `Load appeals`.
  - Localizes status labels in status filter and queue/detail displays based on selected UI language.
  - Preserves selected statuses while re-rendering localized filter labels.
- Participant flow simplification:
  - `public/participant.html`
  - `public/participant.js`
  - Removed `Clear module draft` button from submission section.
  - Added `Delete submission and start over` action in assessment section:
    - clears module draft
    - resets flow state and related IDs
    - prepares module for new submission cycle
  - Removed `Start MCQ` button.
  - MCQ now starts automatically immediately after successful `Create submission`.
  - MCQ section visibility is now gated by submission creation (not just module selection).
- Translation updates:
  - `public/i18n/participant-translations.js`
  - `public/i18n/appeal-handler-translations.js`
  - Added wording for new reset action and updated module/MCQ hint/error text.
- Documentation:
  - `README.md` manual flow updated to reflect automatic MCQ start and appeal queue auto-load behavior.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.45 - 2026-03-09
### Summary
Expanded appeal-handler case details so handlers can review full submission context directly in the workspace: participant submission content, MCQ result metrics, and evaluation details.

### Included
- Appeal workspace detail panel expansion:
  - `public/appeal-handler.js`
  - Added structured detail sections:
    - `Appeal`
    - `Submission` (answer text, reflection, prompt excerpt, delivery type)
    - `MCQ` (latest attempt id, percent/scaled score, pass/fail, completed timestamp)
    - `Evaluation` (latest decision + latest LLM evaluation fields, improvement advice, criterion rationales)
    - `SLA`
  - Added safer formatting helpers for numbers, pass/fail values, multiline text, and LLM response parsing.
- UI text keys for detailed case fields:
  - `public/i18n/appeal-handler-translations.js`
  - Added detail-label translation keys in `en-GB` (used as fallback for `nb`/`nn`).

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.44 - 2026-03-09
### Summary
Fixed appeal-handler workspace state issues so resolved appeals disappear consistently from open queues and resolution form inputs reset when switching appeals.

### Included
- Appeal queue/selection UX fixes:
  - `public/appeal-handler.js`
  - Ensures resolved appeal is removed from current queue view immediately when current status filter does not include `RESOLVED`.
  - Clears selected appeal + details state correctly when queue becomes empty or filter has no rows.
  - Prevents stale details reload for appeals no longer present in current queue.
- Resolution form state reset:
  - `public/appeal-handler.js`
  - Added centralized reset for:
    - `Decision reason`
    - `Resolution note`
    - `Pass/fail total` (default `Pass`)
  - Inputs now reset when selecting a different appeal and after resolve-driven selection changes.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.43 - 2026-03-09
### Summary
Simplified participant assessment UX further by hiding redundant manual controls in auto mode and making auto-evaluation timer visibility explicit.

### Included
- Participant assessment auto-flow UX:
  - `public/participant.js`
  - When `flow.autoStartAfterMcq=true`, hides manual assessment buttons:
    - `Start assessment`
    - `Check progress`
    - `View result`
  - Hides manual check hint in auto mode.
  - Adds explicit elapsed seconds in assessment progress status while auto polling is running.
- Translations:
  - `public/i18n/participant-translations.js`
  - Added `assessment.auto.elapsedPrefix` in `en-GB`, `nb`, and `nn`.
- Documentation:
  - `README.md` now states that manual assessment buttons are hidden when auto-start is enabled.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.42 - 2026-03-09
### Summary
Simplified participant flow between MCQ and assessment by starting assessment automatically after MCQ submission, showing countdown-based progress, and auto-loading result when ready.

### Included
- Auto assessment flow in participant UI:
  - `public/participant.js`
  - After `Send MCQ`, UI now automatically:
    - starts assessment (`POST /api/assessments/:submissionId/run`)
    - polls status on interval
    - shows countdown/status text inline in assessment section
    - fetches and renders result automatically when ready
- Improved MCQ transition clarity:
  - keeps last `Attempt ID` visible after MCQ submit instead of resetting to `-`.
- New config-driven participant flow settings:
  - `src/config/participantConsole.ts`
  - `config/participant-console.json`
  - `flow.autoStartAfterMcq`
  - `flow.pollIntervalSeconds`
  - `flow.maxWaitSeconds`
- Localization updates for auto-assessment status texts:
  - `public/i18n/participant-translations.js` (`en-GB`, `nb`, `nn`)
- Documentation and tests:
  - `README.md` updated with new `flow.*` config keys.
  - `test/participant-console-config.test.ts` updated to verify `flow` runtime config payload.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.41 - 2026-03-09
### Summary
Hardened participant flow sequencing and feedback, localized more of the result summary, and made test-console identities config-driven per workspace.

### Included
- Participant UX flow hardening:
  - `public/participant.html`
  - `public/participant.js`
  - Clearer button pressed/busy feedback (`busy` styling + disabled-state clarity).
  - `Submission` button now has explicit availability validation/hints (module + reflection + instruction + acknowledgement).
  - `Assessment` progress now shows explicit inline state text (`not started`, `waiting`, `completed`, `under review`, `failed`) instead of only raw output logs.
  - `Appeal` action now follows progressive visibility rules:
    - only shown for negative results (or existing appeal)
    - hidden once appeal exists and replaced by submitted-status text with appeal ID.
  - Result/history status and decision labels now use localized values in UI.
- Result summary language improvements:
  - `public/i18n/participant-translations.js`
  - Added missing translation keys for validation messages, assessment progress, status/decision values, criterion labels, and known stub guidance phrases in `en-GB`, `nb`, and `nn`.
- Config-driven identity defaults per workspace:
  - `src/config/participantConsole.ts`
  - `config/participant-console.json`
  - `public/participant.js`
  - `public/appeal-handler.js`
  - Added optional `identityDefaults.participant` and `identityDefaults.appealHandler` to runtime config returned by `/participant/config`.
- Appeal status visibility in participant result API:
  - `src/services/submissionService.ts`
  - `src/routes/submissions.ts`
  - `GET /api/submissions/:submissionId/result` now returns `latestAppeal` for participant-side gating/status display.
- Documentation:
  - `README.md` updated with new `identityDefaults` config keys.
- Automated tests:
  - `test/m2-appeal-flow.test.ts` extended to verify `latestAppeal` in participant result payload after create/resolve.
  - `test/participant-console-config.test.ts` extended to verify `identityDefaults` in `/participant/config`.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.40 - 2026-03-09
### Summary
Implemented UX text clarity improvements across participant and appeal-handler interfaces, with clearer actions, less technical wording, improved Norwegian readability, and more actionable appeal error messaging.

### Included
- Updated participant and workspace translation wording in:
  - `public/i18n/participant-translations.js`
  - `public/i18n/appeal-handler-translations.js`
- Text improvements include:
  - API/technical label cleanup (`Load /api/me` -> user-facing phrasing).
  - Replaced `Mock` terminology with plain test-user wording.
  - Simplified submission field labels (`Raw Text`, `Prompt Excerpt`).
  - Action-oriented assessment buttons and helper text.
  - Removed internal status-code wording (`COMPLETED`) from participant guidance.
  - Standardized claim/assignment wording in appeal workspace (especially `nb`/`nn`).
  - Improved appeal workspace subtitle, queue-limit wording, and empty-state guidance.
  - Renamed generic `Output` heading to clearer user-facing wording.
  - Corrected Norwegian character/transliteration issues in locale text.
- Updated appeal route error messages for clearer next-step guidance in:
  - `src/routes/appeals.ts`

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

### Notes
- Scope is wording-only UX improvement; no API contract changes.

## 0.3.39 - 2026-03-09
### Summary
Refined phase-2 participant and appeal-handler UX by separating role-specific workspaces, hardening module-selection flow, and preventing duplicate button submissions.

### Included
- Issue #51 follow-up (`mock` role switch):
  - role-preset behavior reused in dedicated `/appeal-handler` workspace.
  - added busy-state protection on identity/API action buttons to prevent accidental repeated requests.
- Issue #49 follow-up (module selection UX hardening):
  - `/participant` now hides `Submission` and `MCQ` sections until a module is selected.
  - added explicit module-selection unlock hint in module section.
- Issue #50 follow-up (module-scoped drafts):
  - preserved module-scoped autosave/restore behavior while introducing module-dependent section visibility.
- Issue #52 follow-up (progressive flow gating):
  - async action buttons now use consistent in-flight busy/disabled state to reduce duplicate submissions/queue calls.
- Issue #48 follow-up (appeal handler workspace):
  - moved workspace out of `/participant` into dedicated `/appeal-handler` page.
  - added queue table with search/filtering, configurable queue fetch limit, and clearer participant/timestamp visibility.
  - added queue limit config key: `appealWorkspace.queuePageSize`.
- Runtime/config/documentation updates:
  - `src/app.ts` serves `/appeal-handler`.
  - `src/config/participantConsole.ts` + `config/participant-console.json` include `queuePageSize`.
  - docs updated in `README.md` and `doc/PHASE2_PARTICIPANT_UI_DESIGN.md`.
- Automated tests:
  - updated `test/participant-console-config.test.ts` for `queuePageSize`.
  - added route coverage for `/appeal-handler`.

### Notes
- Backend appeal APIs are unchanged; this release is UI/workspace and runtime-config hardening.

## 0.3.38 - 2026-03-09
### Summary
Hardened mock-identity reconciliation and non-production bootstrap seed resilience to recover from user identity conflicts and ensure module-seed completion.

### Included
- Mock auth user-upsert reconciliation hardening:
  - `src/repositories/userRepository.ts`
  - avoids failing auth when `externalId` and `email` map to different existing users by reconciling safely instead of throwing unique-key errors.
- Bootstrap seed identity hardening:
  - `scripts/runtime/bootstrapSeed.mjs`
  - same reconciliation logic applied for seeded users (`admin-1`, `participant-1`) so bootstrap can continue and ensure seeded modules.
- Automated regression test:
  - `test/mock-auth-identity-reconciliation.test.ts`
  - verifies `/api/me` remains functional under `externalId`/`email` conflict scenario in mock mode.

### Notes
- This release targets staging data-drift recovery and reliable non-production verification flows.

## 0.3.37 - 2026-03-09
### Summary
Implemented phase-2 participant test-console UX hardening across role switching, module selection clarity, draft persistence, progressive flow gating, and appeal-handler workspace actions.

### Included
- Config-driven participant console runtime settings:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - `GET /participant/config`
- Issue #51 (`mock` role switch helper):
  - mock-role preset dropdown in participant identity section
  - Entra-aware disabled/read-only behavior while preserving manual role entry
- Issue #49 (module selection UX):
  - card-style module list with explicit selected state badge/highlight
  - selected module summary now shows localized human-readable title (id remains internal)
- Issue #50 (module-scoped drafts):
  - autosave/restore of `rawText`, `reflectionText`, `promptExcerpt`
  - optional in-progress MCQ draft persistence
  - config-driven draft storage key/TTL/max-module retention
  - manual clear-draft action and scoped restore/save status indicator
- Issue #52 (progressive flow gating):
  - assessment actions gated by submission + MCQ completion
  - `Check assessment` gated by queue action
  - appeal action gated by `COMPLETED` result status
  - inline locked-state hints and immediate UI transition updates
- Issue #48 (appeal handler workspace UI):
  - queue filtering/listing
  - claim and resolve actions
  - status/timestamp visibility (`createdAt`, `claimedAt`, `resolvedAt`)
  - actionable backend validation/error messaging in workspace
- Frontend state utilities + tests:
  - `public/participant-console-state.js`
  - `test/participant-console-state.test.js`
  - `test/participant-console-config.test.ts`
  - `test/m2-appeal-flow.test.ts` extended for resolved queue/timestamp checks
- Design/refactor gate notes:
  - `doc/PHASE2_PARTICIPANT_UI_DESIGN.md`

### Notes
- All targeted issue checks were validated locally before closeout; full lint/test/build validation is included in this release verification.

## 0.3.36 - 2026-03-09
### Summary
Implemented phase-2 participant notifications for appeal status transitions with config-driven delivery channels, localization baseline, and observability/audit coverage.

### Included
- Appeal transition notifications (`OPEN`, `IN_REVIEW`, `RESOLVED`, `REJECTED`):
  - `src/services/participantNotificationService.ts`
  - integrated into appeal lifecycle in `src/services/appealService.ts`
- Minimal template localization support:
  - `src/i18n/notificationMessages.ts` (`en-GB`, `nb`, `nn`)
- Config-driven channel model:
  - `PARTICIPANT_NOTIFICATION_CHANNEL` (`disabled` / `log` / `webhook`)
  - `PARTICIPANT_NOTIFICATION_WEBHOOK_URL`
  - `PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS`
  - env schema validation updated in `src/config/env.ts`
- Deployment/config plumbing:
  - `infra/azure/main.bicep`
  - `scripts/azure/deploy-environment.ps1`
  - `.github/workflows/deploy-azure.yml`
  - `.azure/environments/*.env.example`
  - `.env.example`, `.env.test`
- Documentation:
  - `doc/PHASE2_APPEAL_NOTIFICATIONS_DESIGN.md`
  - `doc/APPEALS_OPERATING_MODEL.md`
  - `doc/OBSERVABILITY_RUNBOOK.md`
  - `doc/AZURE_ENVIRONMENTS.md`
  - `README.md`
- Automated tests:
  - `test/participant-notifications.test.ts`
  - `test/m2-appeal-flow.test.ts` updated for notification audit signal.

### Notes
- Notification pipeline is fail-safe: transition handling continues even if downstream delivery fails, while failures are logged and audited.

## 0.3.35 - 2026-03-09
### Summary
Extended non-production bootstrap seed to include two modules so module-switch scenarios can be verified in stage/local runtime.

### Included
- Runtime bootstrap seed update:
  - `scripts/runtime/bootstrapSeed.mjs` now upserts two module graphs:
    - `Generative AI Foundations`
    - `AI Governance and Risk Essentials`
  - Both modules include rubric, prompt template, MCQ set, and published module version.
- Documentation update:
  - `README.md` manual testing section now explicitly lists both seeded modules.
- Backlog update:
  - Created usability discovery issue `#47` covering moderated UX testing and module-switch behavior.

### Notes
- This change targets non-production bootstrap behavior (`BOOTSTRAP_SEED=true`) and does not alter production runtime behavior.

## 0.3.34 - 2026-03-09
### Summary
Added second seeded module for multi-module flow verification and created dedicated usability discovery backlog item.

### Included
- Seed data enhancement for multi-module testing:
  - `prisma/seed.ts` now seeds two published modules with independent rubric/prompt/MCQ/module-version bundles.
  - Existing baseline module (`Generative AI Foundations`) retained.
  - Added second baseline module (`AI Governance and Risk Essentials`) to support module-switch UX testing.
- Validation:
  - `npm run lint`
  - `npm test` (23 tests passing, 12 test files)
- Planning/backlog:
  - Created `#47` for usability analysis and moderated UX testing, including module-switch scenario.

### Notes
- No API contract changes; this release extends seed/test fixtures and discovery planning.

## 0.3.33 - 2026-03-08
### Summary
Validated automated test baseline and aligned README documentation with current MVP implementation and CI/CD reality.

### Included
- Documentation hardening:
  - Updated `README.md` to reflect current implemented scope beyond M1.
  - Added explicit `Automated Testing` section with local + CI execution paths.
  - Added deployment automation section (`staging` auto, `production` approval gate).
  - Expanded API endpoint overview to include reviews, appeals, reporting, audit, and admin content APIs.
- Validation run:
  - `npm run lint`
  - `npm test` (23 tests passing across 12 test files)

### Notes
- No runtime behavior changes in this version; this release is documentation and verification alignment only.

## 0.3.32 - 2026-03-08
### Summary
Implemented automated overdue-appeal escalation monitoring and Azure alert routing baseline.

### Included
- Added runtime appeal SLA monitor service:
  - `src/services/appealSlaMonitorService.ts`
  - emits `appeal_sla_backlog` snapshots on interval
  - emits `appeal_overdue_detected` error events when overdue threshold is breached
- Wired monitor lifecycle into app runtime:
  - `src/index.ts` now starts/stops appeal SLA monitor with worker lifecycle.
- Added configuration keys:
  - `APPEAL_SLA_MONITOR_INTERVAL_MS` (default `600000`)
  - `APPEAL_OVERDUE_ALERT_THRESHOLD` (default `1`)
  - reflected in `src/config/env.ts`, `.env.example`, `.env.test`, and Azure env examples.
- Extended Azure observability infrastructure:
  - `infra/azure/main.bicep` now provisions scheduled-query alert `Overdue appeals detected`
  - App Service settings now include monitor interval + overdue threshold
  - deploy pipeline wiring added in:
    - `scripts/azure/deploy-environment.ps1`
    - `.github/workflows/deploy-azure.yml`
- Documentation updates:
  - `doc/OBSERVABILITY_RUNBOOK.md`
  - `doc/AZURE_ENVIRONMENTS.md`
  - `doc/APPEALS_OPERATING_MODEL.md`
- Added automated test coverage:
  - `test/m2-appeal-sla-monitor.test.ts`
  - verifies backlog classification and overdue threshold breach logic.

### Notes
- This implements issue `#45` acceptance criteria for automated overdue appeal escalation signals and routing baseline.

## 0.3.31 - 2026-03-08
### Summary
Implemented explicit first-response tracking for appeals by adding `claimedAt` and wiring first-response duration/SLA metrics through queue and reporting.

### Included
- Data model hardening:
  - Added `claimedAt` to `Appeal` model.
  - Added migration `2026030803_appeal_claimed_at`.
  - Added index on `(appealStatus, claimedAt)` for operational queries.
- SLA engine update:
  - `src/services/appealSla.ts` now computes:
    - `firstResponseDurationHours`
    - first-response overdue using explicit `claimedAt` when available
    - fallback behavior for unclaimed/unresolved appeals
- Appeal runtime behavior:
  - `claimAppeal` now sets `claimedAt` on first claim and preserves it on subsequent claims.
  - queue/workspace responses include `claimedAt` and SLA snapshot.
- Reporting update:
  - appeals report rows now include `claimedAt` and `firstResponseDurationHours`.
  - existing SLA aggregate totals preserved.
- Tests updated:
  - `test/m2-appeal-flow.test.ts` verifies `claimedAt` is set and stable.
  - `test/m2-reporting.test.ts` verifies overdue open-appeal first-response SLA fields.

### Notes
- This implements follow-up issue #44 (first-response SLA hardening).

## 0.3.30 - 2026-03-08
### Summary
Implemented MVP post-appeal operating model baseline with SLA visibility in appeal queue/reporting and documented runtime process.

### Included
- Added appeal SLA classification utility:
  - `src/services/appealSla.ts`
  - states: `ON_TRACK`, `AT_RISK`, `OVERDUE`, `RESOLVED`
  - configurable thresholds via env:
    - `APPEAL_FIRST_RESPONSE_SLA_HOURS` (default `24`)
    - `APPEAL_RESOLUTION_SLA_HOURS` (default `72`)
    - `APPEAL_AT_RISK_RATIO` (default `0.75`)
- Added SLA fields to appeal operational APIs:
  - `GET /api/appeals` rows now include `sla`
  - `GET /api/appeals/{appealId}` now includes top-level `sla`
- Extended appeals reporting for operational triage:
  - `GET /api/reports/appeals` rows now include SLA/age fields
  - totals now include:
    - `onTrackAppeals`
    - `atRiskAppeals`
    - `overdueAppeals`
- Added/updated test coverage:
  - `test/m2-reporting.test.ts`
  - `test/m2-appeal-flow.test.ts`
  - verifies overdue visibility and SLA fields in queue/workspace/reporting
- Added process documentation:
  - `doc/APPEALS_OPERATING_MODEL.md`
  - includes lifecycle, RACI, SLA targets, escalation path, participant communication, staging checklist
- Created concrete follow-up issues from operating-model gaps:
  - `#44` first-response SLA hardening (`claimedAt`)
  - `#45` automated overdue escalation alerts
  - `#46` participant notification channel for appeal transitions

### Notes
- This addresses issue `#43` acceptance criteria for documented process + operational detectability of at-risk/overdue appeals.

## 0.3.29 - 2026-03-08
### Summary
Localized module titles and MCQ content (questions/options) for `nb` and `nn` with English fallback.

### Included
- Added backend content translation dictionaries:
  - `src/i18n/contentMessages.ts`
  - `src/i18n/content.ts`
- Localized module content responses by resolved request locale:
  - `GET /api/modules`
  - `GET /api/modules/:moduleId`
  - `GET /api/modules/:moduleId/active-version`
  - `GET /api/submissions/history` (module title in history rows)
- Localized MCQ start payload by locale:
  - `GET /api/modules/:moduleId/mcq/start` now localizes `stem` and `options` fields
- Added i18n regression test coverage for localized module title and MCQ payload:
  - `test/m2-i18n-baseline.test.ts`

### Notes
- Translation uses source-text mapping with fallback to original English content when no translation exists.

## 0.3.28 - 2026-03-08
### Summary
Fixed participant UI locale switching so default textarea values are updated when language changes.

### Included
- Updated `public/participant.js` locale logic:
  - default field values (`rawText`, `reflectionText`, `promptExcerpt`, `appealReason`) now re-localize on language switch
  - preserves user-entered text by only replacing values that are empty or still equal to previous/default localized values
- Removed one-time-only default assignment behavior that left stale language content after switching locale.

### Notes
- This addresses the reported UX bug where standard values did not change when switching language in `/participant`.

## 0.3.27 - 2026-03-08
### Summary
Eliminated remaining CI test flakiness caused by relying on `modules[0]` in parallel test execution.

### Included
- Updated core integration tests to select the seeded module by title (`Generative AI Foundations`) instead of the first returned module:
  - `test/m1-core-flow.test.ts`
  - `test/m0-foundation.test.ts`
  - `test/m2-reporting.test.ts`
  - `test/m2-participant-results-history.test.ts`
  - `test/m2-manual-review.test.ts`
  - `test/m2-appeal-flow.test.ts`
  - `test/m2-audit-pipeline.test.ts`

### Notes
- This addresses CI failures where concurrently-created/published modules changed module ordering and broke MCQ assertions.

## 0.3.26 - 2026-03-08
### Summary
Stabilized CI by fixing cross-test state mutation in admin content publication test.

### Included
- Updated `test/m2-admin-content-publication.test.ts` to create and use an isolated test module instead of mutating the seeded shared module.
- Removed flaky dependency where test order/parallelism could change active module version and break `test/m1-core-flow.test.ts`.

### Notes
- This resolves intermittent CI failures seen in `CI #31` for commit `12400c2`.

## 0.3.25 - 2026-03-08
### Summary
Implemented i18n baseline (`en-GB`, `nb`, `nn`) across participant UI and core API user-facing messages.

### Included
- Added locale model and resolution helpers:
  - `src/i18n/locale.ts`
  - supported locales: `en-GB`, `nb`, `nn`
  - resolution strategy: `x-locale` -> `Accept-Language` -> `DEFAULT_LOCALE` -> `en-GB`
- Added backend localized message catalog:
  - `src/i18n/messages.ts`
  - localized `unauthorized`, `missing_bearer_token`, `forbidden_requires_roles`, `module_not_found`
- Integrated locale-aware behavior in API:
  - `authenticate` now resolves locale and stores it in request context
  - role authorization (`requireAnyRole`) now returns localized forbidden messages
  - module not-found messages are localized
  - `GET /api/me` now returns `user.locale` and `supportedLocales`
- Implemented participant UI internationalization baseline:
  - externalized UI strings into `public/i18n/participant-translations.js`
  - added language selector (en-GB/nb/nn) with persistence in local storage
  - participant API calls send `x-locale`
  - result/history summaries now use locale-aware date/number formatting
- Added documentation:
  - `doc/I18N.md` (adding locales, translation workflow, backend/frontend responsibilities)
- Added regression tests:
  - `test/m2-i18n-baseline.test.ts`
  - verifies language switching/resolution and fallback behavior

### Notes
- This addresses issue #41 acceptance criteria for locale model, fallback, language switching, API localization baseline, formatting, tests, and documentation.

## 0.3.24 - 2026-03-08
### Summary
Implemented MVP admin content management and publication flow for module governance.

### Included
- Added admin content API (role-gated to `ADMINISTRATOR` and `SUBJECT_MATTER_OWNER`):
  - `POST /api/admin/content/modules/{moduleId}/rubric-versions`
  - `POST /api/admin/content/modules/{moduleId}/prompt-template-versions`
  - `POST /api/admin/content/modules/{moduleId}/mcq-set-versions`
  - `POST /api/admin/content/modules/{moduleId}/module-versions`
  - `POST /api/admin/content/modules/{moduleId}/module-versions/{moduleVersionId}/publish`
- Added content management service to:
  - auto-increment version numbers per module/content type
  - validate cross-module integrity when linking rubric/prompt/MCQ versions into module versions
  - publish module versions by updating active version pointer
- Added publication audit event:
  - action: `module_version_published`
  - entity: `module_version`
- Added integration test:
  - `test/m2-admin-content-publication.test.ts`
  - validates create -> link -> publish path and role access control
- Test stability hardening:
  - increased Vitest timeout to 20s for current end-to-end style suite
  - adjusted M0 module version assertion to support later published versions in shared test runtime

### Notes
- This addresses issue #23 acceptance criteria for admin-managed versioned content and auditable publication.

## 0.3.23 - 2026-03-08
### Summary
Implemented participant-facing result details and personal submission history for MVP transparency requirements.

### Included
- Enhanced result endpoint:
  - `GET /api/submissions/{submissionId}/result` now includes:
    - `statusExplanation`
    - `scoreComponents` (mcq/practical/total)
    - `participantGuidance` (decision reason, confidence note, improvement advice, criterion rationales)
- Added personal history endpoint:
  - `GET /api/submissions/history?limit=<n>`
  - returns only current authenticated user's records
  - includes module metadata, status, and latest decision/MCQ/LLM snapshots
- Updated participant UI test console:
  - result summary panel for status + score components + guidance
  - history panel to load and inspect participant's own submission history
- Added integration test:
  - `test/m2-participant-results-history.test.ts`

### Notes
- This addresses issue #20 acceptance criteria for result transparency and user-scoped history.

## 0.3.22 - 2026-03-08
### Summary
Implemented MVP reporting endpoints with filter support and CSV export for governance reporting.

### Included
- Added reporting API router with role-gated endpoints:
  - `GET /api/reports/completion`
  - `GET /api/reports/pass-rates`
  - `GET /api/reports/manual-review-queue`
  - `GET /api/reports/appeals`
  - `GET /api/reports/export?type=<...>&format=csv`
- Added report filtering support across report types:
  - `moduleId`
  - `status` (comma-separated, report-specific)
  - `dateFrom`
  - `dateTo`
  - `orgUnit` (department)
- Added CSV export utility for core report types.
- Added reporting service implementation that aggregates totals/rows from submissions, decisions, manual reviews, and appeals.
- Added automated integration test for reporting and CSV behavior:
  - `test/m2-reporting.test.ts`

### Notes
- Reporting access is restricted to `ADMINISTRATOR`, `REPORT_READER`, and `SUBJECT_MATTER_OWNER`.

## 0.3.21 - 2026-03-08
### Summary
Implemented MVP observability baseline for correlation IDs, operational logging signals, Azure alerts, and runbook documentation.

### Included
- Added request observability middleware:
  - propagates/creates `x-correlation-id` for all requests
  - returns `x-correlation-id` in response headers
  - logs structured request completion events (`http_request`)
- Added operational event logging in assessment orchestration:
  - `llm_evaluation_failed`
  - `assessment_queue_backlog`
- Extended Azure IaC with observability resources:
  - workspace-based Application Insights + Log Analytics workspace
  - App Service diagnostic settings to workspace
  - latency metric alert
  - scheduled query alerts for LLM failures and queue backlog
  - optional action group email support
- Extended deployment automation and environment templates with observability parameters.
- Added runbook: `doc/OBSERVABILITY_RUNBOOK.md`.
- Added test assertion for correlation header presence on API responses.

### Notes
- This addresses issue #26 acceptance criteria for baseline detection and first-response readiness.

## 0.3.20 - 2026-03-08
### Summary
Added visible runtime version metadata in participant UI and implemented participant appeal action in the test console.

### Included
- Added backend app metadata utility and public version endpoint:
  - `GET /version` returns app name/version.
  - `GET /healthz` now also includes `version`.
- Updated participant test console UI:
  - shows current app version and updates browser title to include `v<version>`.
  - added appeal section with reason input and `Create Appeal` button.
  - displays created `appealId` in UI.

### Notes
- This enables quick confirmation that stage is running the expected release before manual verification.

## 0.3.19 - 2026-03-08
### Summary
Implemented reviewer and appeal-handler workspace flows with immutable decision lineage, and stabilized synchronous assessment processing for deterministic behavior.

### Included
- Added manual review workspace API (`/api/reviews`) with:
  - queue listing and detail workspace
  - claim flow for reviewer assignment
  - override resolution that creates a new `MANUAL_OVERRIDE` decision layer linked by `parentDecisionId`
  - audit events for claim/resolve/override
- Added appeal workflow APIs:
  - participant endpoint to create appeals: `POST /api/submissions/{submissionId}/appeals`
  - handler/admin endpoints: `GET /api/appeals`, `GET /api/appeals/{appealId}`, `POST /api/appeals/{appealId}/claim`, `POST /api/appeals/{appealId}/resolve`
  - appeal resolution creates a new `APPEAL_RESOLUTION` decision layer linked by `parentDecisionId`
  - audit events for appeal create/claim/resolve and appeal-resolution decision creation
- Added deterministic sync assessment processing:
  - `sync: true` now processes until the specific submission job is completed (not just one arbitrary pending job)
  - removes flakiness in integration and audit flow verification
- Added/updated integration tests:
  - `test/m2-manual-review.test.ts`
  - `test/m2-appeal-flow.test.ts`
  - `test/m2-audit-pipeline.test.ts`

### Notes
- This closes core backend implementation scope for manual overprøving and anke handling in the M2 workflow set.

## 0.3.18 - 2026-03-08
### Summary
Hardened dev-tenant Entra onboarding and role-map handling based on real verification findings.

### Included
- Added robust role-map parser utility (`src/auth/entraRoleMap.ts`) that:
  - handles UTF-8 BOM safely
  - normalizes role names
  - rejects invalid JSON with explicit error
- Updated role sync repository to use the shared parser for both JSON env and file-based mappings.
- Added automated tests for role-map parsing edge cases:
  - BOM-prefixed JSON
  - invalid entries and normalization
  - invalid JSON input
- Hardened Entra bootstrap script (`scripts/entra/setup-dev-tenant-auth.ps1`):
  - improved tenant login flow compatibility
  - client app creation fallback for CLI variants
  - safer Graph API PATCH payload handling
  - writes generated files as UTF-8 without BOM
- Expanded onboarding troubleshooting guide with concrete fixes for consent, audience, groups claims, and BOM issues.

### Notes
- This directly reduces recurring setup failures in issues #38, #39, and #40.

## 0.3.17 - 2026-03-08
### Summary
Ignored local staging diagnostics artifacts so repository status stays clean.

### Included
- Updated `.gitignore` to ignore:
  - `staging-logs*/`
  - `staging-logs*.zip`
  - `fic-staging.json`

### Notes
- Prevents accidental tracking of downloaded operational logs and local export files.

## 0.3.16 - 2026-03-08
### Summary
Strengthened engineering process to enforce root-cause-first handling of deployment incidents.

### Included
- Updated `doc/AI_WORKFLOW.md` with a mandatory deploy/runtime RCA-first workflow:
  - single hypothesis first
  - fixed evidence order
  - artifact contract checks
  - one-change-per-iteration budget
  - post-deploy smoke gate
  - explicit escalation criteria
- Updated `.github/pull_request_template.md` with Deployment RCA guardrails for deploy/runtime changes.
- Added `.github/ISSUE_TEMPLATE/deployment-incident.yml` to standardize incident capture and closeout.

### Notes
- Goal is to reduce trial-and-error loops and improve convergence speed in staging/production incident work.

## 0.3.15 - 2026-03-08
### Summary
Fixed CI workflow database setup to use test environment variables consistently.

### Included
- Updated CI step "Run migrations and seed" to execute `db:reset`, `db:migrate`, and `prisma:seed` with `dotenv -e .env.test`.

### Notes
- Resolves CI failures on main caused by missing `DATABASE_URL` during workflow execution.

## 0.3.14 - 2026-03-08
### Summary
Made stage bootstrap seeding startup-safe by removing it from blocking prestart execution.

### Included
- Updated `prestart` to run only runtime migrations.
- Added background bootstrap seed trigger in `src/index.ts` after server listen.
- Kept bootstrap logic idempotent and environment-gated via `BOOTSTRAP_SEED`.

### Notes
- This avoids App Service warmup/startup timeouts caused by startup-blocking seeding while still ensuring non-prod data population.

## 0.3.13 - 2026-03-08
### Summary
Implemented automatic non-production bootstrap seeding so stage has testable data after deploy.

### Included
- Added `scripts/runtime/bootstrapSeed.mjs` with idempotent upserts for users, roles, module, rubric, prompt, MCQ set/questions, and active module version.
- Updated `prestart` to run migrations and then bootstrap seed.
- Added `BOOTSTRAP_SEED` app setting in Bicep (`true` for staging, `false` for production).

### Notes
- This enables repeatable stage data provisioning without running manual seed commands.

## 0.3.12 - 2026-03-08
### Summary
Fixed stage participant test console to send role headers required by API authorization.

### Included
- Added roles input field in `public/participant.html` (default `PARTICIPANT`).
- Updated `public/participant.js` to send `x-user-roles` on all API requests.

### Notes
- This resolves 403 responses from `/api/modules` in mock mode when testing via `/participant`.

## 0.3.11 - 2026-03-08
### Summary
Stabilized deployment result detection by replacing fragile App Service startup tracking with explicit health verification.

### Included
- Updated `az webapp deploy` invocation to use `--track-status false`.
- Added post-deploy `/healthz` polling in `deploy-environment.ps1` with retry and hard fail on timeout.

### Notes
- This avoids false-negative deployment failures where OneDeploy succeeds and site starts, but CLI startup tracking still times out.

## 0.3.10 - 2026-03-08
### Summary
Fixed deployment packaging to include hidden Prisma client artifacts required at runtime.

### Included
- Replaced wildcard `Compress-Archive` packaging in `deploy-environment.ps1` with platform-aware zip creation that includes hidden files.
- Linux/macOS packaging now uses `zip -r .` from artifact root, preserving `.prisma` directory in `node_modules`.
- Windows packaging uses .NET `ZipFile.CreateFromDirectory`.

### Notes
- This resolves runtime startup crash: `Cannot find module '.prisma/client/default'`.

## 0.3.9 - 2026-03-08
### Summary
Fixed Prisma ESM/CJS interop crash that prevented app startup on Azure App Service.

### Included
- Added runtime-safe Prisma adapter module (`src/db/prismaRuntime.ts`) using default import interop.
- Updated runtime enum/client imports to use the adapter instead of direct named imports from `@prisma/client`.
- Kept type-only Prisma imports where needed.

### Notes
- This resolves startup crash: `Named export 'PrismaClient' not found` from `dist/src/db/prisma.js`.

## 0.3.8 - 2026-03-08
### Summary
Resolved App Service startup permission failures by removing Prisma engine execution from startup path.

### Included
- Changed `prestart` to `node scripts/runtime/applyMigrations.mjs` (manual SQL migration runner).
- Ensured runtime migration script creates the SQLite database directory if missing.
- Moved `prisma` back to `devDependencies` because runtime startup no longer uses Prisma CLI binaries.

### Notes
- This avoids `EACCES` on Prisma schema engine binaries in run-from-package deployments.

## 0.3.7 - 2026-03-08
### Summary
Fixed App Service startup failures caused by non-executable Prisma CLI in deployment zip artifacts.

### Included
- Changed `prestart` to run Prisma migrate via `node ./node_modules/prisma/build/index.js migrate deploy` to avoid Linux execute-bit dependency.
- Explicitly set `appCommandLine` to empty string in Azure Bicep to clear stale custom startup commands from prior deployments.

### Notes
- This resolves startup crashes with `sh: 1: prisma: Permission denied` and prevents old runtime migration startup commands from persisting.

## 0.3.6 - 2026-03-08
### Summary
Replaced startup migration mechanism to avoid `node:sqlite` runtime incompatibility.

### Included
- Changed `prestart` from custom SQLite migration script to `prisma migrate deploy`.
- Moved `prisma` package to runtime dependencies to guarantee CLI availability in deployed app.

### Notes
- Startup no longer depends on Node built-in `node:sqlite`.

## 0.3.5 - 2026-03-08
### Summary
Fixed runtime entrypoint mismatch in deployment artifact.

### Included
- Updated `start` script from `node dist/index.js` to `node dist/src/index.js`.

### Notes
- Deployment artifact structure from TypeScript build places the entrypoint at `dist/src/index.js`.
- Previous mismatch could terminate app startup immediately in App Service.

## 0.3.4 - 2026-03-08
### Summary
Startup probe compatibility fixes for Azure App Service.

### Included
- Added root endpoint `GET /` returning `200` to satisfy warmup/startup probing.
- Added explicit App Service port settings (`PORT=8080`, `WEBSITES_PORT=8080`) in Bicep app settings.

### Notes
- This targets recurring “site failed to start” deployment failures despite successful package deployment.

## 0.3.3 - 2026-03-08
### Summary
App Service startup strategy updated to use platform default Node startup path.

### Included
- Added `prestart` script in `package.json` to run runtime migrations before app boot.
- Removed custom `appCommandLine` override in Bicep and delegated startup to default `npm start` behavior.

### Notes
- This avoids custom startup command edge cases and keeps migration logic tied to app lifecycle.

## 0.3.2 - 2026-03-08
### Summary
Startup command fix for App Service Linux deployment.

### Included
- Updated App Service startup command in Bicep to ensure execution happens from app root:
- `cd /home/site/wwwroot && npm run db:migrate:runtime && npm run start`

### Notes
- This targets startup failures where `npm` runs outside the deployed application directory.

## 0.3.1 - 2026-03-08
### Summary
Staging deployment reliability fixes for GitHub Actions and App Service startup.

### Included
- Deployment script hardening:
- Robust temp directory resolution in Linux/Windows runners.
- Explicit native command exit-code checks with fail-fast behavior.
- Build deployment artifact before packaging (`npm ci`, Prisma client generation, TypeScript build).
- Prune dev dependencies before zip to keep runtime package leaner.
- CI/CD workflow update:
- Added concurrency control to avoid overlapping staging deployments and Kudu deployment locks.

### Notes
- This release addresses deployment failures caused by missing built artifacts in Run-From-Package deployments.

## 0.3.0 - 2026-03-08
### Summary
Completed implementation of next-step tracks: dev-tenant auth hardening and Azure staging/production automation baseline.

### Included
- Dev-tenant auth enhancements:
- Hardened Entra bootstrap script with API scope + client delegated permission setup.
- Generated role-map file support for safer config-based mapping.
- Extended onboarding/smoke-test guide for testers.
- Added automated integration test for group-claim to role mapping.
- Azure provisioning/deployment automation baseline:
- Bicep template for cost-optimized App Service deployment per environment.
- End-to-end deployment script for dedicated RG per environment.
- Optional budget/alert cost-guardrail script.
- GitHub Actions workflow for staging auto-deploy and production manual approval gate.
- Azure environment plan and runbook docs.
- Runtime migration script for deployed environments.

### Notes
- Production approval enforcement depends on GitHub Environment protection settings.
- Dev-tenant auth issues remain open until tenant-side validation is completed.

## 0.2.0 - 2026-03-08
### Summary
Parallel implementation of track A (dev-tenant auth setup baseline) and track B (M1 core assessment flow).

### Included
- M1 core flow backend:
- submission creation API with required-field validation
- MCQ start/submit endpoints with deterministic scoring
- async assessment job queue/worker orchestration
- strict LLM structured assessment contract (stub mode)
- backend decision engine with config-driven thresholds and manual-review routing
- assessment/result endpoints
- Manual participant test console:
- `/participant` UI for module -> submission -> MCQ -> assessment -> result flow
- Dev-tenant auth setup baseline:
- Entra group-claim to app-role sync support (config-driven)
- bootstrap script for dev tenant app registrations/groups (`scripts/entra/setup-dev-tenant-auth.ps1`)
- onboarding and smoke-test documentation (`doc/DEV_TENANT_AUTH_ONBOARDING.md`)
- New config assets:
- `config/assessment-rules.json`
- `config/entra-group-role-map.example.json`
- Added M1 flow integration tests and kept M0 tests green.

### Notes
- `LLM_MODE=azure_openai` is scaffolded but not implemented yet.
- Follow-up hardening and rollout tracking remains in open issues.

## 0.1.1 - 2026-03-08
### Summary
Dev-tenant Entra authentication target design for shared development/testing.

### Included
- New design document for issue `#37`:
- `doc/DEV_TENANT_AUTH_TARGET_DESIGN.md`
- Defined target architecture (API app + client app, issuer/audience contract).
- Defined required Entra objects, naming conventions, and ownership model.
- Defined explicit dev/prod tenant separation policy.
- Defined rollout plan from `AUTH_MODE=mock` to `AUTH_MODE=entra`.
- Linked new design document from README.

### Notes
- Follow-up execution is tracked in `#40`, `#38`, and `#39`.

## 0.1.0 - 2026-03-08
### Summary
Initial M0 foundation release.

### Included
- Backend bootstrap with TypeScript + Express.
- Authentication and RBAC foundation (`mock` and `entra` mode).
- Core relational schema and migration baseline.
- Module and active-version read APIs.
- Seed data for local/test setup.
- M0 discovery decision for borderline/manual review routing.
- Basic CI workflow (lint, test, build).

### Notes
- Migration execution is done through repository migration scripts in this version.
