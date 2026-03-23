# Module Transaction Boundary Cutover Plan

## Context

`#252` is not a general repository cleanup issue. It is a boundary-hardening issue:

- module orchestration/services should stop importing the root Prisma client directly
- transaction ownership should be explicit and reviewable
- repositories may still own persistence details and default to the root Prisma client

Current `HEAD` already has the right direction in many places:
- repositories expose `create*Repository(tx)` factories
- several workflows already wrap writes in `prisma.$transaction(...)`
- lineage and audit helpers already accept transaction-scoped clients

What is still mixed today is that multiple orchestration files both:
- decide the business workflow
- import the root Prisma client just to start a transaction or define transaction client types

That keeps module boundaries porous and makes it harder to see which layer owns transaction start.

## Problem statement

The main hotspots are:
- `src/modules/submission/submissionService.ts`
- `src/modules/assessment/decisionService.ts`
- `src/modules/assessment/decisionLineageService.ts`
- `src/modules/review/manualReviewService.ts`
- `src/modules/appeal/appealService.ts`
- `src/modules/adminContent/adminContentCommands.ts`
- `src/modules/certification/recertificationService.ts`
- `src/modules/user/pseudonymizationService.ts`
- `src/modules/retention/auditRetentionService.ts`

These files currently use the root Prisma client directly for one or more of:
- starting a transaction
- typing transaction-scoped clients
- issuing direct persistence queries from orchestration code

## Goals

- remove direct `prisma` imports from targeted module service/orchestration files
- make transaction start explicit via a small shared transaction runner
- move transaction client typing to a shared DB boundary instead of each service importing `prisma`
- keep repository ownership of persistence intact
- avoid a compatibility layer that preserves both old and new patterns long-term

## Non-goals

- rewriting every repository type in the codebase
- introducing a heavy unit-of-work abstraction
- refactoring all module repositories in the same batch

## Chosen approach

### 1. Introduce one explicit DB transaction boundary

Add a small shared DB helper that owns:
- `runInTransaction(...)`
- the shared `DbTransactionClient` type

This becomes the only place module services need in order to start transactions or describe transaction-scoped clients.

### 2. Keep repositories transaction-aware, but service-agnostic

Repositories continue to support:
- default root client usage for non-transactional calls
- transaction-scoped usage via `create*Repository(tx)`

The important change is that services stop importing `prisma` directly and instead:
- call `runInTransaction(...)`
- pass the received `tx` into repositories and helper services

### 3. Eliminate direct Prisma imports from targeted module services

For targeted service/orchestration files:
- replace `prisma.$transaction(...)` with `runInTransaction(...)`
- replace `Pick<typeof prisma, ...>` transaction types with `Pick<DbTransactionClient, ...>`
- keep read/write logic otherwise stable unless a direct persistence call must move to a repository

### 4. Keep direct Prisma imports allowed in repositories for now

This issue is about orchestration boundaries first, not repository internals.

So:
- repositories may still import the root Prisma client
- scanners/repositories are not the primary target unless they are clearly service/orchestration code

## First cutover scope

The first full cutover batch should cover:
- `submissionService.ts`
- `decisionService.ts`
- `decisionLineageService.ts`
- `manualReviewService.ts`
- `appealService.ts`
- `adminContentCommands.ts`
- `recertificationService.ts`
- `pseudonymizationService.ts`
- `auditRetentionService.ts`

This gives us a real end-state signal:
- no targeted orchestration file imports `../../db/prisma.js`
- transaction start is centralized
- transaction client typing is centralized

## Risks and mitigations

### Risk: type churn in repository factories

Mitigation:
- keep existing repository `create*Repository(tx)` pattern
- only standardize the transaction client type where needed

### Risk: behavior change in multi-step write flows

Mitigation:
- keep business logic unchanged while moving only the transaction boundary
- verify with focused tests around submission, decision, review, appeal, and admin-content publication flows

### Risk: partial cutover leaves two competing transaction patterns

Mitigation:
- do not stop after adding the helper
- remove direct Prisma imports from all targeted orchestration files in the same batch

## Acceptance signals

- targeted module service/orchestration files no longer import `../../db/prisma.js`
- transaction start is expressed through one shared DB helper
- transaction client types come from the shared DB boundary rather than `typeof prisma`
- focused tests still pass for the affected workflows
