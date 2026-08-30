import { AppealStatus, DecisionType, SubmissionStatus } from "../../db/prismaRuntime.js";
import { allLocaleValues } from "../../i18n/allLocaleValues.js";
import { ConflictError, NotFoundError } from "../../errors/AppError.js";
import { appealRepository, createAppealRepository } from "./appealRepository.js";
import { runInTransaction, type DbTransactionClient } from "../../db/transaction.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { buildAppealSlaSnapshot } from "./appealSla.js";
import { notifyAppealStatusTransition } from "../certification/index.js";
import { env } from "../../config/env.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { appendDecisionWithLineage } from "../assessment/decisionLineageService.js";
import { enqueueOutboxEvents, OUTBOX_EVENT_TYPES } from "../outbox/outboxService.js";
import { localizeContentText } from "../../i18n/content.js";
import { normalizeLocale } from "../../i18n/locale.js";
import { toAppealWorkspaceView } from "./appealReadModels.js";

export async function createSubmissionAppeal(input: {
  submissionId: string;
  appealedById: string;
  appealReason: string;
}) {
  const submission = await appealRepository.findOwnedSubmissionWithLatestDecision(input.submissionId, input.appealedById);

  if (!submission) {
    throw new NotFoundError("Submission");
  }
  if (!submission.decisions[0]) {
    throw new ConflictError(
      "missing_decision",
      "Submission must have an assessment decision before an appeal can be created.",
    );
  }

  const activeAppeal = await appealRepository.findActiveAppealForSubmission(submission.id, [
    AppealStatus.OPEN,
    AppealStatus.IN_REVIEW,
  ]);

  if (activeAppeal) {
    throw new ConflictError("appeal_already_open", "Submission already has an open or in-review appeal.");
  }

  const appeal = await runInTransaction(async (tx) => {
    const txRepo = createAppealRepository(tx);

    const createdAppeal = await txRepo.createAppeal({
      submissionId: submission.id,
      appealedById: input.appealedById,
      appealReason: input.appealReason,
      appealStatus: AppealStatus.OPEN,
    });

    await txRepo.updateSubmissionStatus(submission.id, SubmissionStatus.UNDER_REVIEW);

    await recordAuditEvent({
      entityType: auditEntityTypes.appeal,
      entityId: createdAppeal.id,
      action: auditActions.appeal.created,
      actorId: input.appealedById,
      metadata: {
        submissionId: submission.id,
        appealStatus: createdAppeal.appealStatus,
      },
    }, tx);

    return createdAppeal;
  });

  const appealedBy = await appealRepository.findUserNotificationRecipient(input.appealedById);

  if (appealedBy) {
    const locale = normalizeLocale(submission.locale) ?? env.DEFAULT_LOCALE;
    const moduleTitle = localizeContentText(locale, submission.module.title) ?? submission.moduleId;
    await safeNotifyAppealStatusTransition({
      appealId: appeal.id,
      submissionId: submission.id,
      previousStatus: null,
      currentStatus: appeal.appealStatus,
      recipientUserId: appealedBy.id,
      recipientEmail: appealedBy.email,
      recipientName: appealedBy.name,
      moduleTitle,
      locale,
    });
  }

  return appeal;
}

