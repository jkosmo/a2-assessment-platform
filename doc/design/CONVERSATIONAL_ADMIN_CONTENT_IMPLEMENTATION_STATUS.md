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

The shell preview is functional, but has until now been shallower than the design intent:

- scenario / task text was truncated in preview
- guidance text was truncated in preview
- MCQ count was shown, but not the actual MCQ content

This is being extended in the current implementation round.

### MCQ generation control

MCQ generation exists, but had been opinionated:

- question count was hardcoded in the shell
- answer option count was fixed in the prompt
- the chat did not ask the user how many questions or options to generate

This is also being addressed in the current implementation round.

## Not Yet Implemented

### Free-form conversational edit/apply loop (`#297`)

The biggest remaining gap versus the approved design is still the free-form
edit loop. The current shell is primarily structured and guided. It does **not**
yet support:

- arbitrary edit instructions in chat
- intent classification into typed `CommandIntent`
- editing scenario text, guidance text, MCQ, and version content directly through free-form chat
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
