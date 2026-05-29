# Security remediation issue plan - Codex findings 2026-05-15

Source: `C:\Users\JoakimKosmo\Downloads\codex-security-findings-2026-05-15T19-42-41.142Z.csv`

This plan consolidates 27 high-severity findings into implementation issues by root cause. Labels suggested for all issues: `security`, `high`. Add `P0`, `P1`, or `P2` according to the priority below.

## Execution order

1. P0 workflow and secret-exposure issues first: Issues 1-5.
2. P0 auth and identity boundary issues next: Issues 6-7.
3. P1 assessment-integrity issues: Issues 8-11.
4. P1 admin-content privilege and XSS issues: Issues 12-13.
5. P2 client supply-chain hardening: Issue 14.

## Issue 1 - P0: Harden staging activation workflow against untrusted refs

### Problem

`workflow_dispatch` can check out a dispatcher-controlled ref and then run repository scripts after Azure login. A malicious branch/ref can replace deployment scripts and exfiltrate staging secrets or tamper with staging resources.

### Scope

- `.github/workflows/activate-staging-app-layer.yml`
- Any script path executed by this workflow, especially `scripts/azure/set-postgres-compute-state.ps1` and `scripts/azure/deploy-environment.ps1`

### Proposed fix

- Remove free-form `ref` dispatch input, or restrict it to trusted protected refs only.
- Checkout trusted workflow code before Azure login.
- If deploying a target ref is required, separate "code to deploy" from "trusted deployment scripts" and execute only scripts from the trusted branch/SHA.
- Use environment variables for summary output and quote all shell values.
- Reduce job permissions to the minimum required.

### Acceptance criteria

- [ ] A manually dispatched run cannot cause the job to execute scripts from an arbitrary branch, pull ref, or attacker-controlled SHA.
- [ ] Azure login occurs only after trusted workflow/deployment scripts are checked out.
- [ ] The summary step no longer interpolates untrusted inputs directly into shell.
- [ ] Workflow permissions are least privilege.
- [ ] Regression test or documented dry run confirms normal staging activation still works.

### Verification

- Review workflow YAML for absence of `checkout.ref: ${{ inputs.ref }}` in privileged jobs.
- Run `act` or a dry workflow dispatch with benign refs if available.
- Manually inspect that all shell inputs are passed through `env:` or validated before use.

### Findings covered

- Re-enabled workflow runs untrusted refs with Azure secrets
- Activation workflow runs untrusted refs with staging secrets

## Issue 2 - P0: Remove shell injection and secret exposure from benchmark workflow

### Problem

Manual `workflow_dispatch` inputs for `repeat`, `models`, and `cases` are embedded directly in a shell block while staging secrets are available. A dispatcher can inject shell metacharacters and exfiltrate the Azure OpenAI key or tamper with artifacts.

### Scope

- `.github/workflows/benchmark-models.yml`

### Proposed fix

- Validate dispatch inputs before use:
  - `repeat`: integer within a small allowed range.
  - `models`: enum or comma-separated allowlist of known model IDs.
  - `cases`: enum/allowlist or validated path/name pattern.
- Pass inputs through `env:` and quote expansions in shell, or move argument construction into a typed Node/PowerShell script.
- Remove staging environment secrets from the benchmark job unless strictly required.
- Remove `contents: write` unless the job must push changes; prefer read-only plus explicit artifact upload.

### Acceptance criteria

- [ ] Crafted inputs containing `;`, `$()`, backticks, newlines, or shell redirection cannot execute commands.
- [ ] The benchmark job does not expose staging secrets to manually supplied shell input.
- [ ] `GITHUB_TOKEN` permissions are read-only unless a separate trusted publish job needs write access.
- [ ] Benchmark functionality still supports intended model/case/repeat selections.

### Verification

- Add a negative workflow-input validation test where possible, or document manual test cases.
- Run the benchmark workflow/script locally with valid and invalid inputs.
- Inspect workflow permissions and environment usage.

### Findings covered

- Workflow dispatch inputs can exfiltrate staging secrets
- Benchmark workflow exposes staging secret to shell injection
- Workflow dispatch inputs allow CI command injection

## Issue 3 - P0: Move dependency installation before cloud authentication in deploy workflow

