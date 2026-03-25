import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { ValidationError } from "../../errors/AppError.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { submissionRepository, createSubmissionRepository, getModuleWithActiveVersion } from "./submissionRepository.js";
import { runInTransaction } from "../../db/transaction.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { resolveSubmissionResponseJson } from "../assessment/documentParsingService.js";
import { supersedeEligibleReviewsForRetake } from "../review/index.js";
import { supersedeEligibleAppealsForRetake } from "../appeal/index.js";
import { toSubmissionHistoryResponseView, toSubmissionResultView } from "./submissionReadModels.js";

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

type ParseOutcome = Awaited<ReturnType<typeof resolveSubmissionResponseJson>>;

async function createSubmissionCommand(
  input: CreateSubmissionInput,
  moduleId: string,
  moduleVersionId: string,
  parseOutcome: ParseOutcome,
) {
  return runInTransaction(async (tx) => {
    const submission = await createSubmissionRepository(tx).create({
      userId: input.userId,
      moduleId,
      moduleVersionId,
      locale: input.locale,
      deliveryType: input.deliveryType,
      responseJson: JSON.stringify(parseOutcome.resolvedResponseJson),
      attachmentUri: input.attachmentUri,
      submissionStatus: SubmissionStatus.SUBMITTED,
    });

    await recordAuditEvent({
      entityType: auditEntityTypes.submission,
      entityId: submission.id,
      action: auditActions.submission.created,
      actorId: input.userId,
      metadata: {
        submissionId: submission.id,
        moduleId: submission.moduleId,
        moduleVersionId: submission.moduleVersionId,
        parser: parseOutcome.parser,
      },
    }, tx);

    const supersededReviewCount = await supersedeEligibleReviewsForRetake(input.userId, moduleId, submission.id, tx);
    const supersededAppealCount = await supersedeEligibleAppealsForRetake(input.userId, moduleId, submission.id, tx);

    if (supersededReviewCount + supersededAppealCount > 0) {
      await recordAuditEvent({
        entityType: auditEntityTypes.submission,
        entityId: submission.id,
        action: auditActions.submission.retakeSupersedeCompleted,
        actorId: input.userId,
        metadata: { supersededReviewCount, supersededAppealCount },
      }, tx);
    }

    return submission;
  });
}

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

  const submission = await createSubmissionCommand(input, module.id, module.activeVersion.id, parseOutcome);

  logOperationalEvent(operationalEvents.submission.documentParse, {
    submissionId: submission.id,
    moduleId: submission.moduleId,
    deliveryType: submission.deliveryType,
    parser: parseOutcome.parser,
  });

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

export async function getOwnedSubmissionHistoryView(input: {
  userId: string;
  limit: number;
  locale: string;
}) {
  const submissions = await getOwnedSubmissionHistory({
    userId: input.userId,
    limit: input.limit,
  });

  return toSubmissionHistoryResponseView(submissions, input.locale);
}

export async function getOwnedSubmissionResultView(submissionId: string, userId: string) {
  const submission = await getOwnedSubmission(submissionId, userId);

  return submission ? toSubmissionResultView(submission) : null;
}
