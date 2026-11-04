import { SubmissionStatus } from "../../db/prismaRuntime.js";
import { ConflictError } from "../../errors/AppError.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { submissionRepository, createSubmissionRepository, getModuleWithActiveVersion, queryRubricCriteriaJson } from "./submissionRepository.js";
import { runContentReadForLearner } from "../../db/contentLock.js";
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
  // #934 skive 5a-1: modulversjonen siden viste da deltakeren skrev svaret. Mangler den, er fanen fra før utrullingen.
  moduleVersionId?: string;
  locale: SupportedLocale;
  deliveryType: string;
  responseJson: Record<string, unknown>;
  attachmentUri?: string;
  attachmentBase64?: string;
  attachmentFilename?: string;
  attachmentMimeType?: string;
  // #475: aggregate-only AI-use declaration + reflective-nudge choice. Persisted verbatim on
  // Submission.processSignalsJson; never influences scoring here — only the assessment decision
  // engine reads it, and only as a review trigger.
  processSignals?: {
    declaration?: "none" | "ideas" | "improve" | "autonomous";
    declarationText?: string;
    insistedAfterPrompt?: boolean;
  };
};

type ParseOutcome = Awaited<ReturnType<typeof resolveSubmissionResponseJson>>;

function moduleVersionUnavailable(moduleId: string) {
  // #999: modulen har ingen publisert aktiv versjon akkurat nå — en TILSTANDSKONFLIKT (409), ikke
  // et skjema som feilet. Egen kode så deltakerflaten kan si «modulen er ikke tilgjengelig» på
  // sitt språk; setningen her er reserven for API-konsumenter og loggen.
  return new ConflictError("module_version_unavailable", "Module active version is not available.", { moduleId });
}

function moduleVersionChanged(moduleId: string) {
  return new ConflictError(
    "module_version_changed",
    "The module has a new version since this page was opened. Nothing was submitted; reload the page.",
    { moduleId },
  );
}

async function createSubmissionCommand(
  input: CreateSubmissionInput,
  seenVersionId: string,
  parseOutcome: ParseOutcome,
) {
  // #934 skive 5a-1: innholdslåsen delt, så deltakerlåsen. Versjonen leses og sjekkes ETTER låsene: en publisering
  // står enten ferdig (409 under) eller venter til innleveringen er skrevet. Den registreres aldri på en annen versjon
  // enn den deltakeren så.
  return runContentReadForLearner(input.userId, async (tx) => {
    const module = await getModuleWithActiveVersion(input.moduleId, tx);
    if (!module?.activeVersion?.publishedAt) throw moduleVersionUnavailable(input.moduleId);
    if (module.activeVersion.id !== seenVersionId) throw moduleVersionChanged(input.moduleId);
    const moduleId = module.id;

    const submission = await createSubmissionRepository(tx).create(tx, {
      userId: input.userId,
      moduleId,
      moduleVersionId: module.activeVersion.id,
      locale: input.locale,
      deliveryType: input.deliveryType,
      responseJson: JSON.stringify(parseOutcome.resolvedResponseJson),
      // #475: store the declaration only when one was actually made; otherwise leave the column null.
      processSignalsJson: input.processSignals?.declaration
        ? JSON.stringify(input.processSignals)
        : null,
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
  // Bare en rask sjekk, så et dokument ikke tolkes til ingen nytte. Det som avgjør, skjer under låsene.
  const module = await getModuleWithActiveVersion(input.moduleId);

  if (!module || !module.activeVersion || !module.activeVersion.publishedAt) {
    throw moduleVersionUnavailable(input.moduleId);
  }
  // #934 skive 5a-1: en fane fra før utrullingen sender ikke versjonen. Den kan ikke vite hva deltakeren så.
  if (!input.moduleVersionId) {
    throw new ConflictError(
      "client_outdated",
      "This page is out of date. Nothing was submitted; reload the page.",
      { moduleId: input.moduleId },
    );
  }
  if (module.activeVersion.id !== input.moduleVersionId) throw moduleVersionChanged(input.moduleId);

  const parseOutcome = await resolveSubmissionResponseJson({
    responseJson: input.responseJson,
    attachmentBase64: input.attachmentBase64,
    attachmentFilename: input.attachmentFilename,
    attachmentMimeType: input.attachmentMimeType,
  });

  const submission = await createSubmissionCommand(input, input.moduleVersionId, parseOutcome);

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

export async function getOwnedSubmissionResultView(submissionId: string, userId: string, locale: SupportedLocale = "en-GB") {
  const submission = await getOwnedSubmission(submissionId, userId);
  if (!submission) return null;

  // #1124: poengene per kriterium trenger kriteriene (etikett, egen skala, toppnivåets trinn).
  const criteriaJson = await queryRubricCriteriaJson(submission.moduleVersion?.rubricVersionId);
  return toSubmissionResultView(submission, { criteriaJson, locale });
}