### Problem

The deploy job runs dependency installation after Azure login. If dependency lifecycle scripts or modified package metadata execute, they run with cloud credentials and deployment secrets available.

### Scope

- `.github/workflows/deploy-azure.yml`
- `scripts/azure/deploy-environment.ps1`
- `package-lock.json`

### Proposed fix

- Run `npm ci` before Azure login and before secrets are made available.
- Prefer `npm ci --ignore-scripts` in CI unless lifecycle scripts are explicitly required.
- If scripts are required, run only audited scripts before cloud auth.
- Ensure deployment scripts do not install dependencies after Azure login.

### Acceptance criteria

- [ ] No package installation or lifecycle script execution occurs after Azure login.
- [ ] CI uses reproducible install from lockfile.
- [ ] Any required package scripts are documented and run without cloud credentials.
- [ ] Deploy job still completes successfully.

### Verification

- Review workflow step order.
- Run deploy workflow in staging or a dry run.
- Confirm logs show dependency installation before Azure authentication.

### Findings covered

- npm install now runs after Azure login in deploy job

## Issue 4 - P0: Restore least-privilege Key Vault RBAC and parser-worker isolation

### Problem

The parser worker processes untrusted source material, but it can now read all secrets in the shared Key Vault. Key Vault access-policy mode also allows resource Contributors to modify access policies and grant themselves secret access.

### Scope

- `infra/azure/main.bicep`
- `scripts/azure/bootstrap-sp-permissions.ps1`

### Proposed fix

- Use Key Vault RBAC mode instead of access-policy mode.
- Grant identities secret access at the narrowest possible scope.
- Ensure the parser worker can read only `PARSER-WORKER-AUTH-KEY`, or move parser-only secrets into a separate vault.
- Keep database, Azure OpenAI, ACS, and notification secrets inaccessible to the parser identity.
- Avoid broad `User Access Administrator` guidance for deployment identities unless absolutely required and time-bounded.

### Acceptance criteria

- [ ] Parser managed identity cannot read `DATABASE-URL`, `AZURE-OPENAI-API-KEY`, `ACS-CONNECTION-STRING`, or other non-parser secrets.
- [ ] Key Vault is configured in RBAC mode.
- [ ] Deployment principal permissions are least privilege and documented.
- [ ] Bicep outputs and app settings continue to resolve required secrets.

### Verification

- Run Bicep what-if or deployment validation.
- Use `az role assignment list` and `az keyvault secret show` tests with the parser identity where feasible.
- Confirm parser worker startup still succeeds.

### Findings covered

- Parser worker granted access to all Key Vault secrets
- Key Vault access-policy mode exposes secrets to Contributors
- Parser worker gains Key Vault access to all secrets

## Issue 5 - P0: Preserve Key Vault references and stop writing raw secrets to App Service settings

### Problem

The post-deploy script resolves secrets and writes raw values into App Service settings, replacing Key Vault references. Anyone with App Service configuration read access can then read database, OpenAI, ACS, and parser secrets without Key Vault secret permissions. The script also stages secrets in predictable temp JSON files.

### Scope

- `scripts/azure/deploy-environment.ps1`
- `infra/azure/main.bicep`

### Proposed fix

- Keep App Service settings as `@Microsoft.KeyVault(...)` references.
- Never write raw secret values into App Service app settings.
- Remove temp JSON files containing secrets, or use secure transient mechanisms that do not persist secret material.
- Rotate exposed secrets after the fix is deployed.

### Acceptance criteria

- [ ] App Service settings contain Key Vault references, not raw secret values.
- [ ] Deployment scripts do not call `az webapp config appsettings set` with raw secret values.
- [ ] No predictable temp files are written with secret payloads.
- [ ] A rotation checklist exists for secrets potentially exposed by prior deploys.

### Verification

- Run deployment script in staging and inspect app settings values.
- Search scripts for raw secret write paths.
- Confirm application can start using Key Vault references.

### Findings covered

- Deployment script stores secrets in App Service settings

## Issue 6 - P0: Disable mock authentication outside local development

### Problem

Mock authentication defaults and participant console behavior allow forged identities or roles via client-controlled headers, including in deployment environments if defaults are used incorrectly.

