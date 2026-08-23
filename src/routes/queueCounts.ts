import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { hasAnyRole, REVIEW_HANDLERS, APPEAL_HANDLERS } from "../auth/roleSets.js";

const queueCountsRouter = Router();

queueCountsRouter.get("/", async (request, response, next) => {
  try {
    const roles = request.context?.roles ?? [];
    const canReview = hasAnyRole(roles, REVIEW_HANDLERS);
    const canHandleAppeals = hasAnyRole(roles, APPEAL_HANDLERS);

    const [reviews, appeals] = await Promise.all([
      canReview
        ? prisma.manualReview.count({
            where: { reviewStatus: { in: ["OPEN", "IN_REVIEW"] } },
          })
        : Promise.resolve(0),
      canHandleAppeals
        ? prisma.appeal.count({
            where: { appealStatus: { in: ["OPEN", "IN_REVIEW"] } },
          })
        : Promise.resolve(0),
    ]);

    response.json({ reviews, appeals });
  } catch (error) {
    next(error);
  }
});

export { queueCountsRouter };
