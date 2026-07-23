// #787 slice 2: the ownership guard. Generalizes the old single-owner assertModuleOwnership to the
// multi-owner ContentOwner set, across Course/CourseSection/Class/Module. Read-only here — nothing
// calls it yet; slice 4 wires it onto the write/delete paths. The decision is a pure function so the
// access matrix is unit-testable without a database.

import type { AppRole as AppRoleType, ContentOwnerType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ForbiddenError, NotFoundError } from "../../errors/AppError.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";

export type OwnershipDecision = "allow" | "unowned" | "not_owner";

/**
 * Pure ownership decision. ADMINISTRATOR always allowed (universal access). Otherwise the actor must be
 * one of the object's owners. An object with no owners is `unowned` → admin-only until an owner is
 * assigned (the deliberate "no frozen limbo" for backfilled Course/Section that had no createdById).
 */
export function decideOwnershipAccess(input: {
  isAdmin: boolean;
  ownerUserIds: string[];
  actorUserId: string;
}): OwnershipDecision {
  if (input.isAdmin) return "allow";
  if (input.ownerUserIds.length === 0) return "unowned";
  return input.ownerUserIds.includes(input.actorUserId) ? "allow" : "not_owner";
}

export function listContentOwnerUserIds(
  contentType: ContentOwnerType,
  contentId: string,
): Promise<string[]> {
  return prisma.contentOwner
    .findMany({ where: { contentType, contentId }, select: { userId: true } })
    .then((rows) => rows.map((row) => row.userId));
}

/**
 * #787 slice 5 (list UX): batch version of the ownership decision for list views. Returns the subset of
 * `contentIds` the actor may manage (edit / publish / archive / delete) — exactly the ids where
 * assertContentOwnership would NOT throw. Same rule as decideOwnershipAccess: an ADMINISTRATOR manages
 * all; a non-admin manages only the ids they own (unowned → not manageable). Lets a list endpoint annotate
 * each row with `canManage`, so the UI can hide the action buttons the server would otherwise 403 on save.
 */
export async function listManageableContentIds(input: {
  contentType: ContentOwnerType;
  contentIds: string[];
  actorUserId: string;
  roles: string[];
}): Promise<Set<string>> {
  if (input.roles.includes("ADMINISTRATOR")) return new Set(input.contentIds);
  if (input.contentIds.length === 0 || !input.actorUserId) return new Set();
  const rows = await prisma.contentOwner.findMany({
    where: { contentType: input.contentType, contentId: { in: input.contentIds }, userId: input.actorUserId },
    select: { contentId: true },
  });
  return new Set(rows.map((r) => r.contentId));
}

/**
 * Throws ForbiddenError unless the actor may modify the given content object (admin, or an owner).
 * Gates AUTHORING only — participant read/visibility is governed elsewhere (enrollmentPolicy, #785/#786).
 */
export async function assertContentOwnership(input: {
  contentType: ContentOwnerType;
  contentId: string;
  actorUserId: string;
  // Only checked for "ADMINISTRATOR"; typed as string[] so both AppRole[] callers and the string[]
  // module-guard delegate pass without a cast.
  roles: string[];
}): Promise<void> {
  const isAdmin = input.roles.includes("ADMINISTRATOR");
  // Admin short-circuits before any DB read.
  const ownerUserIds = isAdmin ? [] : await listContentOwnerUserIds(input.contentType, input.contentId);
  const decision = decideOwnershipAccess({ isAdmin, ownerUserIds, actorUserId: input.actorUserId });
  if (decision === "allow") return;
  if (decision === "unowned") {
    throw new ForbiddenError(
      "This content has no owner yet — only an administrator can modify it until an owner is assigned.",
      "content_unowned",
    );
  }
  throw new ForbiddenError("You can only modify content you own.", "content_ownership");
}

// --- #787 slice 3: owner-set management (used by the owners API). Managing owners is itself an
// owner-or-admin action (the route calls assertContentOwnership first). ---

export interface ContentOwnerView {
  userId: string;
  name: string;
  email: string;
  addedAt: string;
}

export async function listContentOwners(
  contentType: ContentOwnerType,
  contentId: string,
): Promise<ContentOwnerView[]> {
  const rows = await prisma.contentOwner.findMany({
    where: { contentType, contentId },
    select: { userId: true, addedAt: true, user: { select: { name: true, email: true } } },
    orderBy: { addedAt: "asc" },
  });
  return rows.map((r) => ({ userId: r.userId, name: r.user.name, email: r.user.email, addedAt: r.addedAt.toISOString() }));
}

// Idempotent: adding an existing owner is a no-op (unique constraint). Audited.
export async function addContentOwner(input: {
  contentType: ContentOwnerType;
  contentId: string;
  ownerUserId: string;
  actorUserId: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: input.ownerUserId }, select: { id: true } });
  if (!user) {
    throw new NotFoundError("User", "user_not_found", "That user does not exist.");
  }
  const existing = await prisma.contentOwner.findUnique({
    where: {
      contentType_contentId_userId: {
        contentType: input.contentType,
        contentId: input.contentId,
        userId: input.ownerUserId,
      },
    },
    select: { id: true },
  });
  if (existing) return; // already an owner
  const owner = await prisma.contentOwner.create({
    data: {
      contentType: input.contentType,
      contentId: input.contentId,
      userId: input.ownerUserId,
      addedById: input.actorUserId,
    },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.contentOwner,
    entityId: owner.id,
    action: auditActions.contentOwner.added,
    actorId: input.actorUserId,
    metadata: { contentType: input.contentType, contentId: input.contentId, ownerUserId: input.ownerUserId },
  });
}

// Last-owner protection: a non-admin cannot remove the final owner (would orphan the content). An
// administrator may (it becomes unowned → admin-managed until reassigned). Audited.
export async function removeContentOwner(input: {
  contentType: ContentOwnerType;
  contentId: string;
  ownerUserId: string;
  actorUserId: string;
  isAdmin: boolean;
}): Promise<void> {
  const ownerIds = await listContentOwnerUserIds(input.contentType, input.contentId);
  if (!ownerIds.includes(input.ownerUserId)) {
    throw new NotFoundError("ContentOwner", "owner_not_found", "That user is not an owner of this content.");
  }
  if (ownerIds.length === 1 && !input.isAdmin) {
    throw new ForbiddenError(
      "You cannot remove the last owner. Add another owner first, or ask an administrator.",
      "last_owner",
    );
  }
  await prisma.contentOwner.deleteMany({
    where: { contentType: input.contentType, contentId: input.contentId, userId: input.ownerUserId },
  });
  await recordAuditEvent({
    entityType: auditEntityTypes.contentOwner,
    entityId: `${input.contentType}:${input.contentId}:${input.ownerUserId}`,
    action: auditActions.contentOwner.removed,
    actorId: input.actorUserId,
    metadata: { contentType: input.contentType, contentId: input.contentId, ownerUserId: input.ownerUserId },
  });
}
