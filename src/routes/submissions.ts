import { Router } from "express";
import { z } from "zod";
import { createSubmission, getOwnedSubmission } from "../services/submissionService.js";
import { createSubmissionAppeal } from "../services/appealService.js";

const createSubmissionSchema = z.object({
  moduleId: z.string().min(1),
  deliveryType: z.enum(["text", "file", "hybrid"]).default("text"),
  rawText: z.string().trim().optional(),
  reflectionText: z.string().trim().min(10),
  promptExcerpt: z.string().trim().min(5),
  responsibilityAcknowledged: z.literal(true),
  attachmentUri: z.string().trim().optional(),
});

const createAppealSchema = z.object({
  appealReason: z.string().trim().min(5),
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

submissionsRouter.post("/:submissionId/appeals", async (request, response) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = createAppealSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  try {
    const appeal = await createSubmissionAppeal({
      submissionId: request.params.submissionId,
      appealedById: userId,
      appealReason: parsed.data.appealReason,
    });
    response.status(201).json({ appeal });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "not_found") {
        response.status(404).json({ error: "not_found", message: "Submission not found." });
        return;
      }
      if (error.message === "missing_decision") {
        response.status(409).json({
          error: "missing_decision",
          message: "Submission must have an assessment decision before an appeal can be created.",
        });
        return;
      }
      if (error.message === "already_open") {
        response.status(409).json({
          error: "appeal_already_open",
          message: "Submission already has an open or in-review appeal.",
        });
        return;
      }
    }

    response.status(400).json({
      error: "appeal_create_failed",
      message: error instanceof Error ? error.message : "Failed to create appeal.",
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
