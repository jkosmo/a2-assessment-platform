import { EmailClient } from "@azure/communication-email";
import type { AppealStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { withTimeout } from "../../clients/externalCall.js";
import { classifyAcsError, describeAcsFailure, nextAttemptDelayMs } from "./acsThrottle.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { getAppealNotificationMessage, getAssessmentResultNotificationMessage, getCourseAssignmentNotificationMessage } from "../../i18n/notificationMessages.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { recordAuditEvent } from "../../services/auditService.js";

type NotificationChannel = "disabled" | "log" | "webhook" | "acs_email";

export type AppealNotificationInput = {
  appealId: string;
  submissionId: string;
  previousStatus: AppealStatus | null;
  currentStatus: AppealStatus;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string | null;
  moduleTitle: string;
  locale: SupportedLocale;
  passFailTotal?: boolean;
  resolutionNote?: string;
};

type NotificationResult = {
  delivered: boolean;
  channel: NotificationChannel;
  subject: string;
  nextStepGuidance: string;
  failureReason?: string;
};

export async function sendAppealStatusNotification(input: AppealNotificationInput): Promise<NotificationResult> {
  const resolution =
    input.currentStatus === "RESOLVED" && input.passFailTotal !== undefined && input.resolutionNote !== undefined
      ? { passFailTotal: input.passFailTotal, resolutionNote: input.resolutionNote }
      : undefined;
  const message = getAppealNotificationMessage(input.locale, input.currentStatus, { moduleTitle: input.moduleTitle, resolution });
  const payload = {
    notificationType: "appeal_status_transition",
    appealId: input.appealId,
    submissionId: input.submissionId,
    previousStatus: input.previousStatus,
    currentStatus: input.currentStatus,
    moduleTitle: input.moduleTitle,
    recipient: {
      userId: input.recipientUserId,
      email: input.recipientEmail,
      name: input.recipientName,
      locale: input.locale,
    },
    subject: message.subject,
    nextStepGuidance: message.nextStepGuidance,
    emittedAt: new Date().toISOString(),
  };

  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  if (channel === "disabled") {
    return {
      delivered: false,
      channel,
      subject: message.subject,
      nextStepGuidance: message.nextStepGuidance,
      failureReason: "channel_disabled",
    };
  }

  if (channel === "log") {
    logOperationalEvent(operationalEvents.certification.participantNotificationSent, {
      channel,
      ...payload,
    });
    return {
      delivered: true,
      channel,
      subject: message.subject,
      nextStepGuidance: message.nextStepGuidance,
    };
  }

  if (channel === "acs_email") {
    return sendViaAcs({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? undefined,
      subject: message.subject,
      body: message.nextStepGuidance,
      logPayload: payload,
    });
  }

  const webhookUrl = env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    logOperationalEvent(
      operationalEvents.certification.participantNotificationFailed,
      {
        channel,
        ...payload,
        failureReason: "missing_webhook_url",
      },
      "error",
    );
    return {
      delivered: false,
      channel,
      subject: message.subject,
      nextStepGuidance: message.nextStepGuidance,
      failureReason: "missing_webhook_url",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const failureReason = `webhook_non_2xx_${response.status}`;
      logOperationalEvent(
        operationalEvents.certification.participantNotificationFailed,
        {
          channel,
          ...payload,
          failureReason,
        },
        "error",
      );
      return {
        delivered: false,
        channel,
        subject: message.subject,
        nextStepGuidance: message.nextStepGuidance,
        failureReason,
      };
    }

    logOperationalEvent(operationalEvents.certification.participantNotificationSent, {
      channel,
      ...payload,
    });
    return {
      delivered: true,
      channel,
      subject: message.subject,
      nextStepGuidance: message.nextStepGuidance,
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "webhook_send_failed";
    logOperationalEvent(
      operationalEvents.certification.participantNotificationFailed,
      {
        channel,
        ...payload,
        failureReason,
      },
      "error",
    );
    return {
      delivered: false,
      channel,
      subject: message.subject,
      nextStepGuidance: message.nextStepGuidance,
      failureReason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendViaAcs(input: {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  body: string;
  logPayload: { channel?: string } & Record<string, unknown>;
}): Promise<NotificationResult> {
  const connectionString = env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING!;
  // ACS senderAddress must be a plain email address — display name is set at domain level in Azure.
  const senderAddress = env.ACS_EMAIL_SENDER!;

  const emailClient = new EmailClient(connectionString);
  const message = {
    senderAddress,
    content: { subject: input.subject, plainText: input.body },
    recipients: {
      to: [{ address: input.recipientEmail, displayName: input.recipientName }],
    },
  };

  try {
    // #812: bound the whole send (beginSend + pollUntilDone) so a slow/unresponsive ACS can't wedge the
    // calling worker tick. No retry on TIMEOUT — a re-send after a timeout could duplicate the email; the
    // scheduled monitors re-run on their next cycle and are audit-deduped, so a dropped send is recovered
    // safely without risking a double-send.
    //
    // #900: retry on THROTTLING only. ACS answers 429 «try again after N seconds» when several sends
    // land in the same second (seven class-assignment emails, 13.08.2026 — all seven lost). A 429 is
    // a rejection before acceptance, so re-sending cannot duplicate; we wait what ACS asks for.
    const result = await sendWithThrottleRetry(() =>
      withTimeout(
        (async () => {
          const poller = await emailClient.beginSend(message);
          return poller.pollUntilDone();
        })(),
        env.ACS_EMAIL_SEND_TIMEOUT_MS,
        "acs_email_send",
      ),
    );

    if (result.status === "Succeeded") {
      logOperationalEvent(operationalEvents.certification.participantNotificationSent, {
        channel: "acs_email",
        ...input.logPayload,
      });
      return { delivered: true, channel: "acs_email", subject: input.subject, nextStepGuidance: input.body };
    }

    const failureReason = `acs_send_status_${result.status}`;
    logOperationalEvent(
      operationalEvents.certification.participantNotificationFailed,
      { channel: "acs_email", ...input.logPayload, failureReason },
      "error",
    );
    return { delivered: false, channel: "acs_email", subject: input.subject, nextStepGuidance: input.body, failureReason };
  } catch (error) {
    // #900: statuskoden med i grunnen — før sto det «" - Please try again after 0 seconds."».
    const failureReason = describeAcsFailure(error);
    logOperationalEvent(
      operationalEvents.certification.participantNotificationFailed,
      { channel: "acs_email", ...input.logPayload, failureReason },
      "error",
    );
    return { delivered: false, channel: "acs_email", subject: input.subject, nextStepGuidance: input.body, failureReason };
  }
}

const ACS_THROTTLE_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Inntil tre forsøk ved ACS-struping; alt annet kastes videre uendret. Eksportert for test. */
export async function sendWithThrottleRetry<T>(
  attempt: () => Promise<T>,
  options: { attempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = options.attempts ?? ACS_THROTTLE_ATTEMPTS;
  const wait = options.wait ?? sleep;
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      const decision = classifyAcsError(error);
      if (!decision.throttled || i === attempts - 1) throw error;
      await wait(nextAttemptDelayMs(decision.waitMs, i));
    }
  }
  throw lastError;
}

export type AssessmentResultNotificationInput = {
  submissionId: string;
  submittedAt: Date;
  recipientEmail: string;
  recipientName: string | null;
  moduleTitle: string;
  moduleId: string;
  passFailTotal: boolean;
  locale: SupportedLocale;
};

export async function notifyAssessmentResult(input: AssessmentResultNotificationInput): Promise<void> {
  const outcome = input.passFailTotal ? "pass" : "fail";
  const message = getAssessmentResultNotificationMessage(input.locale, outcome, {
    moduleTitle: input.moduleTitle,
    submittedAt: input.submittedAt,
  });
  const logPayload = {
    notificationType: "assessment_result",
    submissionId: input.submissionId,
    moduleId: input.moduleId,
    moduleTitle: input.moduleTitle,
    outcome,
    recipient: { email: input.recipientEmail, locale: input.locale },
    subject: message.subject,
    emittedAt: new Date().toISOString(),
  };

  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;

  if (channel === "disabled") return;

  if (channel === "log") {
    logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...logPayload });
    return;
  }

  let result: NotificationResult;

  if (channel === "acs_email") {
    result = await sendViaAcs({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? undefined,
      subject: message.subject,
      body: message.nextStepGuidance,
      logPayload,
    });
  } else {
    const webhookUrl = env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL;
    if (!webhookUrl) {
      logOperationalEvent(
        operationalEvents.certification.participantNotificationFailed,
        { channel, ...logPayload, failureReason: "missing_webhook_url" },
        "error",
      );
      result = { delivered: false, channel, subject: message.subject, nextStepGuidance: message.nextStepGuidance, failureReason: "missing_webhook_url" };
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...logPayload }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const failureReason = `webhook_non_2xx_${response.status}`;
          logOperationalEvent(
            operationalEvents.certification.participantNotificationFailed,
            { channel, ...logPayload, failureReason },
            "error",
          );
          result = { delivered: false, channel, subject: message.subject, nextStepGuidance: message.nextStepGuidance, failureReason };
        } else {
          logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...logPayload });
          result = { delivered: true, channel, subject: message.subject, nextStepGuidance: message.nextStepGuidance };
        }
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : "webhook_send_failed";
        logOperationalEvent(
          operationalEvents.certification.participantNotificationFailed,
          { channel, ...logPayload, failureReason },
          "error",
        );
        result = { delivered: false, channel, subject: message.subject, nextStepGuidance: message.nextStepGuidance, failureReason };
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  await recordAuditEvent({
    entityType: auditEntityTypes.submission,
    entityId: input.submissionId,
    action: result.delivered
      ? auditActions.certification.participantNotificationSent
      : auditActions.certification.participantNotificationFailed,
    metadata: {
      notificationType: "assessment_result",
      moduleId: input.moduleId,
      outcome,
      channel: result.channel,
      subject: result.subject,
      delivered: result.delivered,
      failureReason: result.failureReason ?? null,
    },
  });
}

