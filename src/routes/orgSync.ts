import { Router } from "express";
import { z } from "zod";
import { applyOrgDeltaSync, syncEntraUsersFromGroup } from "../modules/orgSync/index.js";
import { AppError } from "../errors/AppError.js";

const orgSyncRouter = Router();

const orgSyncDeltaSchema = z.object({
  source: z.string().trim().min(1),
  users: z.array(
    z.object({
      externalId: z.string().trim().min(1),
      email: z.string().trim().email(),
      name: z.string().trim().min(1),
      department: z.string().trim().optional().nullable(),
      manager: z.string().trim().optional().nullable(),
      activeStatus: z.boolean().optional(),
    }),
  ),
});

orgSyncRouter.post("/delta", async (request, response, next) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = orgSyncDeltaSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const result = await applyOrgDeltaSync({
      source: parsed.data.source,
      users: parsed.data.users,
      actorId,
    });
    response.json({ run: result });
  } catch (error) {
    next(error);
  }
});

// #690: import the configured Entra group's members (Graph-backed) as platform users.
orgSyncRouter.post("/entra", async (request, response, next) => {
  const actorId = request.context?.userId;
  if (!actorId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const result = await syncEntraUsersFromGroup(actorId);
    response.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      response.status(error.httpStatus).json({ error: error.code, message: error.message });
      return;
    }
    next(error);
  }
});

export { orgSyncRouter };