### Scope

- `src/config/env.ts`
- `src/auth/authenticate.ts`
- `src/repositories/userRepository.ts`
- `public/participant.html`
- `public/participant.js`
- `infra/azure/main.bicep`
- `scripts/azure/deploy-environment.ps1`
- `azure/environments/staging.env.example`
- `.env.example`
- `README.md`

### Proposed fix

- Make Entra authentication the default for staging and production.
- Fail startup when mock auth is enabled outside explicit local/test environments.
- Ignore mock role/user headers unless a signed local-dev switch is active.
- Remove participant-console controls that can spoof roles in shared environments.
- Document safe local-only mock-auth usage.

### Acceptance criteria

- [ ] Staging/prod deployments cannot start with mock auth enabled.
- [ ] Participant browser code cannot choose or spoof server-side roles.
- [ ] Mock headers are ignored unless local/test mode is explicitly enabled.
- [ ] Documentation and examples no longer encourage unsafe defaults.

### Verification

- Add unit/integration tests for auth mode startup validation.
- Add request tests proving mock headers are ignored in Entra mode.
- Validate staging environment configuration.

### Findings covered

- Participant console can spoof mock roles
- Azure deployment defaults expose mock authentication
- Mock auth default permits header-forged identities and roles

## Issue 7 - P0: Fix identity reconciliation and offboarding enforcement

### Problem

Inactive users can be reactivated by normal login because `upsertUserFromPrincipal` writes `activeStatus: true`. Email-based reconciliation can also merge a newly authenticated principal into an existing account, enabling account takeover if email identity is not strongly bound.

### Scope

- `src/auth/authenticate.ts`
- `src/repositories/userRepository.ts`
- `src/routes/orgSync.ts`
- `src/services/orgSyncService.ts`
- `scripts/runtime/bootstrapSeed.mjs`

### Proposed fix

- Treat `externalId` plus issuer/tenant as the primary identity key.
- Do not reactivate inactive users during login.
- Block inactive users during authentication/authorization before role evaluation.
- Avoid email-only account linking unless it is an explicit admin-approved migration flow.
- Add audit logging for attempted login by inactive or ambiguous identities.

### Acceptance criteria

- [ ] A user marked inactive by org sync remains blocked after subsequent authenticated requests.
- [ ] Email collision does not attach a new external principal to an existing user automatically.
- [ ] Active role calculation cannot override inactive user status.
- [ ] Tests cover inactive login, externalId match, email collision, and bootstrap seed behavior.

### Verification

- Unit tests for `upsertUserFromPrincipal`.
- Integration test for authenticated request from inactive user.
- Org sync test proving inactive status persists.

### Findings covered

- Org sync offboarding is bypassed by login reactivation
- Email-based identity reconciliation enables account takeover

## Issue 8 - P1: Redact assessor-only guidance from participant module APIs

### Problem

Participant-facing module endpoints return `guidanceText`, which is defined as hidden assessor-only scoring support. Participants can retrieve scoring notes before submitting.

### Scope

- `src/routes/modules.ts`
- `src/modules/module/moduleService.ts`
- `src/repositories/moduleRepository.ts`
- `src/config/capabilities.ts`
- `src/modules/adminContent/llmContentGenerationService.ts`
- `src/modules/assessment/llmAssessmentService.ts`
- `public/admin-content-advanced.html`

### Proposed fix

- Split participant DTOs from admin/assessor DTOs.
- Only return `candidateTaskConstraints` and participant-safe content to participant endpoints.
- Keep `guidanceText` available only for authorized assessor/admin capabilities.
- Add response-shape tests for `/api/modules`, `/api/modules/:moduleId`, and `/api/modules/:moduleId/active-version`.

### Acceptance criteria

- [ ] Participant responses never include `guidanceText` or hidden assessor scoring notes.
- [ ] Admin/assessor workflows still receive guidance where authorized.
- [ ] Tests fail if `guidanceText` is accidentally added back to participant DTOs.

### Verification

- API integration tests with `PARTICIPANT` role.
- API integration tests with authorized admin/assessor role.
- Static search for participant serializers returning hidden fields.

### Findings covered

- Participant APIs leak hidden assessor scoring guidance
- Participant API leaks hidden assessor scoring notes

