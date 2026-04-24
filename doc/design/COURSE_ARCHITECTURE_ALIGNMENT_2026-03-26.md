# Architecture Assessment: Courses vs Module-Focused Architecture

## Scope
This note assesses how the current Course implementation aligns with the application's module-focused architecture as of `2026-03-26`.

Reviewed implementation:
- `src/modules/course/`
- `src/routes/courses.ts`
- `src/routes/adminCourses.ts`
- call-sites from:
  - `src/modules/assessment/AssessmentDecisionApplicationService.ts`
  - `src/modules/review/manualReviewService.ts`
  - `src/modules/appeal/appealService.ts`

## Executive assessment
Overall assessment: `good fit, with a few explicit cross-module compromises`.

The Course feature is not an architectural outlier.
It generally follows the repo's preferred module shape:
- feature-local module folder
- explicit read-model types
- thin HTTP routes
- isolated business logic helpers
- limited exported surface

The remaining weaknesses are real, but they are mostly about cross-module integration style and repository ownership, not about the Course feature breaking the architecture.

## What aligns well

### 1. Course is implemented as its own feature module
The feature lives under `src/modules/course/` and is not spread arbitrarily across shared services.

Current shape:
- `courseCommands.ts`
- `courseCompletionService.ts`
- `courseQueries.ts`
- `courseReadModels.ts`
- `courseReport.ts`
- `courseRepository.ts`
- `index.ts`

Why this is good:
- clear ownership
- discoverable boundaries
- consistent with the rest of the codebase

### 2. HTTP routes are mostly thin adapters
`src/routes/courses.ts` and `src/routes/adminCourses.ts` mostly:
- validate input
- read request context
- call course module functions
- map response DTOs

Why this is good:
- route logic is not becoming the business layer
- feature rules stay close to the feature

### 3. Course uses module-owned read models
`courseReadModels.ts` defines explicit DTO types instead of deriving route contracts directly from Prisma shapes.

Why this matters:
- this matches the broader architecture direction in the repo
- Course avoids one of the major gaps identified elsewhere in the solution-design backlog

### 4. Core course state is intentionally simple
The Course model is layered on top of existing module/certification concepts rather than inventing a parallel assessment model.

Examples:
- progress is derived from module/certification/submission state
- course completion is a small aggregate, not a second scoring engine
- modules remain the primary execution unit

Why this is good:
- Course extends the module-centric architecture instead of competing with it
- the application remains module-first, with Course as an organizing layer

### 5. Course UI also respects the module-first model
The participant flow keeps modules as the actionable unit.
Courses organize and expose modules, but do not replace the underlying module flow.

Why this is good:
- consistent mental model for users
- consistent domain model for developers

## Where the fit is weaker

### 1. Course completion is integrated as a direct cross-module side effect
`checkAndIssueCourseCompletions` is called directly from:
- assessment application
- manual review resolution
- appeal resolution

Current shape:
- originating modules know that Course must be checked after a final pass outcome
- the call is fire-and-forget with `.catch(...)` and operational logging

Why this is only a partial fit:
- it creates direct knowledge of Course inside other feature modules
- integration is explicit, but still somewhat coupled
- there is no shared post-decision hook or domain-event boundary

Assessment:
- acceptable for current size
- not ideal as the long-term pattern for many more feature add-ons

### 2. Course repository mixes several responsibility styles
`courseRepository.ts` currently contains:
- participant-facing reads
- admin reads
- reporting reads
- completion lookup/create
- certification/submission-derived aggregations

Why this is only a partial fit:
- the file remains understandable, but it is becoming a broad feature data hub
- reporting queries and completion persistence live next to simpler list/detail reads

Assessment:
- still manageable
- likely first refactor candidate if Course grows further

### 3. Reporting in Course reaches into other domains' data concerns
Course reporting depends on:
- submissions
- certification statuses
- course completions
- reporting filter types

Why this is slightly off the ideal:
- Course reporting is legitimate, but it means the Course module owns multi-domain aggregation logic
- this is practical, but blurs whether reporting is a Course concern or a Reporting concern

Assessment:
- acceptable in the current codebase
- should stay stable only if the reporting shape remains simple

### 4. Admin commands are still function-level, not application-service level
`createCourse`, `updateCourse`, `publishCourse`, `archiveCourse`, and `setCourseModules` are fine as standalone commands, but there is not yet a richer Course application service boundary.

Why that matters:
- for current complexity this is okay
- if Course gains more workflow semantics, command orchestration may spread into routes or multiple files

Assessment:
- no urgent problem
- worth watching, not worth refactoring now

## Bottom line

### Architectural fit score
`8/10`

Reasoning:
- strong modular placement
- strong DTO/read-model discipline
- preserves module-first execution semantics
- thin routes
- only moderate coupling concerns

### Main conclusion
Courses currently behave like a well-contained organizing layer on top of the module-centric application, not like a competing domain model.

That is the right shape.

The main remaining architectural compromise is this:
- Course completion is wired in as a direct side effect from assessment/review/appeal flows

That compromise is understandable and acceptable for MVP/post-MVP scale, but it is the first place I would revisit if the architecture continues to evolve toward stricter command/event boundaries.

## Recommended follow-up, if we want to harden this later

### Follow-up 1
Introduce a small post-decision integration boundary for feature side effects.

Target outcome:
- assessment/review/appeal do not call Course directly
- Course completion check plugs into a shared post-final-decision hook

### Follow-up 2
Split Course repository into smaller internal slices if the feature grows.

Likely split:
- admin/metadata reads
- participant/course-progress reads
- reporting reads
- completion persistence

### Follow-up 3
Keep Course as an organizing layer, not a second execution model.

Guardrail:
- modules remain the only real assessment unit
- Course should continue to compose modules, not absorb module behavior

## Final recommendation
Do not treat current Course architecture as a blocker for closing `#133`.

The implementation is sufficiently aligned with the application's module-focused architecture to be considered a valid fit.

If we do future architecture cleanup, Course should be included as a refinement candidate, not as a problem area requiring redesign.
