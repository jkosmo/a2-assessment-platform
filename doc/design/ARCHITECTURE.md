# Architecture

This document describes the current runtime architecture of the A2 Assessment Platform and the main boundaries between its workflows.

## Purpose

The platform supports assessment and re-assessment of participant submissions with traceability, controlled human intervention, and operational visibility.

The solution is built to handle these core needs:
- let participants complete modules, submit work, and receive assessment outcomes
- route borderline or policy-triggered cases into manual review
- let participants appeal completed decisions
- let appeal handlers resolve appeals with immutable decision lineage
- let administrators manage versioned assessment content and reporting
- provide auditability, configuration control, and deployable operations in Azure

## Core Domain Flow

The primary decision flow is:

1. A participant opens an active module version.
2. The participant submits free-text work and, where configured, MCQ answers.
3. The system creates a submission and queues an assessment job.
4. The assessment worker evaluates the submission and creates an assessment decision.
5. If policy or disagreement rules require human review, the submission is routed to manual review.
6. A reviewer can override the outcome and create a reviewed decision.
7. If the participant appeals, the case enters the appeal workflow.
8. The appeal handler resolves the appeal by creating a new immutable appeal-resolution decision.

The important architectural rule is that decisions are append-only. Later stages do not mutate earlier decisions; they add new decision records with explicit lineage.

## Main Components

### HTTP application
- Express application in `src/app.ts`
- route modules under `src/routes/`
- middleware for auth, error handling, rate limiting, consent, and request context

### Domain and application modules
- business workflows primarily live under `src/modules/*`
- the codebase is a modular monolith in transition, with module-owned services for assessment, submission, review, appeal, reporting, calibration, admin content, and related domains
- small cross-cutting helpers also exist outside the module tree, for example audit and runtime wiring
- routes should delegate here rather than contain business logic

### Data access
- Prisma client in `src/db/prisma.ts`
- repository boundaries exist both in `src/repositories/` and within module-owned code
- some persistence concerns still sit close to module services, which is part of the current hardening backlog

### Background processing
- `src/index.ts` starts either the web app, the worker runtime, or both based on `PROCESS_ROLE=web|worker|all`
- background processing currently includes:
  - `AssessmentWorker`
  - `AppealSlaMonitor`
  - `PseudonymizationMonitor`
  - `AuditRetentionMonitor`
- graceful shutdown and process-level failure handling are wired in `src/index.ts`

### Frontend workspaces
- static workspace UIs in `public/`
- each workspace is a task-specific operator console over the same backend API
- shared browser API client lives in `public/api-client.js`
- canonical workspace identity, paths, and role contracts live in `src/config/capabilities.ts`
- `/participant/config` exposes the runtime config used by the browser, including navigation derived from the canonical capability contract

## Technologies, Products, and Standards

This section summarizes what is used for which area of the solution.

### Application runtime
- language: TypeScript
- server runtime: Node.js
- web framework: Express
- module format: ES modules
- purpose: API surface, workspace hosting, middleware pipeline, and background-process bootstrap

### Data access and persistence
- ORM/data access: Prisma
- local/test database: PostgreSQL
- Azure runtime database: Azure Database for PostgreSQL
- purpose: relational storage for submissions, decisions, reviews, appeals, audit data, and versioned content

### Authentication and authorization
- identity product: Microsoft Entra ID in `entra` mode
- local/test fallback: mock auth mode
- token handling library: `jose`
- authorization model: RBAC with application roles stored as `RoleAssignment`
- relevant standards/protocols:
  - JWT for bearer token structure
  - OAuth 2.0 / OpenID Connect-style Entra sign-in and audience/issuer validation model

### Frontend and browser layer
- delivery model: server-served static HTML + vanilla JavaScript modules
- transport style: HTTP + JSON API calls
- localization approach: config-driven UI translations and localized content payloads
- purpose: task-specific operator and participant workspaces without a heavy SPA framework

### AI assessment integration
- current enterprise AI product path: Azure OpenAI
- integration area: assessment generation/evaluation in the LLM assessment service
- purpose: structured assessment output used as input to decision-making and review flows
- important boundary: AI output is not the final authority on its own when manual review or appeal logic applies

### Cloud and operations
- hosting product: Azure App Service
- runtime topology: separate web and worker app roles, driven by `PROCESS_ROLE`
- infrastructure as code: Azure Bicep
- CI/CD platform: GitHub Actions
- observability products: Azure Monitor, alerting, and runbook-based operational response
- purpose: deployment automation, runtime hosting, alert routing, and production operations

### Reporting and export
- API style: JSON endpoints for operational and governance reporting
- export format: CSV
- purpose: completion reporting, pass-rate analysis, manual-review queue visibility, appeal oversight, and analytics extracts

### Standards and conventions used across the solution
- REST-style HTTP endpoint design for workspace/backend communication
- JSON as the main application payload format
- RBAC for authorization boundaries between participant, reviewer, appeal handler, subject matter owner, report reader, and administrator
- i18n/l10n conventions using supported locales `en-GB`, `nb`, and `nn`
- immutable decision lineage as a domain-level auditability rule
- semantic versioning for releases, documented in `doc/VERSIONS.md`

## Workspaces and Roles

The platform separates human tasks by workspace and role. Workspace pages are static routes; effective access is enforced by authenticated API calls and the canonical capability contract that drives navigation.

### Participant workspace
- route: `/participant`
- primary capability roles: `PARTICIPANT`, `REVIEWER`, `ADMINISTRATOR`
- purpose: browse modules, submit work, monitor progress, view results, create appeals

### Completed modules workspace
- route: `/participant/completed`
- primary capability roles: `PARTICIPANT`, `REVIEWER`, `ADMINISTRATOR`
- purpose: review historical completion and result state across modules

