import { SubmissionStatus } from "../db/prismaRuntime.js";
import { prisma } from "../db/prisma.js";
import type { SupportedLocale } from "../i18n/locale.js";
import { recordAuditEvent } from "./auditService.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { resolveSubmissionRawTextFromAttachment } from "./documentParsingService.js";

export type CreateSubmissionInput = {
  userId: string;
  moduleId: string;
  locale: SupportedLocale;
  deliveryType: string;
  rawText?: string;
  reflectionText: string;
  promptExcerpt: string;
  responsibilityAcknowledged: boolean;
  attachmentUri?: string;
  attachmentBase64?: string;
  attachmentFilename?: string;
  attachmentMimeType?: string;
};

export async function createSubmission(input: CreateSubmissionInput) {
  const module = await prisma.module.findUnique({
    where: { id: input.moduleId },
    include: { activeVersion: true },
  });

  if (!module || !module.activeVersion || !module.activeVersion.publishedAt) {
    throw new Error("Module active version is not available.");
  }

  const parseOutcome = await resolveSubmissionRawTextFromAttachment({
    rawText: input.rawText,
    attachmentBase64: input.attachmentBase64,
    attachmentFilename: input.attachmentFilename,
    attachmentMimeType: input.attachmentMimeType,
  });

  const submission = await prisma.submission.create({
    data: {
      userId: input.userId,
      moduleId: module.id,
      moduleVersionId: module.activeVersion.id,
      locale: input.locale,
      deliveryType: input.deliveryType,
      rawText: parseOutcome.resolvedRawText,
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
      submissionId: submission.id,
      moduleId: submission.moduleId,
      moduleVersionId: submission.moduleVersionId,
      parser: parseOutcome.parser,
    },
  });

  logOperationalEvent("submission_document_parse", {
    submissionId: submission.id,
    moduleId: submission.moduleId,
    deliveryType: submission.deliveryType,
    parser: parseOutcome.parser,
  });

  return submission;
}

export async function getOwnedSubmission(submissionId: string, userId: string) {
  return prisma.submission.findFirst({
    where: { id: submissionId, userId },
    include: {
      moduleVersion: true,
      appeals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          appealStatus: true,
          createdAt: true,
          resolvedAt: true,
        },
      },
      mcqAttempts: {
        orderBy: { createdAt: "desc" },
        include: { responses: true },
      },
      llmEvaluations: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { finalisedAt: "desc" } },
    },
  });
}

export async function getOwnedSubmissionHistory(input: {
  userId: string;
  limit: number;
}) {
  return prisma.submission.findMany({
    where: { userId: input.userId },
    orderBy: { submittedAt: "desc" },
    take: input.limit,
    include: {
      module: {
        select: {
          id: true,
          title: true,
        },
      },
      mcqAttempts: {
        where: { completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: {
          id: true,
          scaledScore: true,
          percentScore: true,
          passFailMcq: true,
          completedAt: true,
        },
      },
      llmEvaluations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          practicalScoreScaled: true,
          passFailPractical: true,
          manualReviewRecommended: true,
          createdAt: true,
        },
      },
      decisions: {
        orderBy: { finalisedAt: "desc" },
        take: 1,
        select: {
          id: true,
          decisionType: true,
          passFailTotal: true,
          totalScore: true,
          decisionReason: true,
          finalisedAt: true,
        },
      },
    },
  });
}
