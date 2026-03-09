import type { AppealStatus } from "@prisma/client";
import { env } from "../config/env.js";
import type { SupportedLocale } from "../i18n/locale.js";
import { getAppealNotificationMessage } from "../i18n/notificationMessages.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { recordAuditEvent } from "./auditService.js";

type NotificationChannel = "disabled" | "log" | "webhook";

export type AppealNotificationInput = {
  appealId: string;
  submissionId: string;
  previousStatus: AppealStatus | null;
  currentStatus: AppealStatus;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string | null;
  locale: SupportedLocale;
};

type NotificationResult = {
  delivered: boolean;
  channel: NotificationChannel;
  subject: string;
  nextStepGuidance: string;
  failureReason?: string;
};

export async function sendAppealStatusNotification(input: AppealNotificationInput): Promise<NotificationResult> {
  const message = getAppealNotificationMessage(input.locale, input.currentStatus);
  const payload = {
    notificationType: "appeal_status_transition",
    appealId: input.appealId,
    submissionId: input.submissionId,
    previousStatus: input.previousStatus,
    currentStatus: input.currentStatus,
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
    logOperationalEvent("participant_notification_sent", {
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

  const webhookUrl = env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    logOperationalEvent(
      "participant_notification_failed",
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
        "participant_notification_failed",
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

    logOperationalEvent("participant_notification_sent", {
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
      "participant_notification_failed",
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

export async function notifyAppealStatusTransition(input: AppealNotificationInput) {
  const result = await sendAppealStatusNotification(input);

  await recordAuditEvent({
    entityType: "appeal",
    entityId: input.appealId,
    action: result.delivered ? "participant_notification_sent" : "participant_notification_failed",
    metadata: {
      submissionId: input.submissionId,
      recipientUserId: input.recipientUserId,
      recipientEmail: input.recipientEmail,
      previousStatus: input.previousStatus,
      currentStatus: input.currentStatus,
      channel: result.channel,
      subject: result.subject,
      nextStepGuidance: result.nextStepGuidance,
      delivered: result.delivered,
      failureReason: result.failureReason ?? null,
    },
  });
}
