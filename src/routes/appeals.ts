import { Router } from "express";
import { z } from "zod";
import { claimAppeal, getAppealWorkspace, listAppealQueue, resolveAppeal, buildAppealSlaSnapshot } from "../modules/appeal/index.js";

const appealsRouter = Router();

const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return ["OPEN", "IN_REVIEW"] as Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED">;
      }
      return value
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter(
          (item): item is "OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED" =>
            item === "OPEN" || item === "IN_REVIEW" || item === "RESOLVED" || item === "REJECTED",
        );
    }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const resolveBodySchema = z.object({
  passFailTotal: z.boolean(),
  decisionReason: z.string().trim().min(5),
  resolutionNote: z.string().trim().min(5),
});

appealsRouter.get("/", async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const appeals = await listAppealQueue({
    statuses:
      parsed.data.status.length > 0
        ? parsed.data.status
        : (["OPEN", "IN_REVIEW"] as Array<"OPEN" | "IN_REVIEW">),
    limit: parsed.data.limit,
  });
  response.json({ appeals });
});

appealsRouter.get("/:appealId", async (request, response) => {
  const workspace = await getAppealWorkspace(request.params.appealId);
  if (!workspace) {
    response.status(404).json({ error: "not_found", message: "Appeal not found." });
    return;
  }

  response.json({
    appeal: workspace,
    sla: buildAppealSlaSnapshot({
      createdAt: workspace.createdAt,
      claimedAt: workspace.claimedAt,
      resolvedAt: workspace.resolvedAt,
      appealStatus: workspace.appealStatus,
    }),
  });
});

appealsRouter.post("/:appealId/claim", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const appeal = await claimAppeal(request.params.appealId, userId);
    response.json({ appeal });
  } catch (error) {
    next(error);
  }
});

appealsRouter.post("/:appealId/resolve", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = resolveBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const result = await resolveAppeal({
      appealId: request.params.appealId,
      handlerId: userId,
      ...parsed.data,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { appealsRouter };
