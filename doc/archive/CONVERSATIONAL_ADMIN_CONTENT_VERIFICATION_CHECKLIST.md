# Conversational Admin Content: Verification Checklist

**Related issues:** `#299`, `#311`, `#312`, `#319`  
**Scope:** `/admin-content` and `/admin-content/advanced`  
**Last updated:** 2026-04-17

## Purpose

Use this checklist for the first full verification pass after the remaining Admin Content
redesign work has landed on staging.

The goal is to verify:

- conversational authoring flow
- roundtrip between conversational and advanced editing
- save / publish / archive / restore safety
- one free-text submission model in both UIs
- keyboard and screen-reader relevant behaviour

## Test Data

Prepare at least:

- one existing live module
- one existing draft-only module
- one archived module
- one source document in `.txt`
- one source document in `.pdf` or `.docx`

If possible, also keep one course with several modules available so that the new
`one response per module` model can be judged against realistic course authoring.

## Core Conversational Flow

### VC-001 New module shell

- Open `/admin-content`
- Choose `Create new module`
- Enter a module title
- Add source material
- Pick certification level
- Pick generation mode

Expected:

- module shell is created
- draft appears in preview
- preview language switcher appears
- no raw source dump is shown in the visible text field after file upload

### VC-002 Source material upload

- Upload one supported file
- Verify that the shell reports the file as added
- Add optional short notes in the text field
- Continue generation

Expected:

- file is accepted without dumping the entire extracted text into the visible textarea
- generation uses both uploaded material and any typed notes
- unsupported file types fail with a clear message
- oversized source material fails with a clear message

### VC-003 Difficulty calibration

- Generate one `basic` draft
- Generate one `intermediate` draft
- Generate one `advanced` draft

Expected:

- `basic` is materially simpler and more direct
- `advanced` can be more nuanced, but not artificially complex
- `thorough` feels more polished, not automatically harder

### VC-004 Guidance discipline

- Inspect generated `What we expect in the submission`

Expected:

- guidance is useful to the participant
- guidance does not read like an answer key
- guidance does not reveal the exact target answer structure too aggressively

## MCQ Flow

### VC-010 MCQ generation parameters

- Generate MCQ from the shell
- Choose custom number of questions
- Choose custom number of options

Expected:

- chosen counts are reflected in the resulting draft
- preview renders the actual MCQ questions, options, correct answer, and rationale

### VC-011 MCQ quality

- Inspect at least three generated questions

Expected:

- correct answer is not obvious simply because it is longer or more precise
- distractors are plausible
- questions align with the source material and the selected certification level

### VC-012 Targeted MCQ revision

- Ask to change one specific option, for example `change option 1C`

Expected:

- the referenced option changes materially
- the result is not just a cosmetic rephrasing
- if the system cannot do this safely, it should fail clearly rather than pretend success

## Save / Publish / Lifecycle

### VC-020 Save draft

- Save a draft from the conversational shell

Expected:

- a new module version is created
- shell status changes from unsaved draft to saved draft
- preview remains coherent

### VC-021 Publish

- Publish the latest saved version from the shell

Expected:

- explicit confirmation is shown before publish
- publish succeeds only when a saved version exists
- after publish, state rail and preview reflect live status

### VC-022 Unpublish

- Unpublish a live module from the shell

Expected:

- explicit confirmation is shown
- success and failure are clearly surfaced

### VC-023 Archive / restore

- Archive a module from the shell
- Restore it from the archive picker

Expected:

- archive requires explicit confirmation
- archived module disappears from the main working context
- restored module can be loaded again

### VC-024 Delete

- Attempt to delete an eligible module

Expected:

- user must type the module name exactly
- deletion only succeeds when backend business rules allow it
- mismatch does not delete anything

### VC-025 Duplicate

- Duplicate an existing module from the shell

Expected:

- a new draft module is created
- content chain is copied over as a new draft lineage
- duplicated module is not accidentally published

## Conversational / Advanced Roundtrip

### VC-030 Shell -> advanced

- Open a module in the shell
- Make unsaved chat edits
- Click the advanced-editor link

Expected:

- if there is unsaved draft work, the user gets a clear handoff choice
- taking the draft carries task text, guidance, and MCQ into advanced
- saving first preserves the latest saved state

### VC-031 Advanced -> shell

- Open `/admin-content/advanced?moduleId=...`
- Make unsaved changes
- click `Back to conversational editor`

Expected:

- handoff preserves module context
- shell opens the same module, not a blank state
- when `resumeEditing=1` is present, shell opens in editable draft mode

### VC-032 One response field model

- Open submission schema in advanced
- Inspect participant-facing preview

Expected:

- advanced editor defaults to one free-text response field
- conversational and advanced paths produce the same practical submission shape
- raw JSON fallback remains available but is no longer the primary path

## Accessibility / Keyboard

### VC-040 Keyboard-only shell pass

- Use keyboard only through:
  - module selection
  - new module flow
  - MCQ question-count and option-count flow
  - revision flow
  - open advanced editor
  - publish / unpublish / archive / delete confirmation

Expected:

- all major actions are reachable with keyboard only
- focus is visible
- focus does not disappear after async actions

### VC-041 Status announcements

- Trigger:
  - generation
  - save
  - publish
  - archive
  - restore

Expected:

- status changes are announced politely
- live region does not spam during ongoing work
- results are understandable without relying on toast only

## Rollout Readiness Criteria

Conversational Admin Content is ready for broader use when:

- all `VC-001` to `VC-032` pass
- keyboard-only shell pass is acceptable
- no critical context-loss bug remains in shell/advanced roundtrip
- save/publish/archive/delete are all guarded and trustworthy
- the one-response-per-module model is coherent in both UIs

If any of these fail, keep the advanced editor as the recommended fallback path.
