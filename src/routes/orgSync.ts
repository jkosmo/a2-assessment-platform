import { Router } from "express";
import { z } from "zod";
import { applyOrgDeltaSync } from "../services/orgSyncService.js";

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

export { orgSyncRouter };