export async function listAppealQueue(input: {
  statuses: Array<"OPEN" | "IN_REVIEW" | "RESOLVED" | "REJECTED" | "SUPERSEDED">;
  limit: number;
  locale?: string;
}) {
  const appeals = await appealRepository.findAppealsForQueue(input.statuses, input.limit);

  return appeals.map((appeal) => ({
    sla: buildAppealSlaSnapshot({
      createdAt: appeal.createdAt,
      claimedAt: appeal.claimedAt,
      resolvedAt: appeal.resolvedAt,
      appealStatus: appeal.appealStatus,
    }),
    id: appeal.id,
    appealStatus: appeal.appealStatus,
    appealReason: appeal.appealReason,
    createdAt: appeal.createdAt,
    claimedAt: appeal.claimedAt,
    resolvedAt: appeal.resolvedAt,
    appealedBy: appeal.appealedBy,
    resolvedBy: appeal.resolvedBy,
    submission: {
      id: appeal.submission.id,
      submittedAt: appeal.submission.submittedAt,
      submissionStatus: appeal.submission.submissionStatus,
      user: appeal.submission.user,
      // #1027: serveren eier spørsmålet «hvilket språk viser vi». Klagekøen sendte
      // lagringsformatet og lot klienten tolke det selv — med en annen reservekjede enn serverens.
      // Køen for manuell vurdering ble rettet i #1022; denne sto igjen.
      module: {
        ...appeal.submission.module,
        title:
          localizeContentText(normalizeLocale(input.locale) ?? "en-GB", appeal.submission.module.title) ??
          appeal.submission.module.title,
        // ⚠️ Søket i køen gikk over den RÅ JSON-strengen, og traff derfor på tvers av alle språk.
        // Utilsiktet, men nyttig: en behandler fant saken uansett hvilket språk tittelen ble
        // skrevet på. Sender vi bare den lokaliserte tittelen, blir søket SMALERE enn før — og det
        // skjedde allerede for manuell vurdering i #1022 uten at noen merket det.
        //
        // Alle variantene følger derfor med som et eget felt. Visningen blir riktig, og søket
        // finner det man leter etter.
        titleSearch: allLocaleValues(appeal.submission.module.title),
      },
      latestDecision: appeal.submission.decisions[0] ?? null,
    },
  }));
}

export async function getAppealWorkspace(appealId: string) {
  return appealRepository.findAppealWorkspace(appealId);
}

export async function getAppealWorkspaceView(appealId: string, locale: string) {
  const workspace = await getAppealWorkspace(appealId);

  return workspace ? toAppealWorkspaceView(workspace, locale) : null;
}

export async function claimAppeal(appealId: string, handlerId: string, isAdmin = false) {
  const appeal = await appealRepository.findAppealForClaim(appealId);

  if (!appeal) {
    throw new NotFoundError("Appeal");
  }
  if (appeal.appealStatus === AppealStatus.RESOLVED || appeal.appealStatus === AppealStatus.REJECTED || appeal.appealStatus === AppealStatus.SUPERSEDED) {
    throw new ConflictError(
      "appeal_already_resolved",
      "This appeal is already resolved. Refresh the queue to view the latest status.",
    );
  }
  const previousHandlerId = appeal.resolvedById;
  if (
    appeal.appealStatus === AppealStatus.IN_REVIEW &&
    previousHandlerId &&
    previousHandlerId !== handlerId
  ) {
    if (!isAdmin) {
      throw new ConflictError(
        "appeal_already_assigned",
        "This appeal is already assigned to another handler. Refresh the queue and open another case.",
      );
    }
    await recordAuditEvent({
      entityType: auditEntityTypes.appeal,
      entityId: appealId,
      action: auditActions.appeal.adminTakeover,
      actorId: handlerId,
      metadata: { submissionId: appeal.submissionId, previousHandlerId, newHandlerId: handlerId },
    });
  }

  // #790: atomic guarded claim. If a concurrent handler claimed first, count===0 → we lost the race.
  // #803: the guarded claim + its audit commit atomically.
  const claimed = await runInTransaction(async (tx) => {
    const repo = createAppealRepository(tx);
    const claimResult = await repo.markAppealInReviewGuarded(
      appealId,
      handlerId,
      isAdmin,
      appeal.claimedAt != null,
    );
    if (claimResult.count === 0) {
      throw new ConflictError(
        "appeal_already_assigned",
        "This appeal was just claimed by another handler. Refresh the queue and open another case.",
      );
    }
    const claimedAppeal = await repo.findAppealForClaim(appealId);
    if (!claimedAppeal) {
      throw new NotFoundError("Appeal");
    }

    await recordAuditEvent(
      {
        entityType: auditEntityTypes.appeal,
        entityId: claimedAppeal.id,
        action: auditActions.appeal.claimed,
        actorId: handlerId,
        metadata: {
          submissionId: appeal.submissionId,
          appealStatus: claimedAppeal.appealStatus,
          claimedAt: claimedAppeal.claimedAt?.toISOString() ?? null,
        },
      },
      tx,
    );
    return claimedAppeal;
  });

  const claimLocale = normalizeLocale(appeal.submission.locale) ?? env.DEFAULT_LOCALE;
  const claimModuleTitle = localizeContentText(claimLocale, appeal.submission.module.title) ?? appeal.submissionId;
  await safeNotifyAppealStatusTransition({
    appealId: claimed.id,
    submissionId: appeal.submissionId,
    previousStatus: appeal.appealStatus,
    currentStatus: claimed.appealStatus,
    recipientUserId: appeal.appealedBy.id,
    recipientEmail: appeal.appealedBy.email,
    recipientName: appeal.appealedBy.name,
    moduleTitle: claimModuleTitle,
    locale: claimLocale,
  });

  return claimed;
}

