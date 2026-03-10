import { Router } from "express";
import { z } from "zod";
import { AppError, ValidationError } from "../errors/AppError.js";
import { createSubmission, getOwnedSubmission, getOwnedSubmissionHistory } from "../services/submissionService.js";
import { createSubmissionAppeal } from "../services/appealService.js";
import { env } from "../config/env.js";
import { localizeContentText } from "../i18n/content.js";
import { submissionCreateLimiter } from "../middleware/rateLimiting.js";

const createSubmissionSchema = z.object({
  moduleId: z.string().min(1),
  deliveryType: z.enum(["text", "file", "hybrid"]).default("text"),
  rawText: z.string().trim().optional(),
  reflectionText: z.string().trim().min(10),
  promptExcerpt: z.string().trim().min(5),
  responsibilityAcknowledged: z.literal(true),
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
    if (error instanceof AppError) {
      next(error);
      return;
    }

    next(new ValidationError(error instanceof Error ? error.message : "Failed to create submission."));
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
    if (error instanceof AppError) {
      next(error);
      return;
    }

    response.status(400).json({
      error: "appeal_create_failed",
      message: error instanceof Error ? error.message : "Failed to create appeal.",
    });
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

  const submissions = await getOwnedSubmissionHistory({
    userId,
    limit: parsed.data.limit,
  });

  const history = submissions.map((submission) => {
    const locale = request.context?.locale ?? "en-GB";
    const latestDecision = submission.decisions[0] ?? null;
    const latestMcq = submission.mcqAttempts[0] ?? null;
    const latestLlm = submission.llmEvaluations[0] ?? null;

    return {
      submissionId: submission.id,
      module: {
        ...submission.module,
        title: localizeContentText(locale, submission.module.title) ?? submission.module.title,
      },
      submittedAt: submission.submittedAt,
      status: submission.submissionStatus,
      latestDecision,
      latestMcqAttempt: latestMcq,
      latestLlmEvaluation: latestLlm,
    };
  });

  response.json({ history });
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
  const latestAppeal = submission.appeals[0] ?? null;
  const llmEvaluation = submission.llmEvaluations[0] ?? null;
  const mcqAttempt = submission.mcqAttempts.find((attempt) => attempt.completedAt !== null) ?? null;
  const llmStructured = parseLlmResponse(llmEvaluation?.responseJson);

  const scoreComponents = {
    mcqScaledScore: decision?.mcqScaledScore ?? mcqAttempt?.scaledScore ?? null,
    practicalScaledScore: decision?.practicalScaledScore ?? llmEvaluation?.practicalScoreScaled ?? null,
    totalScore: decision?.totalScore ?? null,
  };

  const statusExplanation =
    submission.submissionStatus === "UNDER_REVIEW"
      ? "Your submission is under manual review because confidence/red-flag rules require a human decision."
      : submission.submissionStatus === "COMPLETED"
        ? "Final decision is available."
        : "Assessment is still processing.";

  response.json({
    submissionId: submission.id,
    status: submission.submissionStatus,
    statusExplanation,
    scoreComponents,
    decision,
    latestAppeal,
    llmEvaluation,
    mcqAttempt,
    participantGuidance: {
      decisionReason: decision?.decisionReason ?? null,
      confidenceNote: llmEvaluation?.confidenceNote ?? null,
      improvementAdvice: llmStructured?.improvement_advice ?? [],
      criterionRationales: llmStructured?.criterion_rationales ?? null,
    },
  });
});

function parseLlmResponse(rawJson: string | undefined) {
  if (!rawJson) {
    return null;
  }
  try {
    return JSON.parse(rawJson) as {
      improvement_advice?: string[];
      criterion_rationales?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

export { submissionsRouter };
