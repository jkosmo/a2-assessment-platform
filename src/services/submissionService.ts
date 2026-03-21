import { SubmissionStatus } from "../db/prismaRuntime.js";
import { ValidationError } from "../errors/AppError.js";
import type { SupportedLocale } from "../i18n/locale.js";
import { getModuleWithActiveVersion } from "../repositories/moduleRepository.js";
import { submissionRepository } from "../repositories/submissionRepository.js";
import { recordAuditEvent } from "./auditService.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { resolveSubmissionResponseJson } from "./documentParsingService.js";
import { cancelSupersededReviews } from "../modules/review/index.js";
import { cancelSupersededAppeals } from "../modules/appeal/index.js";

export type CreateSubmissionInput = {
  userId: string;
  moduleId: string;
  locale: SupportedLocale;
  deliveryType: string;
  responseJson: Record<string, unknown>;
  attachmentUri?: string;
  attachmentBase64?: string;
  attachmentFilename?: string;
  attachmentMimeType?: string;
};

export async function createSubmission(input: CreateSubmissionInput) {
  const module = await getModuleWithActiveVersion(input.moduleId);

  if (!module || !module.activeVersion || !module.activeVersion.publishedAt) {
    throw new ValidationError("Module active version is not available.");
  }

  const parseOutcome = await resolveSubmissionResponseJson({
    responseJson: input.responseJson,
    attachmentBase64: input.attachmentBase64,
    attachmentFilename: input.attachmentFilename,
    attachmentMimeType: input.attachmentMimeType,
  });

  const submission = await submissionRepository.create({
    userId: input.userId,
    moduleId: module.id,
    moduleVersionId: module.activeVersion.id,
    locale: input.locale,
    deliveryType: input.deliveryType,
    responseJson: JSON.stringify(parseOutcome.resolvedResponseJson),
    attachmentUri: input.attachmentUri,
    submissionStatus: SubmissionStatus.SUBMITTED,
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

  await cancelSupersededReviews(input.userId, input.moduleId, submission.id);
  await cancelSupersededAppeals(input.userId, input.moduleId, submission.id);

  return submission;
}

export async function getOwnedSubmission(submissionId: string, userId: string) {
  return submissionRepository.findOwnedSubmission(submissionId, userId);
}

export async function getSubmissionForAssessmentView(submissionId: string, userId: string) {
  return submissionRepository.findSubmissionForAssessmentView(submissionId, userId);
}

export async function getOwnedSubmissionHistory(input: {
  userId: string;
  limit: number;
}) {
  return submissionRepository.findOwnedSubmissionHistory(input.userId, input.limit);
}
