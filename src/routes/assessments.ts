import { Router } from "express";
import { z } from "zod";
import { enqueueAssessmentJob, processSubmissionJobNow } from "../modules/assessment/index.js";
import { assessmentRunLimiter } from "../middleware/rateLimiting.js";
import { getOwnedSubmission, getSubmissionForAssessmentView } from "../modules/submission/index.js";

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

  const submission = await getOwnedSubmission(submissionId, userId);
  if (!submission) {
    response.status(404).json({ error: "not_found", message: "Submission not found." });
    return;
  }

  // #953: ETHVERT vedtak sperrer, ikke bare et bestått.
  //
  // ⚠️ Sto tidligere som «COMPLETED og bestått». En strøket innlevering fikk da 202 «lagt i kø» —
  // men motoren nekter nå å røre en innlevering som har et vedtak (spesifikasjonens krav 2), så
  // ruta lovet noe som ikke skjedde. Kandidaten så det gamle resultatet og trodde en ny vurdering
  // var kjørt. Å kunne kjøre vurderingen om igjen på et strøket forsøk er dessuten karaktershopping;
  // veien videre er et nytt forsøk, som lager en ny innlevering.
  if (submission.decisions.length > 0) {
    response.status(409).json({
      error: "conflict",
      message: "This submission already has a decision. Start a new attempt instead of re-running this one.",
    });
    return;
  }
  if (submission.submissionStatus === "UNDER_REVIEW") {
    response.status(409).json({ error: "conflict", message: "This submission is currently under manual review. Cannot re-run." });
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

  const submission = await getSubmissionForAssessmentView(submissionId, userId);
  if (!submission) {
    response.status(404).json({ error: "not_found", message: "Submission not found." });
    return;
  }

  response.json({
    submissionId: submission.id,
    submissionStatus: submission.submissionStatus,
    latestJob: submission.assessmentJobs[0] ?? null,
    latestDecision: submission.decisions[0] ?? null,
  });
});

export { assessmentsRouter };
