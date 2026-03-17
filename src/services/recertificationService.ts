import { env } from "../config/env.js";
import { getAssessmentRules } from "../config/assessmentRules.js";
import { NotFoundError } from "../errors/AppError.js";
import { logOperationalEvent } from "../observability/operationalLog.js";
import { auditRepository } from "../repositories/auditRepository.js";
import { certificationRepository } from "../repositories/certificationRepository.js";
import { decisionRepository } from "../repositories/decisionRepository.js";
import { recordAuditEvent } from "./auditService.js";
import { sendViaAcs } from "./participantNotificationService.js";

export type RecertificationLifecycleStatus = "ACTIVE" | "DUE_SOON" | "DUE" | "EXPIRED" | "NOT_CERTIFIED";

type UpsertFromDecisionInput = {
  decisionId: string;
  actorId?: string | null;
};

type ReminderChannel = "disabled" | "log" | "webhook" | "acs_email";

export async function upsertRecertificationStatusFromDecision(input: UpsertFromDecisionInput) {
  const decision = await decisionRepository.findDecisionWithSubmissionIdentifiers(input.decisionId);

  if (!decision) {
    throw new NotFoundError("Decision", "decision_not_found", "Decision not found.");
  }

  const rules = getAssessmentRules().recertification;
  const userId = decision.submission.userId;
  const moduleId = decision.submission.moduleId;

  let status: RecertificationLifecycleStatus;
  let passedAt: Date | null = null;
  let expiryDate: Date | null = null;
  let recertificationDueDate: Date | null = null;

  if (decision.passFailTotal) {
    passedAt = decision.finalisedAt;
    expiryDate = addDays(passedAt, rules.validityDays);
    recertificationDueDate = addDays(expiryDate, -rules.dueOffsetDays);
    status = deriveRecertificationStatus({
      now: decision.finalisedAt,
      expiryDate,
      recertificationDueDate,
      dueSoonDays: rules.dueSoonDays,
    });
  } else {
    status = "NOT_CERTIFIED";
  }

  const certification = await certificationRepository.upsertCertificationStatus({
    userId,
    moduleId,
    latestDecisionId: decision.id,
    status,
    passedAt,
    expiryDate,
    recertificationDueDate,
  });

  await recordAuditEvent({
    entityType: "certification_status",
    entityId: certification.id,
    action: "recertification_status_upserted",
    actorId: input.actorId ?? undefined,
    metadata: {
      userId,
      moduleId,
      decisionId: decision.id,
      status,
      passedAt: passedAt?.toISOString() ?? null,
      expiryDate: expiryDate?.toISOString() ?? null,
      recertificationDueDate: recertificationDueDate?.toISOString() ?? null,
    },
  });

  return certification;
}

export function deriveRecertificationStatus(input: {
  now: Date;
  expiryDate: Date | null;
  recertificationDueDate: Date | null;
  dueSoonDays: number;
}): RecertificationLifecycleStatus {
  if (!input.expiryDate || !input.recertificationDueDate) {
    return "NOT_CERTIFIED";
  }

  if (input.now.getTime() > input.expiryDate.getTime()) {
    return "EXPIRED";
  }
  if (input.now.getTime() >= input.recertificationDueDate.getTime()) {
    return "DUE";
  }

  const dueSoonThreshold = addDays(input.recertificationDueDate, -input.dueSoonDays);
  if (input.now.getTime() >= dueSoonThreshold.getTime()) {
    return "DUE_SOON";
  }

  return "ACTIVE";
}

