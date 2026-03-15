# Phase 2 Design: Admin Content Workspace V2

## Related Issues
- `#94` Admin Content UX: show human-readable versions and redesign module status/actions
- `#95` Admin Content: add draft JSON import and LLM-assisted authoring workflow
- `#93` Participant UX: simplify submission form labels and verify module-driven context
- `#47` Phase 2 Discovery: Usability analysis and moderated UX testing

## Context
The current `admin-content` workspace is functionally capable but cognitively heavy.

What exists today:
- base module creation
- module selection
- creation of rubric versions
- creation of prompt template versions
- creation of MCQ set versions
- creation of module versions
- publication of a selected module version
- export/readback of a full module configuration bundle

What is missing:
- a clear mental model for content owners
- visible, human-readable versioning in the UI
- an obvious distinction between active published content and draft changes
- a low-friction authoring flow for content owners who want to prepare content outside the form

The core problem is that the backend is version-based and append-only, while the UI still feels like a single mutable form.

## Problem Statement
Content owners currently face three UX problems:

1. The module-selection and action area is visually dense.
- Several similar buttons sit close together with weak hierarchy.
- The workspace does not clearly communicate what the next safe action is.

2. Version lineage is technically correct but nearly invisible.
- The system already tracks `versionNo` for rubric, prompt, MCQ, and module versions.
- The UI mainly exposes long opaque IDs instead of clear labels like `v1`, `v2`, and `Live`.
- A content owner cannot easily answer:
  - Which version is currently live?
  - What will new submissions use?
  - Am I editing an existing live version or preparing a new draft version?

3. Authoring is too form-driven and too fragmented.
- The current workflow requires a content owner to understand the internal decomposition into rubric, prompt, MCQ, and module version.
- This is powerful for technical operators, but it hides the whole module concept from content producers.
- Export exists, but import does not. This prevents an authoring loop where an LLM or external drafting process produces a structured module draft that can then be reviewed in the workspace.

## Existing Domain Model
The current versioning model is sound and should be preserved.

### Stable module container
- `Module` is the stable logical container for a module over time.

### Append-only content versions
- `RubricVersion.versionNo`
- `PromptTemplateVersion.versionNo`
- `MCQSetVersion.versionNo`
- `ModuleVersion.versionNo`

Each new saved change creates a new version row rather than mutating published history.

### Published version pointer
- `Module.activeVersionId` points to the currently active `ModuleVersion`.
- New participant submissions use the active published `ModuleVersion`.
- Existing submissions retain the `moduleVersionId` they were created with.

### Implication
The right UX is not "edit in place".
The right UX is:
- load current content
- modify draft values
- save a new version set
- publish the new module version when ready

## Design Goals
- Make the version model understandable without backend knowledge.
- Reduce button clutter and increase action clarity.
- Let content owners see the current live state at a glance.
- Preserve append-only version lineage and auditability.
- Support import-first authoring for non-technical content production.
- Keep raw technical IDs available for debugging, but secondary.

## Non-Goals
- Do not replace append-only versioning with mutable editing.
- Do not auto-publish imported content.
- Do not let LLM-generated JSON bypass human review.
- Do not collapse rubric/prompt/MCQ/module version into one backend table.

## Options Considered

### Option 1: Keep current workspace and add more hints
- Pros:
  - smallest implementation cost
  - no new layout model
- Cons:
  - does not solve the main problem
  - adds more explanatory text to an already dense page
  - still leaves versions opaque

Rejected.

### Option 2: Redesign the top of the workspace around module status and action hierarchy
- Pros:
  - directly addresses confusion around current state and next action
  - exposes `versionNo` cleanly as `v1`, `v2`, etc.
  - preserves current backend model
- Cons:
  - moderate frontend redesign
  - needs a small status/read model in the UI

Chosen for `#94`.

### Option 3: Add import directly into persistence
- Pros:
  - fastest path from draft file to stored content
- Cons:
  - too risky
  - bypasses user review
  - makes validation and publish semantics harder to explain

Rejected.

### Option 4: Add draft JSON import that only populates the editor
- Pros:
  - preserves human review and publication control
  - fits existing export/readback flow
  - works well with LLM-assisted authoring
- Cons:
  - requires a separate authoring/import schema
  - adds a validation layer

Chosen for `#95`.

## Chosen Approach

### 1. Reframe the workspace around "module state" first
The top of `admin-content` should become a module status surface, not just a utility strip.

Recommended top-level structure:

1. `Create new module`
2. `Open existing module`
3. `Module status`
4. `Content editor`
5. `Publish`

### 2. Introduce a module status card
When a module is selected, show a prominent status card with:
- module name
- module id in secondary metadata
- current state:
  - `Live`
  - `Draft changes loaded`
  - `No published version`
- active module version as `vN`
- linked rubric version as `vN`
- linked prompt version as `vN`
- linked MCQ version as `vN`
- last published timestamp

Raw IDs should still be accessible, but in a collapsed or lower-emphasis area.

### 3. Show human-readable versions using existing `versionNo`
No new versioning logic is required.

