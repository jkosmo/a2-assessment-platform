## Note

These issue drafts are ready to be created in GitHub, but GitHub auth was expired when this document was written. They are ordered by recommended implementation priority.

## 1. Admin Content: add DOM interaction tests for module and course authoring flows

### Why

Most current defects are UI-state and interaction defects, not backend defects.

### Scope

- establish `vitest` + `jsdom` DOM tests for:
  - conversational module shell
  - advanced module editor
  - courses UI
- add tests for:
  - save/publish state transitions
  - preview-before-accept behavior
  - duplicate menu prevention
  - handoff/resume behavior
  - locale switching

### Acceptance

- at least 8 high-value DOM interaction scenarios exist
- tests run in CI
- failures are actionable and not snapshot-noise-heavy

## 2. Admin Content: add Playwright critical-path coverage for shell, advanced editor, and courses

### Why

Several regressions only show up in real browser behavior.

### Scope

- add Playwright to the repo
- create browser tests for:
  - module generate/revise/save/publish
  - shell to advanced roundtrip
  - course create/edit/publish
  - file upload source material
  - Enter vs Shift+Enter

### Acceptance

- critical-path e2e suite runs against local app or staging-ready environment
- failures clearly identify browser-only regressions

### Progress note

An initial Playwright suite now exists and runs against a lightweight static admin-content server with mocked API responses.

The first browser scenarios cover:

- shell idle state -> open existing module -> module picker choices render
- courses conversational title step using Enter
- courses delete dialog behavior
- axe smoke checks on shell and courses routes

The next step for this draft item is to widen browser coverage to:

- shell <-> advanced handoff
- save/publish flows
- locale switching
- file upload source-material flow

## 3. Admin Content: add dynamic WCAG and keyboard regression coverage

### Why

Static attribute checks are not enough for these workspaces.

### Scope

- automate:
  - keyboard navigation
  - focus return after dialogs
  - live region and `aria-busy` checks
  - route-level axe scans
- cover:
  - conversational shell
  - advanced editor
  - courses

### Acceptance

- WCAG automation exists for the core authoring routes
- focus regressions are caught automatically

## 4. Admin Content: add UI contract and visual consistency regression coverage

### Why

Module, course, library, and advanced views must feel like one product.

### Scope

- add stronger HTML/DOM contract tests for shared chrome and action patterns
- add screenshot baselines or equivalent visual regression for key states
- enforce:
  - one primary action cluster per state
  - consistent header/navigation scaffolding
  - consistent action naming and layout

### Acceptance

- key admin-content surfaces have screenshot or equivalent contract coverage
- obvious UI drift is caught before staging review

## 5. Admin Content: extract UI state logic into testable modules

### Why

Large DOM-heavy files are expensive to test directly.

### Scope

- extract pure logic from:
  - `admin-content-shell.js`
  - `admin-content.js`
  - `admin-content-courses.js`
- focus on:
  - state transitions
  - action selection
  - preview state mapping
  - handoff state

### Acceptance

- the most error-prone state logic is testable without DOM setup
- new unit tests cover those extracted modules

### Progress note

Initial extraction is now done for:

- shell revision-target detection and action ordering
- advanced/conversational handoff route building
- course route detection, delete-copy generation, and list-row derivation

This means the next step for this draft item is not more extraction for its own sake, but using the extracted modules to grow DOM/browser coverage around the remaining interaction-heavy flows.
