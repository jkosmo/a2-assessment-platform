## Purpose

Admin Content now has enough behavioral complexity that backend integration tests and static HTML contract checks are no longer sufficient. The main defects are happening in UI state transitions, conversational/advanced handoff, preview rendering, keyboard behavior, and visual consistency between module and course surfaces.

This strategy defines the quality layers we need in order to catch:

- broken authoring flows
- duplicate or missing actions in a given state
- lost context when moving between conversational and advanced editing
- language/preview mismatches
- accessibility regressions
- inconsistent UI patterns across module, course, library, and calibration workspaces

## Current Gap

The repository already has useful coverage for:

- admin content API and publication workflows
- course admin API workflows
- translation key parity
- static workspace HTML fallbacks
- basic accessibility hook presence
- state rail derivation logic

The main gap is that we barely test the actual browser-facing behavior of:

- [public/static/admin-content-shell.js](/C:/Users/JoakimKosmo/a2-assessment-platform/public/static/admin-content-shell.js)
- [public/admin-content.js](/C:/Users/JoakimKosmo/a2-assessment-platform/public/admin-content.js)
- [public/static/admin-content-courses.js](/C:/Users/JoakimKosmo/a2-assessment-platform/public/static/admin-content-courses.js)

## Recommended Quality Model

### Layer 1: Pure logic and rendering contracts

Goal: make preview/localization/state mapping testable without a browser.

Coverage:

- preview rendering helpers
- locale resolution and fallback
- shell/editor/course state mapping
- module/course UI contract invariants

Fastest feedback. Should run in every test pass.

### Layer 2: DOM interaction tests

Goal: verify that the UI reacts correctly to realistic user actions.

Coverage:

- button order and visibility per state
- save/publish/archive/delete lifecycle actions
- conversational revision flow
- advanced editor roundtrip
- course create/edit/publish flows
- prevention of duplicate menus and duplicate action groups

Preferred stack:

- `vitest` + `jsdom`
- `@testing-library/dom`
- `@testing-library/user-event`

### Layer 3: Browser end-to-end tests

Goal: catch the issues that only show up in a real browser.

Coverage:

- Enter vs Shift+Enter behavior
- focus transitions
- dialog behavior
- file upload flows
- locale switching
- handoff between conversational and advanced editor
- course/module cross-navigation

Preferred stack:

- `playwright`

### Layer 4: Accessibility automation

Goal: catch dynamic accessibility regressions, not just missing attributes.

Coverage:

- keyboard-only navigation
- focus management after save/publish/dialog close
- live region announcements
- `aria-busy` transitions
- actionable element names
- route-level WCAG smoke checks

Preferred stack:

- `axe` in browser-based tests
- explicit keyboard/focus assertions in Playwright

### Layer 5: Visual and UI consistency regression

Goal: ensure the admin-content surfaces still feel like one product.

Coverage:

- shell empty state
- shell generated draft state
- shell saved state
- advanced editor loaded state
- course list
- course detail
- library list
- destructive dialog states

Preferred stack:

- Playwright screenshots or DOM state fixtures

## First Implementation Order

1. Add explicit backlog/issues for the missing test layers.
2. Strengthen pure rendering and UI contract tests.
3. Add DOM interaction test harness for shell, advanced, and courses.
4. Add Playwright critical-path flows.
5. Add dynamic accessibility checks and screenshot baselines.

## Critical Scenarios We Must Eventually Automate

### Module authoring

- create or load module
- generate draft
- preview updates before acceptance
- revise scenario/guidance in free text
- generate MCQ
- revise a targeted option such as `1C` and verify substantive change
- save
- publish

### Conversational/advanced handoff

- open advanced editor from shell
- return to conversational editor
- keep same module selected
- keep edit intent and context

### Courses

- create course
- add modules
- reorder modules
- publish/unpublish/archive
- return to course list

### Locale and preview

- switch between `en-GB`, `nb`, and `nn`
- preview content changes correctly
- no stale locale artifacts remain

### Safety and clarity

- only one primary action cluster per state
- no duplicated menus after save/publish
- destructive actions require the correct guardrails

## Acceptance Criteria For This Test Program

We should consider the new test program minimally established when:

- critical preview helpers have unit coverage
- admin-content surfaces have stronger shared UI contract coverage
- we can run at least one DOM interaction suite locally
- we can run at least one real-browser critical-path suite in CI
- WCAG checks exist for the most important module/course authoring flows

## Practical Decision

Until DOM/browser coverage is in place, manual testing will continue to find defects earlier than automation. The goal of this strategy is to invert that relationship, so regressions are caught before staging review rather than during staging review.
