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
import { recipientLocale } from "../../i18n/recipientLocale.js";
import { isReachableParticipant } from "../user/participantReach.js";

/**
 * Diskusjon — minimal varsling (#495/T-QA-5). Nytt SPØRSMÅL → kursets eiere; nytt SVAR →
 * trådens abonnenter (auto-abonnement skjer ved opprett/svar i discussionService). Gjenbruker
 * ACS-kanalen via participantNotificationService. Alle feil svelges av kalleren: varsling skal aldri
 * velte selve handlingen.
 *
 * #970: språket er MOTTAKERENS («sist sett», `recipientLocale`).
 */

const recipientSelect = { id: true, email: true, name: true, preferredLocale: true, activeStatus: true, isAnonymized: true } as const;

/**
 * 2.119.0: hvem som får e-post om et nytt spørsmål. Før gikk den til ALLE fagansvarlige på plattformen,
 * fordi kurs ikke hadde eiere da varslingen ble laget. Nå: kursets eiere (`ContentOwner`), og bare når
 * eierne ikke har slått det av på kurset.
 *
 * Har kurset ingen eier som kan nås (alle har sluttet, eller kurset ble laget av systemet), går varselet
 * til administratorene — ellers blir spørsmålet liggende uten at noen vet om det. Er spørsmålsstilleren
 * selv eneste eier, er det ingen å varsle, og da skal det heller ikke gå til administratorene.
 */
export async function findQuestionRecipients(courseId: string, authorId: string, now = new Date()) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true, discussionOwnerNotifications: true } });
  if (!course || !course.discussionOwnerNotifications) return { course, recipients: [] };

  const ownerRows = await prisma.contentOwner.findMany({
    where: { contentType: "COURSE", contentId: courseId },
    select: { user: { select: recipientSelect } },
  });
  let reachable = ownerRows.map((row) => row.user).filter((user) => isReachableParticipant(user));
  if (reachable.length === 0) {
    reachable = await prisma.user.findMany({
      where: {
        activeStatus: true,
        isAnonymized: false,
        roleAssignments: {
          some: {
            appRole: AppRole.ADMINISTRATOR,
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gte: now } }],
          },
        },
      },
      select: recipientSelect,
    });
  }
  return { course, recipients: reachable.filter((user) => user.id !== authorId) };
}

export async function notifyNewQuestion(input: {
  courseId: string;
  threadId: string;
  threadTitle: string;
  authorId: string;
}): Promise<void> {
  const { course, recipients } = await findQuestionRecipients(input.courseId, input.authorId);
  if (recipients.length === 0) return;

  let delivered = 0;
  let channel = "unknown";
  for (const recipient of recipients) {
    const locale = recipientLocale(recipient);
    const message = getDiscussionQuestionNotificationMessage(locale, {
      courseTitle: localizeContentText(locale, course?.title ?? "") ?? course?.title ?? "",
      threadTitle: input.threadTitle,
    });
    const result = await sendDiscussionNotification({
      recipientEmail: recipient.email,
      recipientName: recipient.name,
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
      recipientCount: recipients.length,
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
    select: { user: { select: { id: true, email: true, name: true, isAnonymized: true, activeStatus: true, preferredLocale: true } } },
  });
  const recipients = subscriptions
    .map((s) => s.user)
    .filter((u) => isReachableParticipant(u)); // #968: samme regel som publikum og påminnelser
  if (recipients.length === 0) return;

  let delivered = 0;
  let channel = "unknown";
  for (const user of recipients) {
    const message = getDiscussionReplyNotificationMessage(recipientLocale(user), { threadTitle: input.threadTitle });
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