export async function runRecertificationReminderSchedule(input?: { asOf?: Date }) {
  const asOf = input?.asOf ?? new Date();
  const rules = getAssessmentRules().recertification;
  const reminderDaysBefore = Array.from(new Set(rules.reminderDaysBefore))
    .filter((value) => value >= 0)
    .sort((a, b) => b - a);

  if (reminderDaysBefore.length === 0) {
    return {
      asOf: asOf.toISOString(),
      processed: 0,
      sent: 0,
      failed: 0,
      skippedAlreadySent: 0,
      skippedNoTrigger: 0,
    };
  }

  const certifications = await certificationRepository.findCertificationsForReminderSchedule();

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skippedAlreadySent = 0;
  let skippedNoTrigger = 0;

  for (const certification of certifications) {
    const expiryDate = certification.expiryDate;
    if (!expiryDate) {
      skippedNoTrigger += 1;
      continue;
    }

    const matchedReminderDay = reminderDaysBefore.find((daysBefore) => {
      const triggerDate = addDays(asOf, daysBefore);
      return sameUtcDate(triggerDate, expiryDate);
    });

    if (matchedReminderDay == null) {
      skippedNoTrigger += 1;
      continue;
    }

    const asOfDate = asOf.toISOString().slice(0, 10);
    const alreadySent = await hasReminderAuditEventForDay(certification.id, matchedReminderDay, asOfDate);
    if (alreadySent) {
      skippedAlreadySent += 1;
      continue;
    }

    processed += 1;

    const result = await sendRecertificationReminder({
      certificationId: certification.id,
      moduleId: certification.module.id,
      moduleTitle: certification.module.title,
      userId: certification.user.id,
      recipientEmail: certification.user.email,
      recipientName: certification.user.name,
      expiryDate,
      reminderDaysBefore: matchedReminderDay,
    });

    await recordAuditEvent({
      entityType: "certification_status",
      entityId: certification.id,
      action: result.delivered ? "recertification_reminder_sent" : "recertification_reminder_failed",
      actorId: undefined,
      metadata: {
        certificationId: certification.id,
        userId: certification.user.id,
        recipientEmail: certification.user.email,
        moduleId: certification.module.id,
        reminderDaysBefore: matchedReminderDay,
        asOfDate,
        expiryDate: expiryDate.toISOString(),
        channel: result.channel,
        delivered: result.delivered,
        failureReason: result.failureReason ?? null,
      },
    });

    if (result.delivered) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return {
    asOf: asOf.toISOString(),
    processed,
    sent,
    failed,
    skippedAlreadySent,
    skippedNoTrigger,
  };
}

async function sendRecertificationReminder(input: {
  certificationId: string;
  userId: string;
  recipientEmail: string;
  recipientName: string | null;
  moduleId: string;
  moduleTitle: string;
  expiryDate: Date;
  reminderDaysBefore: number;
}): Promise<{ delivered: boolean; channel: ReminderChannel; failureReason?: string }> {
  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  const payload = {
    notificationType: "recertification_reminder",
    certificationId: input.certificationId,
    userId: input.userId,
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    moduleId: input.moduleId,
    moduleTitle: input.moduleTitle,
    expiryDate: input.expiryDate.toISOString(),
    reminderDaysBefore: input.reminderDaysBefore,
    emittedAt: new Date().toISOString(),
  };

  if (channel === "disabled") {
    return {
      delivered: false,
      channel,
      failureReason: "channel_disabled",
    };
  }

  if (channel === "log") {
    logOperationalEvent("recertification_reminder_sent", {
      channel,
      ...payload,
    });
    return {
      delivered: true,
      channel,
    };
  }

  if (channel === "acs_email") {
    const result = await sendViaAcs({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? undefined,
      subject: payload.notificationType,
      body: `Recertification reminder: module ${input.moduleTitle} expires on ${input.expiryDate.toISOString().slice(0, 10)}.`,
      logPayload: payload,
    });
    return { delivered: result.delivered, channel, failureReason: result.failureReason };
  }

  const webhookUrl = env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    logOperationalEvent(
      "recertification_reminder_failed",
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
        "recertification_reminder_failed",
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
        failureReason,
      };
    }

    logOperationalEvent("recertification_reminder_sent", {
      channel,
      ...payload,
    });
    return {
      delivered: true,
      channel,
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "webhook_send_failed";
    logOperationalEvent(
      "recertification_reminder_failed",
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
      failureReason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function hasReminderAuditEventForDay(certificationId: string, reminderDaysBefore: number, asOfDate: string) {
  const existing = await auditRepository.findAuditEventMetadataByEntityAndAction(
    "certification_status",
    certificationId,
    "recertification_reminder_sent",
  );
  return existing.some(
    (event) =>
      event.metadataJson.includes(`"reminderDaysBefore":${reminderDaysBefore}`) &&
      event.metadataJson.includes(`"asOfDate":"${asOfDate}"`),
  );
}

function addDays(input: Date, days: number) {
  const result = new Date(input);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function sameUtcDate(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