## Issue 9 - P1: Re-enforce MCQ and practical pass gates in backend decisions

### Problem

Pass/fail currently depends on total score plus red flags, while the UI still implies MCQ and practical minimums are separate AND conditions. Participants can pass despite failing a required component.

### Scope

- `config/assessment-rules.json`
- `src/routes/calibration.ts`
- `src/modules/assessment/decisionService.ts`
- `src/modules/assessment/mcqService.ts`
- `src/modules/certification/recertificationService.ts`
- `public/calibration.html`
- `public/calibration.js`

### Proposed fix

- Restore backend enforcement for `mcqMinPercent` and `practicalMinPercent`.
- Ensure calibration publish accepts, stores, validates, and displays all enforced thresholds.
- Update decision lineage to explain which gate failed.
- Align UI text with backend policy.

### Acceptance criteria

- [ ] A participant cannot pass if MCQ score is below configured MCQ minimum.
- [ ] A participant cannot pass if practical score is below configured practical minimum.
- [ ] Calibration settings persist and enforce total, MCQ, and practical thresholds consistently.
- [ ] Recertification uses the same gate logic.

### Verification

- Unit tests for decision service gate combinations.
- Integration tests for calibration publish and decision evaluation.
- Regression test for default weights with 0% MCQ and high practical score.

### Findings covered

- MCQ/practical gates ignored, allowing unwarranted certification

## Issue 10 - P1: Prevent MCQ score forgery and old-submission renewal

### Problem

Participant-controlled MCQ submissions can be forged for perfect scores, and old submissions can be rerun to renew certifications outside the intended assessment attempt lifecycle.

### Scope

- `src/routes/modules.ts`
- `src/routes/submissions.ts`
- `src/routes/assessments.ts`
- `src/services/mcqService.ts`
- `src/services/submissionService.ts`
- `src/services/assessmentJobService.ts`
- `src/services/decisionService.ts`
- `src/services/recertificationService.ts`

### Proposed fix

- Score MCQs server-side from stored answer keys; never trust client-supplied correctness or score.
- Bind answers to an active assessment attempt, module version, MCQ set version, participant, and expiry window.
- Prevent rerunning old submissions for recertification unless an explicit eligible new attempt exists.
- Store immutable assessment snapshots used for decisions.

### Acceptance criteria

- [ ] Client cannot submit a forged score or correctness flags to influence MCQ outcome.
- [ ] MCQ scoring uses server-side answer keys and current attempt context.
- [ ] Old submissions cannot produce new certification renewals.
- [ ] Attempt/version mismatches are rejected.

### Verification

- Integration tests with forged MCQ payloads.
- Tests for old submission rerun and recertification eligibility.
- Tests for module/MCQ version mismatch.

### Findings covered

- MCQ submissions can be forged for perfect scores
- Participants can renew certifications by rerunning old submissions

## Issue 11 - P1: Treat LLM assessment output as untrusted and recompute scores server-side

### Problem

Participant-controlled content can prompt-inject the model into returning inflated scores. The service trusts LLM-provided totals and scaled scores without validating rubric IDs, bounds, sums, or consistency.

### Scope

- `src/modules/assessment/llmAssessmentService.ts`
- `src/modules/assessment/decisionService.ts`
- `src/modules/assessment/assessmentJobService.ts`
- Legacy paths if still active:
  - `src/services/llmAssessmentService.ts`
  - `src/services/decisionService.ts`
  - `src/services/assessmentJobService.ts`

### Proposed fix

- Keep scoring instructions separate from participant content and clearly delimit untrusted text.
- Validate returned rubric score keys against configured criterion IDs.
- Enforce per-criterion score bounds and strictly positive rubric maximum.
- Recompute `rubric_total` and `practical_score_scaled` server-side from validated criterion scores.
- Route malformed or inconsistent LLM output to manual review instead of auto-pass.

### Acceptance criteria

- [ ] Unknown rubric keys are rejected or ignored according to explicit policy.
- [ ] Scores outside allowed bounds cannot affect decisions.
- [ ] `rubric_total` and scaled practical score are recomputed by server code.
- [ ] Inconsistent LLM output triggers manual review or failure-safe handling.
- [ ] Prompt-injection regression tests cannot forge an automatic pass.

