# Phase 2 Design: Admin Content Workspace

## Context
The platform already exposes admin content APIs for rubric, prompt template, MCQ set, module version, and publish operations.  
What was missing was:
- a base-module creation API endpoint
- a dedicated UI workspace for content administrators to execute the full flow end-to-end

## Problem
Without a dedicated workspace, content lifecycle operations require direct API calls or database access.  
This increases test friction and creates inconsistent manual workflows.

## Options Considered
1. Extend `/participant` page with admin controls
- Pros: minimal new frontend files
- Cons: mixes participant and admin concerns; high UI complexity; role confusion

2. Build dedicated `/admin-content` workspace (chosen)
- Pros: clear separation of concerns; role-scoped navigation; reusable identity mock flow
- Cons: one extra frontend page to maintain

## Chosen Approach
- Add `POST /api/admin/content/modules` for base module creation.
- Add dedicated page `GET /admin-content` with form-based UI for:
  - module creation
  - module selection/loading
  - rubric version creation
  - prompt template version creation
  - MCQ set version creation
  - module version creation
  - module version publish
- Use existing role-gated admin content API endpoints.
- Keep behavior config-driven via existing participant console config:
  - shared role-based top navigation
  - workspace identity defaults (`identityDefaults.contentAdmin`)

## Data and API Impact
- New API endpoint:
  - `POST /api/admin/content/modules`
- No schema migration required.
- Existing audit pipeline extended with `module_created` events.

## Operational and Security Impact
- Endpoint remains behind existing API auth and role guard (`ADMINISTRATOR`, `SUBJECT_MATTER_OWNER`).
- No secret handling changes.
- No deployment/runtime startup contract changes.

## Rollout and Rollback
- Rollout: deploy app with new route/page and endpoint.
- Rollback: revert app version; no irreversible data migration required.
