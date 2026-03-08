import { Router } from "express";
import { z } from "zod";
import {
  claimManualReview,
  finalizeManualReviewOverride,
  getManualReviewWorkspace,
  listManualReviewQueue,
} from "../services/manualReviewService.js";

const reviewsRouter = Router();

const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return ["OPEN", "IN_REVIEW"] as Array<"OPEN" | "IN_REVIEW" | "RESOLVED">;
      }
      return value
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item): item is "OPEN" | "IN_REVIEW" | "RESOLVED" =>
          item === "OPEN" || item === "IN_REVIEW" || item === "RESOLVED",
        );
    }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const overrideBodySchema = z.object({
  passFailTotal: z.boolean(),
  decisionReason: z.string().trim().min(5),
  overrideReason: z.string().trim().min(5),
});

reviewsRouter.get("/", async (request, response) => {
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const reviews = await listManualReviewQueue({
    statuses:
      parsed.data.status.length > 0 ? parsed.data.status : (["OPEN", "IN_REVIEW"] as const),
    limit: parsed.data.limit,
  });

  response.json({ reviews });
});

reviewsRouter.get("/:reviewId", async (request, response) => {
  const workspace = await getManualReviewWorkspace(request.params.reviewId);
  if (!workspace) {
    response.status(404).json({ error: "not_found", message: "Manual review not found." });
    return;
  }

  response.json({ review: workspace });
});

reviewsRouter.post("/:reviewId/claim", async (request, response) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const review = await claimManualReview(request.params.reviewId, userId);
    response.json({ review });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "not_found") {
        response.status(404).json({ error: "not_found", message: "Manual review not found." });
        return;
      }
      if (error.message === "already_assigned") {
        response.status(409).json({
          error: "review_already_assigned",
          message: "Manual review is already assigned to another reviewer.",
        });
        return;
      }
      if (error.message === "already_resolved") {
        response.status(409).json({
          error: "review_already_resolved",
          message: "Manual review is already resolved.",
        });
        return;
      }
    }

    response.status(400).json({
      error: "review_claim_failed",
      message: error instanceof Error ? error.message : "Could not claim manual review.",
    });
  }
});

reviewsRouter.post("/:reviewId/override", async (request, response) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = overrideBodySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const result = await finalizeManualReviewOverride({
      reviewId: request.params.reviewId,
      reviewerId: userId,
      ...parsed.data,
    });
    response.json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "not_found") {
        response.status(404).json({ error: "not_found", message: "Manual review not found." });
        return;
      }
      if (error.message === "already_assigned") {
        response.status(409).json({
          error: "review_already_assigned",
          message: "Manual review is already assigned to another reviewer.",
        });
        return;
      }
      if (error.message === "already_resolved") {
        response.status(409).json({
          error: "review_already_resolved",
          message: "Manual review is already resolved.",
        });
        return;
      }
      if (error.message === "missing_decision") {
        response.status(409).json({
          error: "missing_decision",
          message: "Cannot override review because no decision exists for submission.",
        });
        return;
      }
    }

    response.status(400).json({
      error: "manual_override_failed",
      message: error instanceof Error ? error.message : "Could not finalize manual override.",
    });
  }
});

export { reviewsRouter };
