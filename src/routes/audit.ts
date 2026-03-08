import { Router } from "express";
import { getSubmissionAuditTrail } from "../services/auditService.js";

const auditRouter = Router();

auditRouter.get("/submissions/:submissionId", async (request, response) => {
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
    if (error instanceof Error && error.message === "forbidden") {
      response.status(403).json({
        error: "forbidden",
        message: "You do not have access to this submission audit trail.",
      });
      return;
    }

    response.status(500).json({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Could not load audit trail.",
    });
  }
});

export { auditRouter };
