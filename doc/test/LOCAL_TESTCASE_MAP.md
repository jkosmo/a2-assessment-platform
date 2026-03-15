# Local Testcase Map

This document maps stable manual testcase IDs to the current local automated suites.

Purpose:
- make manual verification scripts easier to reference
- show which cases are already automated locally
- identify repeated staging checks that should no longer be done manually

## Status Values

- `automated_now`
- `manual_only`
- `candidate_for_automation`

## Core Participant / Policy

### TC-PART-001
- Purpose: participant can complete the core submission -> MCQ -> assessment flow
- Status: `automated_now`
- Automated by:
  - [m1-core-flow.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m1-core-flow.test.ts)
  - script: `npm run test:integration:core`

### TC-PART-002
- Purpose: participant result payload and personal history are available after assessment
- Status: `automated_now`
- Automated by:
  - [m2-participant-results-history.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m2-participant-results-history.test.ts)
  - script: `npm run test:integration:core`

### TC-POL-RED-001
- Purpose: clearly incomplete submission stays red and becomes automatic fail
- Status: `automated_now`
- Automated by:
  - [assessment-policy.integration.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/assessment-policy.integration.test.ts)
  - script: `npm run test:integration:policy`

### TC-POL-RED-002
- Purpose: unstable low-content red-flag aliases from the LLM are normalized and still become automatic fail
- Status: `automated_now`
- Automated by:
  - [assessment-policy.integration.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/assessment-policy.integration.test.ts)
  - [decision-service.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/unit/decision-service.test.ts)
  - script: `npm run test:integration:policy`

### TC-POL-YELLOW-001
- Purpose: true safety/compliance risk stays yellow and goes to manual review
- Status: `automated_now`
- Automated by:
  - [assessment-policy.integration.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/assessment-policy.integration.test.ts)
  - script: `npm run test:integration:policy`

### TC-POL-GREEN-001
- Purpose: strong submission stays green and passes automatically
- Status: `automated_now`
- Automated by:
  - [assessment-policy.integration.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/assessment-policy.integration.test.ts)
  - script: `npm run test:integration:policy`

## Review / Appeal

### TC-REV-001
- Purpose: reviewer queue exposes seeded/open review cases
- Status: `automated_now`
- Automated by:
  - [m2-manual-review.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m2-manual-review.test.ts)
  - script: `npm run test:integration:review`

### TC-REV-002
- Purpose: reviewer can claim and finalize override with immutable decision layering
- Status: `automated_now`
- Automated by:
  - [m2-manual-review.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m2-manual-review.test.ts)
  - script: `npm run test:integration:review`

### TC-APP-001
- Purpose: appeal create -> claim -> resolve flow works end-to-end
- Status: `automated_now`
- Automated by:
  - [m2-appeal-flow.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m2-appeal-flow.test.ts)
  - script: `npm run test:integration:review`

## Admin / Calibration

### TC-ADM-001
- Purpose: admin can create linked content versions, create module version, publish, and export
- Status: `automated_now`
- Automated by:
  - [m2-admin-content-publication.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m2-admin-content-publication.test.ts)
  - script: `npm run test:integration:admin`

### TC-ADM-002
- Purpose: admin can delete an empty module but not one with dependencies
- Status: `automated_now`
- Automated by:
  - [m2-admin-content-publication.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m2-admin-content-publication.test.ts)
  - script: `npm run test:integration:admin`

### TC-CAL-001
- Purpose: calibration workspace snapshot and access audit event work correctly
- Status: `automated_now`
- Automated by:
  - [m2-calibration-workspace.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/m2-calibration-workspace.test.ts)
  - script: `npm run test:integration:admin`

## UI / Workspace Contracts

### TC-UI-CONFIG-001
- Purpose: participant/config contract remains stable
- Status: `automated_now`
- Automated by:
  - [participant-console-config.test.ts](C:/Users/JoakimKosmo/a2-assessment-platform/test/participant-console-config.test.ts)
  - script: `npm run test:integration:contracts`

### TC-UI-I18N-001
- Purpose: workspace HTML keeps inline fallback content for no-JS or slow-load cases
- Status: `automated_now`
- Automated by:
  - [workspace-html-fallbacks.test.js](C:/Users/JoakimKosmo/a2-assessment-platform/test/workspace-html-fallbacks.test.js)
  - script: `npm run test:integration:contracts`

### TC-UI-A11Y-001
- Purpose: validation wiring and alert hooks remain present across workspaces
- Status: `automated_now`
- Automated by:
  - [workspace-validation-accessibility.test.js](C:/Users/JoakimKosmo/a2-assessment-platform/test/workspace-validation-accessibility.test.js)
  - script: `npm run test:integration:contracts`

### TC-UI-TR-001
- Purpose: translation bundles for participant/admin/calibration/completed views remain intact
- Status: `automated_now`
- Automated by:
  - [admin-content-translations.test.js](C:/Users/JoakimKosmo/a2-assessment-platform/test/admin-content-translations.test.js)
  - [participant-translations.test.js](C:/Users/JoakimKosmo/a2-assessment-platform/test/participant-translations.test.js)
  - [calibration-translations.test.js](C:/Users/JoakimKosmo/a2-assessment-platform/test/calibration-translations.test.js)
  - [participant-completed-translations.test.js](C:/Users/JoakimKosmo/a2-assessment-platform/test/participant-completed-translations.test.js)
  - script: `npm run test:integration:contracts`

## Manual-Only Cases

### TC-UI-VISUAL-001
- Purpose: browser-observed layout, spacing, visual hierarchy, and wording quality
- Status: `manual_only`

### TC-LLM-LIVE-001
- Purpose: repeated live Azure OpenAI variability check for canonical red/yellow/green cases
- Status: `manual_only`
- Current tool:
  - `npm run test:assessment:batch -- --repeat=10`

## Working Rule

When a manual testcase is repeated more than once and could be run deterministically against the local app/runtime, it should normally move from `candidate_for_automation` or `manual_only` into `automated_now`.
