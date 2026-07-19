// #787 slice 2: the ownership guard. Generalizes the old single-owner assertModuleOwnership to the
// multi-owner ContentOwner set, across Course/CourseSection/Class/Module. Read-only here — nothing
// calls it yet; slice 4 wires it onto the write/delete paths. The decision is a pure function so the
// access matrix is unit-testable without a database.

import type { AppRole as AppRoleType, ContentOwnerType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ForbiddenError } from "../../errors/AppError.js";

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
 * Throws ForbiddenError unless the actor may modify the given content object (admin, or an owner).
 * Gates AUTHORING only — participant read/visibility is governed elsewhere (enrollmentPolicy, #785/#786).
 */
export async function assertContentOwnership(input: {
  contentType: ContentOwnerType;
  contentId: string;
  actorUserId: string;
  roles: AppRoleType[];
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
