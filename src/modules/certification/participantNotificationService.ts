import { EmailClient } from "@azure/communication-email";
import type { AppealStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { getAppealNotificationMessage, getAssessmentResultNotificationMessage } from "../../i18n/notificationMessages.js";
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
    const poller = await emailClient.beginSend(message);
    const result = await poller.pollUntilDone();

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
    const failureReason = error instanceof Error ? error.message : "acs_send_failed";
    logOperationalEvent(
      operationalEvents.certification.participantNotificationFailed,
      { channel: "acs_email", ...input.logPayload, failureReason },
      "error",
    );
    return { delivered: false, channel: "acs_email", subject: input.subject, nextStepGuidance: input.body, failureReason };
  }
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
