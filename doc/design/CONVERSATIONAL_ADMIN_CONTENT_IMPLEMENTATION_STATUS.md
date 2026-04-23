# Conversational Admin Content: Implementation Status

**Related epic:** `#293`  
**Reference design:** [CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md](./CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md)  
**Last updated:** 2026-04-17

## Purpose

This document tracks what is already implemented on the `epic/admin-content-redesign`
branch versus what still remains before the conversational Admin Content workspace
matches the approved design.

It is intentionally operational:
- what is live in code now
- what is partially implemented
- what is still missing

## Current Route Split

- `/admin-content`
  The new conversational shell
- `/admin-content/advanced`
  The existing advanced editor fallback

This matches the routing decision recorded in the design document.

## Implemented Now

### Slice 1 foundation is largely in place

The current shell already includes:

- split-pane workspace layout
- preview pane with live module state
- chat pane with guided flow
- module picker for existing modules
- new-module shell creation
- locale-aware preview switching
- persistent link to the advanced editor

### Source-material driven generation is already present

The shell already supports:

- pasting source material into chat
- uploading source material files through the conversational shell
- choosing certification level
- generating a draft via `POST /api/admin/content/generate/module-draft`
- generating MCQ via `POST /api/admin/content/generate/mcq`
- accepting or discarding generated results before continuing

### Non-blocking generation UX is present

The implementation already uses:

- background generation state
- progress cards in the chat
- abort/cancel for in-flight generation
- accept/discard after result is ready

## Partially Implemented

### Preview depth

The shell preview is functional, and the current branch now goes materially further:

- scenario / task text now renders in full
- guidance text now renders in full
- MCQ now renders as actual questions with options, correct answer, and rationale
- the preview pane is scrollable so long drafts and MCQ sets can be inspected without leaving the shell

There is still a UX gap around making the preview even more obviously the primary review
surface, but it is no longer just a shallow summary.

### MCQ generation control

MCQ generation exists and is now less opinionated than before:

- the shell now asks how many questions to generate
- the shell now asks how many answer options each question should have
- custom counts are supported within validated bounds

This is no longer just planned; it is implemented in the shell and backend prompt path.

### Free-text revision loop is now materially present

The shell now supports a bounded free-text edit/apply loop for the main authoring
surface:

- revise scenario / guidance through chat after a draft has been generated
- revise MCQ through chat after questions have been generated
- rename the module title through free-text chat
- refresh localized variants from the current preview language
- keep the preview pane in sync before the user moves on to the advanced editor

The important safety boundary is now explicit rather than implicit:

- chat edits are routed through a bounded classifier before execution
- broad or ambiguous requests are clarified instead of applied blindly
- rubric / prompt / submission-schema / assessment-policy changes are intentionally pushed to the advanced editor instead of being half-supported in chat

## Not Yet Implemented

### Safe conversational CRUD and publish flows are now materially in place

The conversational shell now exposes more of the lifecycle surface directly:

- save draft
- duplicate module
- publish latest saved version
- unpublish
- archive
- restore archived module
- delete with typed name confirmation

The remaining gap is no longer “CRUD is absent”, but rather:

- whether the action framing feels sufficiently coherent and trustworthy in final UX review
- whether duplicate / delete behaviour feels production-safe enough after manual staging verification

### Translation flow

The design allows the user to explicitly request translation of authored content
into the remaining locales. That flow is not yet implemented in the shell.

### File upload breadth (`#310`)

The shell now supports source-material upload for the current minimum set:

- `.txt`
- `.md`
- `.pdf`
- `.docx`
- `.doc`
- `.pptx`
- `.ppt`
- `.rtf`
- `.odt`
- `.odp`
- `.ods`

This closes the biggest functional gap in the intake flow. The main remaining work is
now extraction quality and staging verification, not format breadth.

## Recommended Remaining Order

1. Run the full manual verification checklist on staging
2. Complete the WCAG / UI review and severity triage
3. Decide which remaining shell/editor inconsistencies should block default rollout
4. Keep refining the deeper conversational edit loop where staging feedback shows real gaps

## Practical Takeaway

The redesign is no longer a blank-slate effort. The branch already contains a
working shell foundation and generation flow.

The remaining work is now mainly about:

- depth
- editability
- safe action coverage
- multilingual authoring flow

That means the next handoff should be treated as continuation of an existing shell,
not a fresh implementation from the design doc.

## Additional Design Decision (2026-04-17)

New authoring should standardise on **one free-text submission field per module**.

Reason:

- course-level structure now exists
- multi-part assessment can therefore be expressed through several modules in one course
- this gives a cleaner and more consistent model than multiple answer fields inside one module

Practical implication:

- the conversational shell is already aligned with this model
- the advanced editor should now be simplified toward the same model
- backend tolerance for richer submission schema can remain temporarily during transition

### Status update

The advanced editor is now being aligned to this same authoring model:

- the primary advanced authoring path standardises on one `response` textarea field
- advanced submission-schema editing is simplified toward that one-field model
- raw JSON fallback remains available for compatibility rather than as the primary workflow

## Verification and Review Assets

These review assets now exist to support the final completion pass:

- [CONVERSATIONAL_ADMIN_CONTENT_VERIFICATION_CHECKLIST.md](./CONVERSATIONAL_ADMIN_CONTENT_VERIFICATION_CHECKLIST.md)
- [CONVERSATIONAL_ADMIN_CONTENT_WCAG_CHECKLIST.md](./CONVERSATIONAL_ADMIN_CONTENT_WCAG_CHECKLIST.md)
