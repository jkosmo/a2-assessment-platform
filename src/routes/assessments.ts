import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { enqueueAssessmentJob, processSubmissionJobNow } from "../services/assessmentJobService.js";
import { assessmentRunLimiter } from "../middleware/rateLimiting.js";

const assessmentsRouter = Router();
const runBodySchema = z.object({
  sync: z.boolean().optional(),
});

assessmentsRouter.post("/:submissionId/run", assessmentRunLimiter, async (request, response) => {
  const userId = request.context?.userId;
  const submissionId = request.params.submissionId as string;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = runBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId },
  });
  if (!submission) {
    response.status(404).json({ error: "not_found", message: "Submission not found." });
    return;
  }

  const job = await enqueueAssessmentJob(submission.id);
  if (parsed.data.sync) {
    await processSubmissionJobNow(submission.id);
  }
  response.status(202).json({ status: "queued", jobId: job.id, syncProcessed: !!parsed.data.sync });
});

assessmentsRouter.get("/:submissionId", async (request, response) => {
  const userId = request.context?.userId;
  const submissionId = request.params.submissionId as string;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, userId },
    include: {
      assessmentJobs: { orderBy: { createdAt: "desc" } },
      llmEvaluations: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { finalisedAt: "desc" } },
    },
  });
  if (!submission) {
    response.status(404).json({ error: "not_found", message: "Submission not found." });
    return;
  }

  response.json({
    submissionId: submission.id,
    submissionStatus: submission.submissionStatus,
    latestJob: submission.assessmentJobs[0] ?? null,
    latestEvaluation: submission.llmEvaluations[0] ?? null,
    latestDecision: submission.decisions[0] ?? null,
  });
});

export { assessmentsRouter };
