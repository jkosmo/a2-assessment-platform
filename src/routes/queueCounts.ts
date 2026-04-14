import { Router } from "express";
import { AppRole } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";

const queueCountsRouter = Router();

queueCountsRouter.get("/", async (request, response, next) => {
  try {
    const roles = request.context?.roles ?? [];
    const canReview =
      roles.includes(AppRole.REVIEWER) || roles.includes(AppRole.ADMINISTRATOR);
    const canHandleAppeals =
      roles.includes(AppRole.APPEAL_HANDLER) || roles.includes(AppRole.ADMINISTRATOR);

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