export async function resolveAppeal(input: {
  appealId: string;
  handlerId: string;
  passFailTotal: boolean;
  decisionReason: string;
  resolutionNote: string;
  isAdmin?: boolean;
}) {
  const appeal = await appealRepository.findAppealForResolution(input.appealId);

  if (!appeal) {
    throw new NotFoundError("Appeal");
  }
  if (appeal.appealStatus === AppealStatus.RESOLVED || appeal.appealStatus === AppealStatus.REJECTED || appeal.appealStatus === AppealStatus.SUPERSEDED) {
    throw new ConflictError(
      "appeal_already_resolved",
      "This appeal is already resolved. Refresh the queue to view the latest status.",
    );
  }
  if (
    appeal.appealStatus === AppealStatus.IN_REVIEW &&
    appeal.resolvedById &&
    appeal.resolvedById !== input.handlerId
  ) {
    if (!input.isAdmin) {
      throw new ConflictError(
        "appeal_already_assigned",
        "This appeal is already assigned to another handler. Refresh the queue and open another case.",
      );
    }
    await recordAuditEvent({
      entityType: auditEntityTypes.appeal,
      entityId: input.appealId,
      action: auditActions.appeal.adminTakeover,
      actorId: input.handlerId,
      metadata: { submissionId: appeal.submissionId, previousHandlerId: appeal.resolvedById, newHandlerId: input.handlerId },
    });
  }

  const latestDecision = appeal.submission.decisions[0];
  if (!latestDecision) {
    throw new ConflictError(
      "missing_decision",
      "This appeal cannot be resolved yet because the submission has no decision.",
    );
  }

  const finalisedAt = new Date();

  const { resolutionDecision, resolvedAppeal } = await resolveAppealCommand(appeal, input, latestDecision, finalisedAt);

  const resolveLocale = normalizeLocale(appeal.submission.locale) ?? env.DEFAULT_LOCALE;
  const resolveModuleTitle = localizeContentText(resolveLocale, appeal.submission.module.title) ?? latestDecision.submissionId;
  await safeNotifyAppealStatusTransition({
    appealId: resolvedAppeal.id,
    submissionId: latestDecision.submissionId,
    previousStatus: appeal.appealStatus,
    currentStatus: resolvedAppeal.appealStatus,
    recipientUserId: appeal.appealedBy.id,
    recipientEmail: appeal.appealedBy.email,
    recipientName: appeal.appealedBy.name,
    moduleTitle: resolveModuleTitle,
    locale: resolveLocale,
    passFailTotal: input.passFailTotal,
    resolutionNote: input.resolutionNote,
  });

  // #946: kursfullføringen ligger nå på outboxen, lagt der inne i transaksjonen i
  // `resolveAppealCommand`. Den sto tidligere her som et fire-and-forget-kall etter at svaret
  // var sendt: feilet det, var utstedelsen tapt og bare en loggrad visste om det — mens
  // påminnelsesjobben og kull-dashbordet spør «finnes rad?» og dermed så kandidaten som forfalt.
  return { appeal: resolvedAppeal, resolutionDecision };
}

type ResolutionAppeal = NonNullable<Awaited<ReturnType<typeof appealRepository.findAppealForResolution>>>;
type ResolutionDecision = NonNullable<ResolutionAppeal["submission"]["decisions"][number]>;