Display rules:
- `ModuleVersion.versionNo` => `Module version v{n}`
- `RubricVersion.versionNo` => `Rubric v{n}`
- `PromptTemplateVersion.versionNo` => `Prompt v{n}`
- `MCQSetVersion.versionNo` => `MCQ v{n}`

Each version badge should optionally expose the raw ID as secondary text or in a details panel.

### 4. Reduce action clutter through explicit hierarchy
Current adjacent actions should be restructured into:

Primary actions:
- `Load draft`
- `Save new draft version`
- `Publish draft`

Secondary actions:
- `Export`
- `Import draft JSON`
- `Delete empty module`

Avoid a cluster of equal-weight buttons with similar visual treatment.

### 5. Make the update process explicit
The workspace should explain the actual lifecycle in a short status summary:

`Live now: Module v2 using Rubric v2, Prompt v3, MCQ v2`

`Editing now: draft values not yet saved`

Or:

`Latest saved draft: Module v3 (not published)`

This lets a content owner understand:
- what participants currently use
- whether they are preparing a new revision
- whether publication is still pending

### 6. Support import-first authoring
Add a new workflow:
- content owner imports a draft JSON file
- the workspace validates the shape
- valid content populates the form fields
- content owner reviews and edits
- content owner saves new versions
- content owner publishes when ready

This makes the UI an approval/editor surface rather than the only authoring surface.

## Proposed UI Model

### Section A: Create or open
Left side:
- create new module shell

Right side:
- open existing module
- search/select module
- load

### Section B: Module status
Show:
- module title
- active status
- live version chain
- latest saved draft chain, if different
- publish state

### Section C: Authoring source
Two entry paths:
- `Edit in form`
- `Import draft JSON`

Optional helper copy:
- one short sentence only
- no stacked info text under every field

### Section D: Content editor
Keep the internal decomposition, but present it with clearer grouping:
- `Scoring`
- `LLM evaluation`
- `Knowledge test`
- `Participant-facing module text`

### Section E: Publish
Show a publish-ready summary:
- what version chain will go live
- whether it differs from current live chain
- publish action

## Import Format Strategy

### Principle
Use two separate JSON shapes:

1. `Technical export`
- full fidelity
- includes ids, timestamps, version history
- suited for debugging and round-trip inspection

2. `Authoring import draft`
- simpler
- no internal IDs required
- optimized for human and LLM production

### Suggested draft import shape
```json
{
  "module": {
    "title": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    },
    "description": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    },
    "certificationLevel": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    },
    "validFrom": "2026-03-01",
    "validTo": "2027-03-01"
  },
  "rubric": {
    "criteria": {},
    "scalingRule": {},
    "passRule": {}
  },
  "promptTemplate": {
    "systemPrompt": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    },
    "userPromptTemplate": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    },
    "examples": []
  },
  "mcqSet": {
    "title": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    },
    "questions": []
  },
  "moduleVersion": {
    "taskText": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    },
    "guidanceText": {
      "en-GB": "...",
      "nb": "...",
      "nn": "..."
    }
  }
}
```

### Validation rules
- no publish on import
- no direct version ids accepted
- all required localized fields must be present where needed
- MCQ answers must still validate against options
- clear field-level validation errors on import failure

## LLM-Assisted Authoring Flow

### Content-owner workflow
1. Gather source materials.
2. Use a standard authoring prompt plus source content in an LLM.
3. Ask the LLM to return the draft import JSON only.
4. Import the JSON into `admin-content`.
5. Review and edit in the UI.
6. Save new draft versions.
7. Publish explicitly.

### Required supporting assets
- prompt template for content owners
- import JSON schema or exemplar
- short guidance on what source files to provide to the LLM

### Safety constraints
- imported content is a draft, not a final system-of-record write
- publication remains explicit and manual
- validation must be deterministic and local to the app

## Operational Impact
- No change to append-only publication semantics.
- No destructive change to existing module/submission lineage.
- New import flow should remain entirely behind existing admin role guards.
- Export/import should be auditable if later persisted as explicit events.

## Rollout Strategy

### Slice 1
- redesign module status/action area
- show `vN` labels for versions
- expose active/live chain and latest draft chain

### Slice 2
- add draft import JSON UI
- add schema validation and field population

### Slice 3
- add documented prompt/template for LLM-assisted authoring
- optionally add downloadable schema/example bundle

## Rollback
- UI redesign can be reverted without data migration
- import workflow is additive and can be disabled without affecting stored content

## Open Questions
- Should import support benchmark examples in the first iteration, or only the core module package?
- Should the module status card show full version history or only live + latest draft?
- Should raw IDs live in expandable details, copy buttons, or a debug mode?
- Should we add a dedicated `retire/archive module` action later instead of overloading delete semantics?

## Recommendation
Proceed with:
- `#94` first, because version visibility and action clarity are prerequisites for safe content updates
- `#95` second, because import becomes much easier to place once the authoring workflow is clearer

Treat `#93` as a parallel participant UX refinement driven by the same “less is more” principle.
