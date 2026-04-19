# Design: Resource ownership scoping and privacy boundaries

**Issue:** #337  
**Status:** Design  
**Date:** 2026-04-19  
**Findings:** API-002 (HIGH), API-003 (MEDIUM), API-005 (MEDIUM)

---

## Problem

Three related authorization and privacy gaps share a root cause: role-level access is correctly gated at the router, but resource-level scoping inside the role is absent.

| Sub-issue | Gap |
|---|---|
| API-002 | Any `SUBJECT_MATTER_OWNER` can mutate (delete, archive, publish, unpublish, title PATCH) any module, including those created by other SMOs |
| API-003 | Any `SUBJECT_MATTER_OWNER` can call `/api/reports/completion?moduleId=<any-id>` and receive all participant data for that module without owning it |
| API-005 | `getSubmissionAuditTrail` returns `actor.email` for reviewer/handler events when a participant queries their own submission audit |

These are addressed together because they share the same design principle: filter the response based on _who is asking_, not just _are they logged in_.

---

## API-002: Module ownership isolation

### Current state

`Module` in Prisma has no `createdById` field. All mutating routes in `adminContent.ts` check only `actorId !== null`. Any SMO can call `DELETE /modules/:id`, `PATCH /modules/:id/title`, `POST /modules/:id/archive`, `POST /modules/:id/publish`, `POST /modules/:id/unpublish` on any module.

### Decision: Add `createdById` to Module with nullable migration path

Two options were considered:

| Option | Notes |
|---|---|
| **A: Add `createdById` field; ownership check on mutating routes** | Correct long-term design. Requires one migration. Existing modules keep `null` (backward-compat). |
| **B: Only ADMINISTRATOR may perform cross-module mutations** | No schema change. But SMOs lose the ability to manage their own modules without admin involvement — not viable for pilot workflow. |

**Decision: Option A.** SMOs need to manage their own modules during pilot. Option B creates admin bottlenecks. The schema migration is minimal.

### Schema change

```prisma
model Module {
  ...
  createdById  String?
  createdBy    User?   @relation("CreatedModules", fields: [createdById], references: [id], onDelete: SetNull)
  ...
}

model User {
  ...
  createdModules Module[] @relation("CreatedModules")
}
```

Migration: `createdById` is nullable. Existing rows remain `null` — they are treated as unowned and accessible to ADMINISTRATOR only for mutation. Newly created modules set `createdById` from `request.context.userId`.

### Route-level ownership check

For each mutating admin-content route, add an ownership check before the operation:

```typescript
async function assertModuleOwnership(moduleId: string, actorId: string, roles: string[]) {
  const isAdmin = roles.includes("ADMINISTRATOR");
  if (isAdmin) return; // admins can mutate any module

  const module = await adminContentRepository.findModuleOwner(moduleId);
  if (!module) throw new NotFoundError("Module");
  if (module.createdById === null) {
    // Legacy module (created before ownership tracking) — admin-only mutation
    throw new ForbiddenError("This module was created before ownership tracking. Only an ADMINISTRATOR can modify it.");
  }
  if (module.createdById !== actorId) {
    throw new ForbiddenError("You can only modify modules you created.");
  }
}
```

Routes that get the check: `DELETE /modules/:id`, `PATCH /modules/:id/title`, `POST /modules/:id/archive`, `POST /modules/:id/restore`, `POST /modules/:id/unpublish`, `POST /modules/:id/module-versions/:id/publish`.

Routes that do NOT get the check (creation and read routes are unscoped): `POST /modules` (creates the module, sets `createdById`), `GET /modules`, `GET /modules/library`, `GET /modules/:id/export`, `POST /modules/:id/rubric-versions`, `POST /modules/:id/prompt-template-versions`, `POST /modules/:id/mcq-set-versions`, `POST /modules/:id/module-versions`, `POST /modules/:id/benchmark-example-versions` (these are content authoring operations; ownership on sub-resources follows the module).

### New repository method

```typescript
// adminContentRepository.ts
async findModuleOwner(moduleId: string) {
  return prisma.module.findUnique({
    where: { id: moduleId },
    select: { id: true, createdById: true },
  });
}
```

### `createModule` change

Pass `createdById` from `toCreateModuleInput` mapper, sourced from `request.context?.userId` in the route (already passed as `actorId`).

### Tests

