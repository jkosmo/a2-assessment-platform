# Content ownership model (#787) — design for review

Status: **design, awaiting owner sign-off.** Implementation needs a DB-capable session (migration).
Epic #778. Source: `ARCHITECTURE_REVIEW_2026-07-19.md`.

## Decision being implemented
Owner-per-object + admin universal access, with two requirements the owner added (2026-07-19):
1. **Multiple owners per object** — model an owner *set*, not a single `createdById`.
2. **Transferable ownership** — a current owner **or** an ADMINISTRATOR can add/remove owners.

This closes the review finding that any SUBJECT_MATTER_OWNER (SMO) can today edit/delete **any**
course, section, or class (courses/sections have no owner field at all; `Class.createdById` exists but
is never checked). Today a single compromised author account can damage all authors' live content.

## Scope
- **In:** `Course`, `CourseSection`, `Class` ownership + enforcement on their admin write/delete paths.
- **Consider:** `Module` already has single-owner `createdById` + `assertModuleOwnership`. Recommendation:
  **migrate modules onto the same owner-set model** for consistency (one mental model, one guard), in the
  same migration. Alternative: leave modules as-is to shrink blast radius. *Owner decision needed —
  see Open Questions Q1.*
- **Separate finding (same issue):** SMO can enumerate **all** participants via `GET /adminUsers/search`.
  That is an authorization scope question, not ownership. Recommendation: keep it for SMO (legitimate
  enrolment/class-management need) but log access; revisit if it should be admin/report-reader-only.
  *Owner decision — Q2.*

## Data model

Two shapes considered:

**Option A — polymorphic `ContentOwner` table (recommended).**
```prisma
model ContentOwner {
  id          String            @id @default(cuid())
  contentType ContentOwnerType  // COURSE | SECTION | CLASS | (MODULE)
  contentId   String            // the Course/Section/Class id
  userId      String
  addedById   String?           // who granted ownership (owner or admin); null for migration backfill
  addedAt     DateTime          @default(now())
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([contentType, contentId, userId])
  @@index([contentType, contentId])
  @@index([userId])
}
enum ContentOwnerType { COURSE SECTION CLASS MODULE }
```
- *Pro:* one table, one guard, one management API for all content types; easy to add a 4th type later.
- *Con:* no per-type foreign-key onto Course/Section/Class (polymorphic), so referential cleanup is by
  application logic on delete (delete owners when the content is deleted). Acceptable — we already do
  polymorphic patterns (`CourseItem` XOR module/section with a DB CHECK).

**Option B — per-type join tables** (`CourseOwner`, `SectionOwner`, `ClassOwner`).
- *Pro:* real FKs + cascade cleanup per type.
- *Con:* 3–4 near-identical tables + 3–4 guards; more code, more drift risk.

**Recommendation: Option A** — matches how the codebase already handles polymorphic content, and the
owner set is small/low-churn so the missing FK cascade is a non-issue (handled on delete).

## Authorization rules
A single guard generalizing `assertModuleOwnership` from one id to a set:
```
assertContentOwnership(type, contentId, actor):
  if actor.roles includes ADMINISTRATOR: allow            // admin universal access
  owners = ContentOwner where (type, contentId)
  if owners is empty: deny "legacy_unowned" (admin-only)  // backfilled objects with no known owner
  if actor.userId in owners: allow
  else: deny "content_ownership"
```
- **Read** (participant/consumer paths) is unchanged — ownership gates **authoring** (edit/delete/
  publish/manage-members), not consumption. Participant visibility stays governed by
  `enrollmentPolicy` + enrolment (already fixed in #785/#786).
- **Transfer/manage owners:** add/remove an owner is itself an owner-or-admin action (same guard). You
  cannot remove the last owner unless you are admin (prevents orphaning); admin can always reassign.

## Ownership management surface (API)
Per content type, or one generic route:
- `GET  /api/admin/content/{courses|sections|classes}/:id/owners` — list owners (owner/admin).
- `POST /api/admin/content/{...}/:id/owners` `{ userId }` — add an owner (owner/admin).
- `DELETE /api/admin/content/{...}/:id/owners/:userId` — remove (owner/admin; not the last one unless admin).
Each mutation writes an `AuditEvent` (owner added/removed, actor, target).

## Enforcement points (where the guard gets called)
From the review + code:
- `adminCourses.ts`: `PUT /:id`, `DELETE /:id` (note: cascade-delete stays **ADMINISTRATOR-only** as
  today), `setCourseItems`, publish/archive, enrolment mutations.
- `adminSections.ts`: update/delete/publish/asset mutations.
- `adminClasses.ts`: update/delete, member add/remove, course-assignment.
- (If Q1 = yes) `adminContent.ts`: replace `assertModuleOwnership` with the generic guard.

## Migration + backfill
1. Create `ContentOwner` table + `ContentOwnerType` enum (additive).
2. **Backfill owners:**
   - `Class`: seed each class's `createdById` as its first owner (data exists).
   - `Module` (if Q1=yes): seed each module's `createdById` as first owner.
   - `Course` / `CourseSection`: **no owner field exists.** Best-effort: derive the creator from the
     earliest `AuditEvent` "created" action for that entity where available; otherwise leave **unowned →
     admin-only** until an admin assigns an owner. This is the deliberate "no `ingen-kan-røre` limbo":
     unowned = admin-managed, not frozen.
3. Keep `createdById` columns during transition (don't drop) so rollback is clean; drop in a later
   contract migration once the owner-set is authoritative.

**Why this needs a DB session:** the migration must be generated with `prisma migrate dev` against a
live Postgres and its backfill + the new integration tests run against the test DB (Docker), which the
current headless environment lacks. Hand-authoring a migration + backfill blind is too risky for a
security-critical authz change.

## Tests (with the implementation)
- Guard unit tests: admin allowed; owner allowed; non-owner 403; unowned → admin-only.
- Integration: owner-A edits own course (200); owner-B (not owner) blocked (403); admin edits any (200);
  add/remove owner flow + last-owner protection; audit rows written.
- Regression: participant read paths unaffected (ownership gates authoring only).

## Open questions (need your answer before build)
- **Q1 — Migrate Module onto the owner-set too?** Recommended **yes** (one model, one guard). Say no to
  keep modules on their current single-owner field and shrink the change.
- **Q2 — Participant search (`adminUsers/search`)** stays SMO-accessible (recommended, with audit) or
  becomes admin/report-reader-only?
- **Q3 — Default owners on create:** the creating user becomes the sole initial owner (recommended). Any
  role that should be auto-added (e.g. a department lead)? (Ties into whether department-scope, option B
  from the decision, is wanted later.)
