# Conversational Admin Content: UI and WCAG Review Checklist

**Related issues:** `#311`, `#317`, `#312`  
**Scope:** `/admin-content`, `/admin-content/advanced`  
**Last updated:** 2026-04-17

## Purpose

This checklist is for the deliberate UI and WCAG-oriented review that should happen
before the redesign is treated as finished.

It is intentionally focused on the Admin Content redesign rather than the broader
platform.

## A. Structure and Semantics

- Page has a single clear `h1`
- Skip link works
- Main regions are semantically distinct
- Shell preview and chat regions have understandable labels
- Advanced editor sections and dialogs have stable headings

## B. Keyboard Operability

- All shell choices are reachable without mouse
- Enter submits short-form chat inputs
- Shift+Enter preserves multiline entry where relevant
- File upload button is keyboard reachable
- Preview locale buttons are keyboard reachable
- Advanced-editor dialogs are keyboard operable
- No keyboard trap exists in dialog or preview panel

## C. Focus Management

- Focus moves to the next meaningful control after user-triggered mode changes
- Focus does not disappear after async generation
- Returning from advanced to shell restores useful context
- Opening advanced from shell preserves useful context
- Confirmation flows return focus predictably after cancel

## D. Dynamic Content and Announcements

- Chat updates are announced politely, not aggressively
- Generation progress has a meaningful textual state, not spinner only
- Save/publish/archive/restore results are announced
- Live-region behaviour is informative without becoming noisy

## E. Visual Clarity

- Preview is clearly the primary review surface for generated content
- Action grouping is understandable
- Save / publish / archive / delete states are easy to distinguish
- Draft vs saved vs published status is visually consistent across shell and advanced
- Chat history does not become the only place where state is explained

## F. Conversational / Advanced Coherence

- Terminology is aligned between the two UIs
- Same module stays selected through roundtrip
- Same mental model is preserved for:
  - draft
  - saved version
  - published version
- One-response-per-module assumption is visible and understandable in both UIs

## G. Error Handling

- Upload errors are clear and actionable
- Generation errors do not leave the shell in a broken state
- Save/publish/delete errors explain enough to recover
- Empty/unsupported input states are understandable

## H. Severity Guide

Use this simple severity model during review:

- `P0`
  blocks safe use or causes data/context loss
- `P1`
  major UX/accessibility failure, but user can still proceed
- `P2`
  meaningful friction or inconsistency
- `P3`
  polish issue

## Exit Signal

The redesign should not be called “finished” until:

- no `P0` or `P1` issues remain in shell or roundtrip
- shell and advanced feel like one coherent authoring product
- keyboard-only flow is acceptable for the main journeys
