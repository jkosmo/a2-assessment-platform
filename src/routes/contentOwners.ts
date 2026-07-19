import { Router, type Response } from "express";
import { z } from "zod";
import type { ContentOwnerType } from "@prisma/client";
import {
  assertContentOwnership,
  listContentOwners,
  addContentOwner,
  removeContentOwner,
} from "../modules/content/contentOwnershipService.js";
import { AppError } from "../errors/AppError.js";

// #787 slice 3: manage the owner set of a content object. Two layers of authz: the mount requires the
// content-admin capability (SMO/ADMIN), and each handler additionally calls assertContentOwnership so
// only an owner (or admin) of THIS object can see/change its owners. Generic over content type so one
// router serves Course/CourseSection/Class/Module.

const contentOwnersRouter = Router();

const contentTypeSchema = z.enum(["COURSE", "SECTION", "CLASS", "MODULE"]);
const addBodySchema = z.object({ userId: z.string().min(1) });

function sendAppError(response: Response, error: unknown): boolean {
  if (error instanceof AppError) {
    response.status(error.httpStatus).json({ error: error.code, message: error.message });
    return true;
  }
  return false;
}

contentOwnersRouter.get("/:contentType/:contentId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) return void response.status(401).json({ error: "unauthorized" });
  const type = contentTypeSchema.safeParse(request.params.contentType);
  if (!type.success) return void response.status(400).json({ error: "invalid_content_type" });
  const contentType = type.data as ContentOwnerType;
  const roles = request.context?.roles ?? [];
  try {
    // #787 QA: any content-admin (the mount already requires SMO/ADMIN) may VIEW the owners for
    // transparency — the panel must render on content you don't own too. Only an owner or admin may
    // CHANGE owners (POST/DELETE stay ownership-gated). `canManage` tells the UI whether to show controls.
    const owners = await listContentOwners(contentType, request.params.contentId);
    const canManage = roles.includes("ADMINISTRATOR") || owners.some((o) => o.userId === userId);
    response.json({ owners, canManage });
  } catch (error) {
    if (!sendAppError(response, error)) next(error);
  }
});

contentOwnersRouter.post("/:contentType/:contentId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) return void response.status(401).json({ error: "unauthorized" });
  const type = contentTypeSchema.safeParse(request.params.contentType);
  if (!type.success) return void response.status(400).json({ error: "invalid_content_type" });
  const body = addBodySchema.safeParse(request.body);
  if (!body.success) return void response.status(400).json({ error: "invalid_body", message: "userId is required." });
  const contentType = type.data as ContentOwnerType;
  try {
    await assertContentOwnership({ contentType, contentId: request.params.contentId, actorUserId: userId, roles: request.context?.roles ?? [] });
    await addContentOwner({ contentType, contentId: request.params.contentId, ownerUserId: body.data.userId, actorUserId: userId });
    response.status(201).json({ owners: await listContentOwners(contentType, request.params.contentId) });
  } catch (error) {
    if (!sendAppError(response, error)) next(error);
  }
});

contentOwnersRouter.delete("/:contentType/:contentId/:ownerUserId", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) return void response.status(401).json({ error: "unauthorized" });
  const type = contentTypeSchema.safeParse(request.params.contentType);
  if (!type.success) return void response.status(400).json({ error: "invalid_content_type" });
  const contentType = type.data as ContentOwnerType;
  const roles = request.context?.roles ?? [];
  try {
    await assertContentOwnership({ contentType, contentId: request.params.contentId, actorUserId: userId, roles });
    await removeContentOwner({
      contentType,
      contentId: request.params.contentId,
      ownerUserId: request.params.ownerUserId,
      actorUserId: userId,
      isAdmin: roles.includes("ADMINISTRATOR"),
    });
    response.json({ owners: await listContentOwners(contentType, request.params.contentId) });
  } catch (error) {
    if (!sendAppError(response, error)) next(error);
  }
});

export { contentOwnersRouter };