export async function notifyAppealStatusTransition(input: AppealNotificationInput) {
  const result = await sendAppealStatusNotification(input);

  await recordAuditEvent({
    entityType: auditEntityTypes.appeal,
    entityId: input.appealId,
    action: result.delivered
      ? auditActions.certification.participantNotificationSent
      : auditActions.certification.participantNotificationFailed,
    metadata: {
      submissionId: input.submissionId,
      recipientUserId: input.recipientUserId,
      previousStatus: input.previousStatus,
      currentStatus: input.currentStatus,
      channel: result.channel,
      subject: result.subject,
      delivered: result.delivered,
      failureReason: result.failureReason ?? null,
    },
  });
}

// #684: notify a participant that their class was assigned a course. Reuses the same channel
// dispatch (disabled/log/acs_email) as other participant notifications. Webhook is treated as a
// log for this notification type. Norwegian copy (primary locale).
//
// #688: the email contains NO link. Company policy forbids emails with links (phishing / spoofing
// risk) — the participant is told to log in to the platform themselves.
export interface CourseAssignmentNotificationInput {
  recipientEmail: string;
  recipientName?: string | null;
  // #970: kurstittelen skal alt være valgt for MOTTAKERENS språk — samme språk som `locale`.
  courseTitle: string;
  className: string;
  dueAt?: Date | null;
  locale: SupportedLocale;
}