### Review workspace
- route: `/review`
- primary capability roles: `REVIEWER`, `APPEAL_HANDLER`, `ADMINISTRATOR`
- purpose: combine manual review and appeal handling into one operator surface with separate queue modes

### Calibration workspace
- route: `/calibration`
- primary capability roles: runtime-configurable via `calibrationWorkspace.accessRoles` (default `SUBJECT_MATTER_OWNER`, `ADMINISTRATOR`)
- purpose: inspect calibration cases and compare assessment behaviour

### Admin content workspace
- route: `/admin-content`
- primary capability roles: `SUBJECT_MATTER_OWNER`, `ADMINISTRATOR`
- purpose: create and publish versioned modules, prompts, rubrics, benchmark examples, and MCQ sets

### Results workspace
- route: `/results`
- primary capability roles: `REPORT_READER`, `SUBJECT_MATTER_OWNER`, `ADMINISTRATOR`
- purpose: operational and governance reporting, analytics views, and exports

### Profile workspace
- route: `/profile`
- primary capability roles: any authenticated user
- purpose: show current identity, active roles, and environment/runtime context

### Admin platform workspace
- route: `/admin-platform`
- primary capability roles: `ADMINISTRATOR`
- purpose: platform-level administration surfaces outside content authoring

## Key Architectural Boundaries

### Assessment reliability is a product requirement
- the platform supports certification decisions that have real internal consequences for participants
- because of that, assessment outcomes must be reliable enough to preserve trust in the certification process
- some variation in free-text scoring from the LLM is expected and tolerated, especially across model versions
- that variation is **not** acceptable at the traffic-light level:
  - clearly weak or incomplete submissions should consistently land in `red`
  - clearly risky or borderline submissions should consistently land in `yellow`
  - clearly strong submissions should consistently land in `green`
- the architecture must therefore constrain the LLM to structured, policy-governed signals rather than letting arbitrary wording decide routing
- tuning of these levels must remain understandable and configurable for administrators through documented policy/configuration, not hidden prompt behavior

### Manual review and appeals are different workflows
- manual review happens before or around finalisation of an assessment outcome when the system needs human intervention
- appeals happen after a participant disputes an outcome
- the combined `/review` workspace keeps these queues separate in behavior even though they share one operator surface

### Decisions are immutable
- assessments, review overrides, and appeal resolutions create distinct decision records
- this preserves auditability and makes decision lineage inspectable

### Configuration drives runtime behaviour
- environment variables and `participant-console` runtime config control polling, debug visibility, seeded identities, and calibration/review workspace behavior
- canonical route and workspace role contracts are code-owned in `src/config/capabilities.ts`
- production-only and staging-only behaviour should be controlled server-side, not by client toggles

### Audit and observability are first-class concerns
- audit events, operational logs, and reporting endpoints are part of the system design, not afterthoughts
- background workers and monitors must produce structured runtime evidence
- runtime lifecycles should remain instantiable and testable without `NODE_ENV`-specific production code branches

## Deployment Shape

Current deployment model:
- Node.js application deployed to Azure App Service
- separate web and worker app roles in Azure App Service, driven by `PROCESS_ROLE`
- Prisma-backed PostgreSQL database
- staging deploy on push to `main`
- production deploy behind manual approval
- Azure Monitor and runbook support for operations

## Known Architectural Debt

The most important currently known gaps are:
- module boundaries are clearer than before, but some persistence and DTO concerns are still being tightened
- some broader unit-test coverage still depends too much on integration setup
- several architecture decisions still live across design notes and release notes rather than one permanent reference

## ModuleVersion Fields

### submissionSchemaJson

`ModuleVersion.submissionSchemaJson` is an optional JSON field defining the participant submission form. If present, `participant.js` renders the schema's `fields` array as form inputs instead of the default 3-field form. If absent, the default 3-field form is used. Schema format: `{"fields":[{"id":"...", "label":"...", "type":"textarea", "required":true}]}`. The `label` field supports both plain strings and locale objects of the form `{"en-GB":"...","nb":"...","nn":"..."}` - `participant.js` resolves the label to the participant's current locale at render time, and re-renders on locale change.

### assessmentPolicyJson

`ModuleVersion.assessmentPolicyJson` is an optional JSON field that overrides global assessment rules for a specific module. Supported overrides: `scoring.practicalWeight`, `scoring.mcqWeight`, and `passRules.totalMin`. The policy is parsed at submission time and passed to `decisionService.resolveAssessmentDecision`, which applies any present overrides and falls back to global config for absent fields.

### Module-level locale fields

The `Module` record fields `title`, `description`, and `certificationLevel` all support locale objects (`{"en-GB":"...","nb":"...","nn":"..."}`) in addition to plain strings. The backend serialises these via `serializeLocalizedText` and decodes via `decodeLocalizedText`. The admin authoring prompt generates locale objects for all three fields.

### MCQ locale objects

MCQ question fields (`stem`, `options` array elements, `correctAnswer`, `rationale`) support both plain strings and locale objects of the form `{"en-GB":"...","nb":"...","nn":"..."}`. Plain strings are returned as-is for all locales. Locale objects are resolved at serve time via `localizeContentText` (for scalar fields) or `localizeContentArray` (for the options list). The admin authoring prompt generates locale objects for all MCQ fields so participants see their UI language reflected in quiz content.

## Related Documents

- `README.md`
- `doc/APPEALS_OPERATING_MODEL.md`
- `doc/I18N.md`
- `doc/M0_IMPLEMENTATION_DECISIONS.md`
- `doc/M1_IMPLEMENTATION_DECISIONS.md`
- `doc/AZURE_ENVIRONMENTS.md`
- `doc/VERSIONS.md`