### Verification

- Unit tests for schema/bounds/sum validation.
- Integration test with prompt-injection-like participant response.
- Decision-service tests proving manual-review fallback.

### Findings covered

- Unbounded LLM rubric totals can skew assessment decisions
- LLM assessment can be prompt-injected to forge scores

## Issue 12 - P1: Eliminate stored XSS in admin content UIs

### Problem

Admin content lists build rows with `innerHTML` and interpolate stored fields such as `title` and `certificationLevel`. A subject matter owner can store markup that executes in another privileged user's browser.

### Scope

- `public/static/admin-content-library.js`
- `public/static/admin-content-courses.js`
- `public/admin-content.js`
- `src/modules/adminContent/adminContentSchemas.ts`
- `src/modules/adminContent/adminContentQueries.ts`
- `src/config/capabilities.ts`

### Proposed fix

- Replace unsafe `innerHTML` interpolation with DOM APIs or trusted escaping helpers.
- Validate `certificationLevel` as an enum or sanitized localized text.
- Ensure archive, library, and course list renderers consistently encode stored content.
- Add CSP/Helmet hardening as defense in depth.

### Acceptance criteria

- [ ] Stored module title and certification level values render as text, not executable HTML.
- [ ] Archive, module library, and course list UIs all use safe rendering.
- [ ] Schema validation rejects or normalizes unsafe certification-level values.
- [ ] XSS regression tests cover representative payloads.

### Verification

- DOM/unit tests for renderer output.
- Playwright test that stores an XSS payload and verifies no script execution.
- Manual browser check of admin library/archive/course pages.

### Findings covered

- Stored XSS in admin content certification badges
- Stored XSS in admin archive module list

## Issue 13 - P1: Enforce SMO content scope and protect module export answer keys

### Problem

Subject matter owners can export module content including MCQ answer keys and can globally alter/publish assessment content beyond their intended scope.

### Scope

- `src/app.ts`
- `src/routes/adminContent.ts`
- `src/services/adminContentService.ts`
- `src/repositories/adminContentRepository.ts`

### Proposed fix

- Add actor/scope checks to module export and admin content mutation flows.
- Separate administrator-only exports containing answer keys from SMO-safe exports.
- Redact `correctAnswer`, prompt templates, or unpublished/historical sensitive versions unless the actor has explicit permission.
- Enforce module ownership/domain assignment for SMO publish/update actions.

### Acceptance criteria

- [ ] SMOs cannot export modules they do not own or are not assigned to.
- [ ] SMO export responses do not include MCQ answer keys unless explicitly authorized.
- [ ] SMOs cannot globally alter or publish assessment content outside their scope.
- [ ] Administrator flows retain needed full export capability.

### Verification

- Authorization tests for SMO vs administrator.
- Export response-shape tests for answer key redaction.
- Mutation tests for cross-module ownership denial.

### Findings covered

- Module export leaks MCQ answer keys to all SMOs
- SMO role can globally alter and publish assessment content

## Issue 14 - P2: Vendor or pin MSAL browser dependency and add client-side defense in depth

### Problem

The client loads MSAL from a CDN without SRI or pinning. A compromised CDN response would execute in the application origin and could access tokens or call APIs as the victim.

### Scope

- `public/api-client.js`
- Package/build configuration if vendoring `@azure/msal-browser`
- HTTP security headers/CSP configuration

### Proposed fix

- Prefer bundling or serving a local pinned copy of `@azure/msal-browser`.
- If CDN loading remains, add SRI integrity and `crossorigin`.
- Add restrictive CSP that limits script sources and blocks inline script where possible.
- Document dependency update process.

### Acceptance criteria

- [ ] Runtime no longer loads MSAL from an unpinned external CDN.
- [ ] MSAL version is controlled by package lock or local vendored asset.
- [ ] CSP reduces impact of future script injection.
- [ ] Entra login still works in participant, reviewer, report, and admin workspaces.

### Verification

- Browser smoke test for Entra login.
- Inspect network requests to confirm MSAL loads locally or with SRI.
- Header test for CSP where applicable.

### Findings covered

- MSAL CDN script loads without integrity pinning