export async function sendCourseAssignmentNotification(
  input: CourseAssignmentNotificationInput,
): Promise<NotificationResult> {
  // #970: var hardkodet bokmål — den eneste e-posten uten språk. Nå fra samme tabell som resten.
  const message = getCourseAssignmentNotificationMessage(input.locale, {
    courseTitle: input.courseTitle,
    className: input.className,
    dueAt: input.dueAt ?? null,
  });
  const subject = message.subject;
  const body = message.nextStepGuidance;

  const payload = {
    notificationType: "class_course_assignment",
    courseTitle: input.courseTitle,
    className: input.className,
    recipient: { email: input.recipientEmail, name: input.recipientName ?? null },
    subject,
    emittedAt: new Date().toISOString(),
  };

  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  if (channel === "disabled") {
    return { delivered: false, channel, subject, nextStepGuidance: body, failureReason: "channel_disabled" };
  }
  if (channel === "acs_email") {
    return sendViaAcs({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? undefined,
      subject,
      body,
      logPayload: payload,
    });
  }
  // log channel (and webhook → log for this notification type).
  logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...payload });
  return { delivered: true, channel, subject, nextStepGuidance: body };
}

// #495/T-QA-5: generisk sender for diskusjons-varsler (nytt spørsmål → kursets SMO; nytt svar →
// trådabonnenter). Subject/body bygges av kalleren (locale-templates i notificationMessages.ts);
// her gjenbrukes samme kanal-dispatch (disabled/log/acs_email; webhook → log) som øvrige varsler.
// Ingen lenker i e-post (#688-policy) — mottakeren bes logge inn selv.
export interface DiscussionNotificationInput {
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  body: string;
  notificationType: "discussion_question_created" | "discussion_reply_created";
}

export async function sendDiscussionNotification(
  input: DiscussionNotificationInput,
): Promise<NotificationResult> {
  const { subject, body } = input;
  const payload = {
    notificationType: input.notificationType,
    recipient: { email: input.recipientEmail, name: input.recipientName ?? null },
    subject,
    emittedAt: new Date().toISOString(),
  };

  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  if (channel === "disabled") {
    return { delivered: false, channel, subject, nextStepGuidance: body, failureReason: "channel_disabled" };
  }
  if (channel === "acs_email") {
    return sendViaAcs({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? undefined,
      subject,
      body,
      logPayload: payload,
    });
  }
  logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...payload });
  return { delivered: true, channel, subject, nextStepGuidance: body };
}
