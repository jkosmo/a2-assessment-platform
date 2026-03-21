import { Router } from "express";
import { getSubmissionAuditTrail } from "../services/auditService.js";

const auditRouter = Router();

auditRouter.get("/submissions/:submissionId", async (request, response, next) => {
  const userId = request.context?.userId;
  const roles = request.context?.roles ?? [];

  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const trail = await getSubmissionAuditTrail({
      submissionId: request.params.submissionId,
      requestorUserId: userId,
      roles,
    });

    if (!trail) {
      response.status(404).json({ error: "not_found", message: "Submission not found." });
      return;
    }

    response.json(trail);
  } catch (error) {
    next(error);
  }
});

export { auditRouter };
