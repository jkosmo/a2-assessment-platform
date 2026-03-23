import { Router } from "express";
import { z } from "zod";
import {
  claimManualReview,
  finalizeManualReviewOverride,
  getManualReviewWorkspaceView,
  listManualReviewQueue,
} from "../modules/review/index.js";

const reviewsRouter = Router();

const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) {
        return ["OPEN", "IN_REVIEW"] as Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "SUPERSEDED">;
      }
      return value
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item): item is "OPEN" | "IN_REVIEW" | "RESOLVED" | "SUPERSEDED" =>
          item === "OPEN" || item === "IN_REVIEW" || item === "RESOLVED" || item === "SUPERSEDED",
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

  const locale = request.context?.locale ?? "nb";
  const reviews = await listManualReviewQueue({
    statuses:
      parsed.data.status.length > 0 ? parsed.data.status : (["OPEN", "IN_REVIEW"] as const),
    limit: parsed.data.limit,
    locale,
  });

  response.json({ reviews });
});

reviewsRouter.get("/:reviewId", async (request, response) => {
  const review = await getManualReviewWorkspaceView(request.params.reviewId, request.context?.locale ?? "nb");
  if (!review) {
    response.status(404).json({ error: "not_found", message: "Manual review not found." });
    return;
  }
  response.json(review);
});

reviewsRouter.post("/:reviewId/claim", async (request, response, next) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const review = await claimManualReview(request.params.reviewId, userId);
    response.json({ review });
  } catch (error) {
    next(error);
  }
});

reviewsRouter.post("/:reviewId/override", async (request, response, next) => {
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
    next(error);
  }
});

export { reviewsRouter };