Two test identities (`smo-a`, `smo-b`) with `SUBJECT_MATTER_OWNER` role:
- SMO-A creates module → can delete/archive it
- SMO-B attempts delete/archive on SMO-A's module → 403
- ADMINISTRATOR can delete/archive either module
- Legacy module (`createdById = null`) → SMO gets 403, ADMINISTRATOR gets 200

---

## API-003: Report endpoint scoping for SUBJECT_MATTER_OWNER

### Current state

`capabilities.ts` gives `SUBJECT_MATTER_OWNER` access to `/api/reports` alongside `ADMINISTRATOR` and `REPORT_READER`. All report routes accept `moduleId` as a filter but do not verify that the caller owns the requested module.

### Decision: Remove SUBJECT_MATTER_OWNER from broad report routes for pilot

Two options were considered:

| Option | Notes |
|---|---|
| **A: Add ownership join to reporting queries** | Correct long-term design. But reporting queries are aggregations — adding ownership scoping requires joins across submission → module → createdById in every report. High complexity. |
| **B: Remove SMO from broad report routes; SMOs get reports via REPORT_READER role** | Single-line capabilities change. SMOs who legitimately need reports get explicit `REPORT_READER` grant. |

**Decision: Option B for pilot.** The issue explicitly accepts this: "OR SUBJECT_MATTER_OWNER removed from broad report routes until scoping is implemented." Scoped report queries are a post-pilot item.

### Change

In `src/config/capabilities.ts`, remove `AppRole.SUBJECT_MATTER_OWNER` from the `reports` capability:

```typescript
// Before:
roles: [AppRole.ADMINISTRATOR, AppRole.REPORT_READER, AppRole.SUBJECT_MATTER_OWNER],

// After:
roles: [AppRole.ADMINISTRATOR, AppRole.REPORT_READER],
```

SMOs who need report access receive an explicit `REPORT_READER` role grant (via admin-platform user management). Document this in the pilot operator runbook.

**Note:** The `adminContent` and `calibration` capabilities that also list SMO are unaffected — those are the correct content-authoring/calibration grants.

---

## API-005: Reviewer email stripped from participant audit trail

### Current state

`getSubmissionAuditTrail` in `src/services/auditService.ts` returns `actor.email` in every event regardless of caller role:

```typescript
actor: event.actor ? {
  id: event.actor.id,
  name: event.actor.name,
  email: event.actor.email, // ← exposed to participants
} : null,
```

`hasAuditReadAccess` already distinguishes privileged from unprivileged callers (line 36–38). Participants calling their own submission audit (`submission.userId === input.requestorUserId`) do not have audit read access.

### Change

Strip `email` when caller lacks `hasAuditReadAccess`:

```typescript
const includeActorEmail = hasAuditReadAccess(input.roles);

actor: event.actor ? {
  id: event.actor.id,
  name: event.actor.name,
  ...(includeActorEmail ? { email: event.actor.email } : {}),
} : null,
```

Participants see reviewer/handler names (appropriate transparency) but not email addresses. Admin roles see full actor data unchanged.

### Tests

- Participant calls their submission's audit trail → `actor.email` absent from events
- REVIEWER calls same audit trail → `actor.email` present

---

## Summary of files affected

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `createdById String?` + relation to Module |
| `src/modules/adminContent/adminContentRepository.ts` | New `findModuleOwner()` query |
| `src/modules/adminContent/adminContentCommands.ts` | Pass `createdById` in `createModule` command |
| `src/modules/adminContent/adminContentMapper.ts` | Thread `actorId` into `toCreateModuleInput` |
| `src/routes/adminContent.ts` | `assertModuleOwnership()` helper; apply to 6 mutating routes |
| `src/config/capabilities.ts` | Remove SMO from `reports` capability |
| `src/services/auditService.ts` | Conditional `actor.email` strip |
| `prisma/migrations/` | Auto-generated migration for `createdById` |
| `test/` | Two-SMO ownership isolation tests; participant audit trail test |

---

## Sequencing within the issue

The three sub-fixes are independent and can be implemented in any order. Suggested order for reduced risk:

1. **API-005** first (smallest change, no schema, no role impact, immediate privacy fix)
2. **API-003** next (one capabilities line, deploy to verify no SMO report breakage)
3. **API-002** last (schema migration, most moving parts; deploy after verifying ownership logic in test)
