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
- middleware for auth, error handling, rate limiting, and request context

### Service layer
- business workflows under `src/services/`
- owns assessment orchestration, manual review, appeals, reporting, calibration, admin content, and notifications
- routes should delegate here rather than contain business logic

### Data access
- Prisma client in `src/db/prisma.ts`
- partial repository abstraction in `src/repositories/`
- some domains still access Prisma directly from services; that remains known technical debt

### Background processing
- assessment worker processes queued assessment jobs
- SLA monitoring watches appeal aging and emits operational events
- process-level failure handling and graceful shutdown are wired in `src/index.ts`

### Frontend workspaces
- static workspace UIs in `public/`
- each workspace is a task-specific operator console over the same backend API
- shared browser API client lives in `public/api-client.js`

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
- development database: SQLite
- production-oriented target database: PostgreSQL-compatible platform on Azure
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
- RBAC for authorization boundaries between participant, reviewer, appeal handler, calibrator, and administrator
- i18n/l10n conventions using supported locales `en-GB`, `nb`, and `nn`
- immutable decision lineage as a domain-level auditability rule
- semantic versioning for releases, documented in `doc/VERSIONS.md`

## Workspaces and Roles

The platform separates human tasks by workspace and role.

### Participant workspace
- route: `/participant`
- role: `PARTICIPANT`
- purpose: browse modules, submit work, monitor progress, view results, create appeals

### Completed modules workspace
- route: `/participant/completed`
- role: `PARTICIPANT`
- purpose: review historical completion and result state across modules

### Manual review workspace
- route: `/manual-review`
- roles: `REVIEWER`, `ADMINISTRATOR`
- purpose: handle submissions that require human review before finalisation

### Appeal handler workspace
- route: `/appeal-handler`
- roles: `APPEAL_HANDLER`, `ADMINISTRATOR`
- purpose: triage, claim, and resolve participant appeals

### Calibration workspace
- route: `/calibration`
- roles: `CALIBRATOR`, `ADMINISTRATOR`
- purpose: inspect calibration cases and compare assessment behaviour

### Admin content workspace
- route: `/admin-content`
- roles: `ADMINISTRATOR`
- purpose: create and publish versioned modules, prompts, rubrics, benchmark examples, and MCQ sets

## Key Architectural Boundaries

### Manual review and appeals are different workflows
- manual review happens before or around finalisation of an assessment outcome when the system needs human intervention
- appeals happen after a participant disputes an outcome
- the UI and operating model should keep these queues separate even when they relate to the same submission

### Decisions are immutable
- assessments, review overrides, and appeal resolutions create distinct decision records
- this preserves auditability and makes decision lineage inspectable

### Configuration drives runtime behaviour
- environment variables and participant-console config control polling, debug visibility, seeded identities, and workspace behaviour
- production-only and staging-only behaviour should be controlled server-side, not by client toggles

### Audit and observability are first-class concerns
- audit events, operational logs, and reporting endpoints are part of the system design, not afterthoughts
- background workers and SLA monitors must produce structured runtime evidence

## Deployment Shape

Current deployment model:
- Node.js application deployed to Azure App Service
- Prisma-backed relational database
- staging deploy on push to `main`
- production deploy behind manual approval
- Azure Monitor / runbook support for operations

Development currently uses SQLite bootstrap, while production-oriented deployment targets PostgreSQL-compatible infrastructure. That mismatch is already tracked as architectural debt.

## Known Architectural Debt

The most important currently known gaps are:
- repository pattern is incomplete across service domains
- development database engine does not match production target architecture
- some broader unit-test coverage still depends too much on integration setup
- several architecture decisions live across design notes and release notes rather than one permanent reference

## Related Documents

- `README.md`
- `doc/APPEALS_OPERATING_MODEL.md`
- `doc/I18N.md`
- `doc/M0_IMPLEMENTATION_DECISIONS.md`
- `doc/M1_IMPLEMENTATION_DECISIONS.md`
- `doc/AZURE_ENVIRONMENTS.md`
- `doc/VERSIONS.md`
