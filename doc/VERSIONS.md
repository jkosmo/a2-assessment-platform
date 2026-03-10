# Versions

This document tracks release versions and what each version includes.

## Versioning Rules
- Use Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Every push to remote must include a version bump.
- Every version bump must update this document.

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
