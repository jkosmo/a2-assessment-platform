# Conversational Admin Content: Implementation Status

**Related epic:** `#293`  
**Reference design:** [CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md](./CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md)  
**Last updated:** 2026-04-15

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

### Free-text revision loop is now partially present

The shell now supports a first real free-text revision loop for generated content:

- revise scenario / guidance through chat after a draft has been generated
- revise MCQ through chat after questions have been generated
- keep the preview pane in sync before the user moves on to the advanced editor

This is still narrower than the full `#297` design:

- there is no general intent-classifier yet
- revisions are targeted to draft text and MCQ, not the full content surface
- there is no multilingual apply/translate workflow yet

## Not Yet Implemented

### Full free-form conversational edit/apply loop (`#297`)

The biggest remaining gap versus the approved design is still the *full* free-form
edit loop. The current shell now supports targeted free-text revision for draft text
and MCQ, but it does **not** yet support:

- intent classification into typed `CommandIntent`
- editing rubric, prompt, submission schema, assessment policy, and version content directly through free-form chat
- conversational translation/apply flows across locales

### Safe conversational CRUD and publish flows (`#298`)

The advanced editor and backend APIs support the underlying operations, but the
conversational shell does not yet expose the full guarded action model described in the design:

- save draft with version-chain confirmation
- publish with confirmation card
- archive / restore / delete via chat
- typed confirmation for destructive actions

### Translation flow

The design allows the user to explicitly request translation of authored content
into the remaining locales. That flow is not yet implemented in the shell.

### File upload source-material intake (`#310`)

The shell currently accepts pasted text source material. It does not yet expose
document upload in the conversational intake flow.

## Recommended Remaining Order

1. Finish shell usability gaps:
   - richer preview
   - MCQ generation controls
2. Implement free-form conversational edit loop (`#297`)
3. Implement guarded conversational CRUD/publish flows (`#298`)
4. Add file upload source-material intake (`#310`)
5. Close out test/docs/rollout work (`#299`)

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
