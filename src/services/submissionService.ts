import { SubmissionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { recordAuditEvent } from "./auditService.js";

export type CreateSubmissionInput = {
  userId: string;
  moduleId: string;
  deliveryType: string;
  rawText?: string;
  reflectionText: string;
  promptExcerpt: string;
  responsibilityAcknowledged: boolean;
  attachmentUri?: string;
};

export async function createSubmission(input: CreateSubmissionInput) {
  const module = await prisma.module.findUnique({
    where: { id: input.moduleId },
    include: { activeVersion: true },
  });

  if (!module || !module.activeVersion || !module.activeVersion.publishedAt) {
    throw new Error("Module active version is not available.");
  }

  const submission = await prisma.submission.create({
    data: {
      userId: input.userId,
      moduleId: module.id,
      moduleVersionId: module.activeVersion.id,
      deliveryType: input.deliveryType,
      rawText: input.rawText,
      reflectionText: input.reflectionText,
      promptExcerpt: input.promptExcerpt,
      responsibilityAcknowledged: input.responsibilityAcknowledged,
      attachmentUri: input.attachmentUri,
      submissionStatus: SubmissionStatus.SUBMITTED,
    },
  });

  await recordAuditEvent({
    entityType: "submission",
    entityId: submission.id,
    action: "submission_created",
    actorId: input.userId,
    metadata: {
      moduleId: submission.moduleId,
      moduleVersionId: submission.moduleVersionId,
    },
  });

  return submission;
}

export async function getOwnedSubmission(submissionId: string, userId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, userId },
    include: {
      moduleVersion: true,
      mcqAttempts: {
        orderBy: { createdAt: "desc" },
        include: { responses: true },
      },
      llmEvaluations: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { finalisedAt: "desc" } },
    },
  });
}

