import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { hasAnyRole, REVIEW_HANDLERS, APPEAL_HANDLERS, ADMIN_ONLY } from "../auth/roleSets.js";
import { assessmentJobRepository } from "../modules/assessment/assessmentJobRepository.js";

const queueCountsRouter = Router();

queueCountsRouter.get("/", async (request, response, next) => {
  try {
    const roles = request.context?.roles ?? [];
    const canReview = hasAnyRole(roles, REVIEW_HANDLERS);
    const canHandleAppeals = hasAnyRole(roles, APPEAL_HANDLERS);

    // #953: vurderinger som ga opp. Ikke en kø noen «behandler» — det er en driftsfeil hos oss, og
    // eneste handling er å kjøre vurderingen på nytt.
    //
    // Tallet driver merket på plattformlenka i toppmenyen (`applyNavBadge` i api-client.js), som
    // vises KUN når det er noe å vise. Uten en leser ville feltet vært død API-flate — og en
    // administrator ville bare oppdaget opphopningen ved tilfeldig besøk på siden.
    //
    // ⚠️ Ikke lagt til i `reviews + appeals`-summen: det er vurdererens kø, dette er driftens.
    const isAdministrator = hasAnyRole(roles, ADMIN_ONLY);

    const [reviews, appeals, failedAssessments] = await Promise.all([
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
      isAdministrator
        ? assessmentJobRepository.countStuckFailedAssessments()
        : Promise.resolve(0),
    ]);

    response.json({ reviews, appeals, failedAssessments });
  } catch (error) {
    next(error);
  }
});

export { queueCountsRouter };
