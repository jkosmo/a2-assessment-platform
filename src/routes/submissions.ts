import { Router } from "express";
import { z } from "zod";
import { createSubmission, getOwnedSubmission } from "../services/submissionService.js";

const createSubmissionSchema = z.object({
  moduleId: z.string().min(1),
  deliveryType: z.enum(["text", "file", "hybrid"]).default("text"),
  rawText: z.string().trim().optional(),
  reflectionText: z.string().trim().min(10),
  promptExcerpt: z.string().trim().min(5),
  responsibilityAcknowledged: z.literal(true),
  attachmentUri: z.string().trim().optional(),
});

const submissionsRouter = Router();

submissionsRouter.post("/", async (request, response) => {
  const parsed = createSubmissionSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const submission = await createSubmission({
      userId,
      ...parsed.data,
    });
    response.status(201).json({ submission });
  } catch (error) {
    response.status(400).json({
      error: "submission_create_failed",
      message: error instanceof Error ? error.message : "Failed to create submission.",
    });
  }
});

submissionsRouter.get("/:submissionId", async (request, response) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const submission = await getOwnedSubmission(request.params.submissionId, userId);
  if (!submission) {
    response.status(404).json({ error: "not_found", message: "Submission not found." });
    return;
  }

  response.json({ submission });
});

submissionsRouter.get("/:submissionId/result", async (request, response) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const submission = await getOwnedSubmission(request.params.submissionId, userId);
  if (!submission) {
    response.status(404).json({ error: "not_found", message: "Submission not found." });
    return;
  }

  const decision = submission.decisions[0] ?? null;
  const llmEvaluation = submission.llmEvaluations[0] ?? null;
  const mcqAttempt = submission.mcqAttempts.find((attempt) => attempt.completedAt !== null) ?? null;

  response.json({
    submissionId: submission.id,
    status: submission.submissionStatus,
    decision,
    llmEvaluation,
    mcqAttempt,
  });
});

export { submissionsRouter };
