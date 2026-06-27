import { prisma } from "../../db/prisma.js";
import { AppRole } from "../../db/prismaRuntime.js";
import { localizeContentText } from "../../i18n/content.js";
import {
  getDiscussionQuestionNotificationMessage,
  getDiscussionReplyNotificationMessage,
} from "../../i18n/notificationMessages.js";
import { sendDiscussionNotification } from "../certification/participantNotificationService.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";

/**
 * Diskusjon — minimal varsling (#495/T-QA-5). Nytt SPØRSMÅL → kursets SMO-er; nytt SVAR →
 * trådens abonnenter (auto-abonnement skjer ved opprett/svar i discussionService). Gjenbruker
 * ACS-kanalen via participantNotificationService. Preferanse-/digest-styring eies av #497 — holdt
 * bevisst minimalt her. Alle feil svelges av kalleren: varsling skal aldri velte selve handlingen.
 *
 * Merknad: `Course` har ingen eier-kobling, så «kursets SMO» = alle aktive brukere med rollen
 * SUBJECT_MATTER_OWNER. Ingen per-bruker locale finnes ennå; vi bruker org-default (nb).
 */

const NOTIFY_LOCALE = "nb" as const;

export async function notifyNewQuestion(input: {
  courseId: string;
  threadId: string;
  threadTitle: string;
  authorId: string;
}): Promise<void> {
  const now = new Date();
  const [smos, course] = await Promise.all([
    prisma.user.findMany({
      where: {
        activeStatus: true,
        isAnonymized: false,
        id: { not: input.authorId },
        roleAssignments: {
          some: {
            appRole: AppRole.SUBJECT_MATTER_OWNER,
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gte: now } }],
          },
        },
      },
      select: { id: true, email: true, name: true },
    }),
    prisma.course.findUnique({ where: { id: input.courseId }, select: { title: true } }),
  ]);
  if (smos.length === 0) return;

  const courseTitle = localizeContentText(NOTIFY_LOCALE, course?.title ?? "") ?? course?.title ?? "";
  const message = getDiscussionQuestionNotificationMessage(NOTIFY_LOCALE, {
    courseTitle,
    threadTitle: input.threadTitle,
  });

  let delivered = 0;
  let channel = "unknown";
  for (const smo of smos) {
    const result = await sendDiscussionNotification({
      recipientEmail: smo.email,
      recipientName: smo.name,
      subject: message.subject,
      body: message.nextStepGuidance,
      notificationType: "discussion_question_created",
    });
    channel = result.channel;
    if (result.delivered) delivered += 1;
  }

  await recordAuditEvent({
    entityType: auditEntityTypes.discussionThread,
    entityId: input.threadId,
    action:
      delivered > 0
        ? auditActions.certification.participantNotificationSent
        : auditActions.certification.participantNotificationFailed,
    actorId: input.authorId,
    metadata: {
      channel,
      notificationType: "discussion_question_created",
      recipientCount: smos.length,
      delivered,
    },
  });
}

export async function notifyNewReply(input: {
  threadId: string;
  threadTitle: string;
  replyAuthorId: string;
}): Promise<void> {
  const subscriptions = await prisma.discussionSubscription.findMany({
    where: { threadId: input.threadId, userId: { not: input.replyAuthorId } },
    select: { user: { select: { id: true, email: true, name: true, isAnonymized: true, activeStatus: true } } },
  });
  const recipients = subscriptions
    .map((s) => s.user)
    .filter((u) => u.activeStatus && !u.isAnonymized);
  if (recipients.length === 0) return;

  const message = getDiscussionReplyNotificationMessage(NOTIFY_LOCALE, { threadTitle: input.threadTitle });

  let delivered = 0;
  let channel = "unknown";
  for (const user of recipients) {
    const result = await sendDiscussionNotification({
      recipientEmail: user.email,
      recipientName: user.name,
      subject: message.subject,
      body: message.nextStepGuidance,
      notificationType: "discussion_reply_created",
    });
    channel = result.channel;
    if (result.delivered) delivered += 1;
  }

  await recordAuditEvent({
    entityType: auditEntityTypes.discussionReply,
    entityId: input.threadId,
    action:
      delivered > 0
        ? auditActions.certification.participantNotificationSent
        : auditActions.certification.participantNotificationFailed,
    actorId: input.replyAuthorId,
    metadata: {
      channel,
      notificationType: "discussion_reply_created",
      recipientCount: recipients.length,
      delivered,
    },
  });
}
