import { Router } from "express";
import { z } from "zod";
import {
  createSubmission,
  getOwnedSubmission,
  getOwnedSubmissionHistoryView,
  getOwnedSubmissionResultView,
} from "../modules/submission/index.js";
import { createSubmissionAppeal } from "../modules/appeal/index.js";
import { env } from "../config/env.js";
import { submissionCreateLimiter } from "../middleware/rateLimiting.js";

const createSubmissionSchema = z.object({
  moduleId: z.string().min(1),
  deliveryType: z.enum(["text", "file", "hybrid"]).default("text"),
  responseJson: z.record(z.string(), z.unknown()).default({}),
  attachmentUri: z.string().trim().optional(),
  attachmentBase64: z.string().trim().optional(),
  attachmentFilename: z.string().trim().optional(),
  attachmentMimeType: z.string().trim().optional(),
});

const createAppealSchema = z.object({
  appealReason: z.string().trim().min(5),
});
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const submissionsRouter = Router();

submissionsRouter.post("/", submissionCreateLimiter, async (request, response, next) => {
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
      locale: request.context?.locale ?? env.DEFAULT_LOCALE,
      ...parsed.data,
    });
    response.status(201).json({ submission });
  } catch (error) {
    next(error);
  }
});

submissionsRouter.post("/:submissionId/appeals", async (request, response, next) => {
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
    next(error);
  }
});

submissionsRouter.get("/history", async (request, response) => {
  const userId = request.context?.userId;
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const parsed = historyQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }

  const history = await getOwnedSubmissionHistoryView({
    userId,
    limit: parsed.data.limit,
    locale: request.context?.locale ?? env.DEFAULT_LOCALE,
  });
  response.json(history);
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

  const result = await getOwnedSubmissionResultView(request.params.submissionId, userId);
  if (!result) {
    response.status(404).json({ error: "not_found", message: "Submission not found." });
    return;
  }
  response.json(result);
});

export { submissionsRouter };