async function resolveAppealCommand(
  appeal: ResolutionAppeal,
  input: { handlerId: string; passFailTotal: boolean; decisionReason: string; resolutionNote: string; isAdmin?: boolean },
  latestDecision: ResolutionDecision,
  finalisedAt: Date,
) {
  return runInTransaction(async (tx) => {
    const repo = createAppealRepository(tx);

    // #790: perform the guarded state transition FIRST. If a concurrent resolve already moved the appeal
    // to a terminal state, count===0 → ConflictError rolls the transaction back before we append a second
    // APPEAL_RESOLUTION decision (which would corrupt the immutable lineage with duplicate resolutions).
    const transition = await repo.markAppealResolvedGuarded(
      appeal.id,
      input.handlerId,
      finalisedAt,
      input.resolutionNote,
      input.isAdmin ?? false,
    );
    if (transition.count === 0) {
      throw new ConflictError(
        "appeal_already_resolved",
        "This appeal was just resolved by another handler. Refresh the queue to view the latest status.",
      );
    }

    const resolutionDecision = await appendDecisionWithLineage(
      {
        parentDecision: latestDecision,
        passFailTotal: input.passFailTotal,
        decisionType: DecisionType.APPEAL_RESOLUTION,
        decisionReason: input.decisionReason,
        finalisedAt,
        finalisedById: input.handlerId,
        actorId: input.handlerId,
        auditAction: auditActions.appeal.resolutionDecisionCreated,
        auditMetadata: {
          submissionId: latestDecision.submissionId,
          appealId: appeal.id,
          parentDecisionId: latestDecision.id,
          passFailTotal: input.passFailTotal,
        },
      },
      tx,
    );

    // Re-read the plain appeal row (same shape the old update-by-id returned) now that the guard has
    // committed the transition, for the audit + the caller's response.
    const resolvedAppeal = await repo.findAppealById(appeal.id);

    await recordAuditEvent({
      entityType: auditEntityTypes.appeal,
      entityId: resolvedAppeal.id,
      action: auditActions.appeal.resolved,
      actorId: input.handlerId,
      metadata: {
        submissionId: latestDecision.submissionId,
        resolutionDecisionId: resolutionDecision.id,
        appealStatus: resolvedAppeal.appealStatus,
      },
    }, tx);

    // #946: samme dør som den automatiske stien (AssessmentDecisionApplicationService). Hendelsen
    // commiter sammen med vedtaket, så en krasj gir enten begge eller ingen av dem — aldri et
    // bestått vedtak uten at noen kommer til å sjekke kursfullføringen.
    await enqueueOutboxEvents(
      [
        {
          type: OUTBOX_EVENT_TYPES.courseCompletionCheck,
          payload: { userId: appeal.submission.userId, moduleId: appeal.submission.moduleId },
        },
      ],
      tx,
    );

    return { resolutionDecision, resolvedAppeal };
  });
}

type SupersedeTxClient = Pick<DbTransactionClient, "appeal" | "submission" | "user" | "assessmentDecision" | "auditEvent">;

export async function supersedeEligibleAppealsForRetake(
  userId: string,
  moduleId: string,
  newSubmissionId: string,
  tx: SupersedeTxClient,
): Promise<number> {
  const repo = createAppealRepository(tx);
  const appeals = await repo.findOpenByUserAndModule(userId, moduleId);
  if (appeals.length === 0) return 0;

  const now = new Date();
  await repo.supersedeMany(appeals.map((a) => a.id), newSubmissionId, now);

  for (const appeal of appeals) {
    await recordAuditEvent({
      entityType: auditEntityTypes.appeal,
      entityId: appeal.id,
      action: auditActions.appeal.superseded,
      actorId: undefined,
      metadata: { newSubmissionId, supersededAt: now.toISOString() },
    }, tx);
  }

  return appeals.length;
}

async function safeNotifyAppealStatusTransition(
  input: Parameters<typeof notifyAppealStatusTransition>[0],
) {
  try {
    await notifyAppealStatusTransition(input);
  } catch (error) {
    logOperationalEvent(
      operationalEvents.certification.participantNotificationPipelineFailed,
      {
        appealId: input.appealId,
        submissionId: input.submissionId,
        currentStatus: input.currentStatus,
        recipientUserId: input.recipientUserId,
        recipientEmail: input.recipientEmail,
        errorMessage: error instanceof Error ? error.message : "Unknown notification error",
      },
      "error",
    );
  }
}
