import { env } from "../../config/env.js";
import { getAssessmentRules } from "../../config/assessmentRules.js";
import { localizeContentText } from "../../i18n/content.js";
import {
  getCourseReminderNotificationMessage,
  type CourseReminderKind,
} from "../../i18n/notificationMessages.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { auditRepository } from "../../repositories/auditRepository.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { sendViaAcs } from "../certification/participantNotificationService.js";
import { deriveStatus } from "./enrollmentService.js";
import { enrollmentRepository } from "./enrollmentRepository.js";

// #497: automatiske kurs-frist-påminnelser (Epic #478, siste «Done når»-pilar). Klon av
// recert-påminnelses-mønsteret (recertificationService.ts): audit-basert dedup gjør re-kjøring
// idempotent og restart-trygg. v1 dekker INDIVIDUELLE (eksplisitt tildelte) CourseEnrollment.dueAt;
// klasse-tildelte frister er fase 2. Ingen per-bruker locale finnes ennå → org-default (nb),
// samme som diskusjonsvarsler.

const NOTIFY_LOCALE = "nb" as const;
const NOTIFICATION_TYPE = "course_reminder";

type ReminderChannel = "disabled" | "log" | "webhook" | "acs_email";

export type CourseReminderSendInput = {
  courseId: string;
  userId: string;
  recipientEmail: string;
  recipientName: string | null;
  courseTitle: string;
  kind: CourseReminderKind;
  dueAt: Date;
  daysBefore?: number;
};

export type CourseReminderSendResult = {
  delivered: boolean;
  channel: ReminderChannel;
  failureReason?: string;
};

export type CourseReminderSendImpl = (input: CourseReminderSendInput) => Promise<CourseReminderSendResult>;

export type CourseReminderScheduleSummary = {
  asOf: string;
  processed: number;
  sent: number;
  failed: number;
  skippedAlreadySent: number;
  skippedNoTrigger: number;
  skippedCompleted: number;
  skippedInactive: number;
};

async function defaultSendCourseReminder(input: CourseReminderSendInput): Promise<CourseReminderSendResult> {
  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  const message = getCourseReminderNotificationMessage(NOTIFY_LOCALE, input.kind, {
    courseTitle: input.courseTitle,
    dueAt: input.dueAt,
    daysBefore: input.daysBefore,
  });
  const logPayload = {
    notificationType: NOTIFICATION_TYPE,
    courseId: input.courseId,
    userId: input.userId,
    recipientEmail: input.recipientEmail,
    kind: input.kind,
    dueAt: input.dueAt.toISOString(),
    daysBefore: input.daysBefore ?? null,
    emittedAt: new Date().toISOString(),
  };

  if (channel === "disabled") {
    return { delivered: false, channel, failureReason: "channel_disabled" };
  }

  if (channel === "log") {
    logOperationalEvent(operationalEvents.certification.participantNotificationSent, {
      channel,
      ...logPayload,
    });
    return { delivered: true, channel };
  }

  if (channel === "acs_email") {
    const result = await sendViaAcs({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? undefined,
      subject: message.subject,
      body: message.nextStepGuidance,
      logPayload: { channel, ...logPayload },
    });
    return { delivered: result.delivered, channel, failureReason: result.failureReason };
  }

  // webhook
  const webhookUrl = env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    logOperationalEvent(
      operationalEvents.certification.participantNotificationFailed,
      { channel, ...logPayload, failureReason: "missing_webhook_url" },
      "error",
    );
    return { delivered: false, channel, failureReason: "missing_webhook_url" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...logPayload, subject: message.subject, body: message.nextStepGuidance }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const failureReason = `webhook_non_2xx_${response.status}`;
      logOperationalEvent(
        operationalEvents.certification.participantNotificationFailed,
        { channel, ...logPayload, failureReason },
        "error",
      );
      return { delivered: false, channel, failureReason };
    }
    logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...logPayload });
    return { delivered: true, channel };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "webhook_send_failed";
    logOperationalEvent(
      operationalEvents.certification.participantNotificationFailed,
      { channel, ...logPayload, failureReason },
      "error",
    );
    return { delivered: false, channel, failureReason };
  } finally {
    clearTimeout(timeout);
  }
}

// Audit-basert dedup: en påminnelse er allerede sendt hvis det finnes en `course_reminder_sent`-rad
// på kurset som matcher denne mottakeren + typen. due_soon dedup-er per (userId, daysBefore, asOfDate);
// overdue dedup-er per (userId) — v1 sender forfalt-purring kun én gang.
async function hasReminderBeenSent(
  courseId: string,
  predicate: (metadataJson: string) => boolean,
): Promise<boolean> {
  const existing = await auditRepository.findAuditEventMetadataByEntityAndAction(
    auditEntityTypes.course,
    courseId,
    auditActions.course.reminderSent,
  );
  return existing.some((event) => predicate(event.metadataJson));
}

function addDays(input: Date, days: number): Date {
  const result = new Date(input);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function sameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

// Er dueAt-datoen (UTC) strengt før asOf-datoen (UTC)? Brukes for overdue-deteksjon uavhengig av
// klokkeslett — en frist «i går» er forfalt selv om asOf er tidlig på dagen.
function dueDateIsBefore(dueAt: Date, asOf: Date): boolean {
  const due = Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), dueAt.getUTCDate());
  const now = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return due < now;
}

export async function runCourseReminderSchedule(input?: {
  asOf?: Date;
  sendImpl?: CourseReminderSendImpl;
}): Promise<CourseReminderScheduleSummary> {
  const asOf = input?.asOf ?? new Date();
  const send = input?.sendImpl ?? defaultSendCourseReminder;
  const asOfDate = asOf.toISOString().slice(0, 10);

  const reminderDaysBefore = Array.from(new Set(getAssessmentRules().courseReminders.reminderDaysBefore))
    .filter((value) => value >= 0)
    .sort((a, b) => b - a);

  const summary: CourseReminderScheduleSummary = {
    asOf: asOf.toISOString(),
    processed: 0,
    sent: 0,
    failed: 0,
    skippedAlreadySent: 0,
    skippedNoTrigger: 0,
    skippedCompleted: 0,
    skippedInactive: 0,
  };

  const enrollments = await enrollmentRepository.findIndividualEnrollmentsWithDueDate();

  for (const enrollment of enrollments) {
    const dueAt = enrollment.dueAt;
    if (!dueAt) {
      summary.skippedNoTrigger += 1;
      continue;
    }
    if (!enrollment.user.activeStatus || enrollment.user.isAnonymized) {
      summary.skippedInactive += 1;
      continue;
    }

    const status = await deriveStatus(enrollment.userId, enrollment.courseId, dueAt, asOf);
    if (status === "COMPLETED") {
      summary.skippedCompleted += 1;
      continue;
    }

    // Bestem type: forfalt (dueAt < i dag) → overdue, ellers sjekk due_soon-offsets.
    let kind: CourseReminderKind | null = null;
    let daysBefore: number | undefined;

    if (dueDateIsBefore(dueAt, asOf)) {
      kind = "overdue";
    } else {
      const matched = reminderDaysBefore.find((d) => sameUtcDate(addDays(asOf, d), dueAt));
      if (matched != null) {
        kind = "due_soon";
        daysBefore = matched;
      }
    }

    if (kind == null) {
      summary.skippedNoTrigger += 1;
      continue;
    }

    const userId = enrollment.userId;
    const alreadySent = await hasReminderBeenSent(enrollment.courseId, (metadataJson) => {
      if (!metadataJson.includes(`"userId":"${userId}"`)) return false;
      if (kind === "overdue") {
        return metadataJson.includes('"kind":"overdue"');
      }
      return (
        metadataJson.includes('"kind":"due_soon"') &&
        metadataJson.includes(`"daysBefore":${daysBefore}`) &&
        metadataJson.includes(`"asOfDate":"${asOfDate}"`)
      );
    });
    if (alreadySent) {
      summary.skippedAlreadySent += 1;
      continue;
    }

    summary.processed += 1;

    const courseTitle =
      localizeContentText(NOTIFY_LOCALE, enrollment.course.title) ?? enrollment.course.title ?? "";

    const result = await send({
      courseId: enrollment.courseId,
      userId,
      recipientEmail: enrollment.user.email,
      recipientName: enrollment.user.name,
      courseTitle,
      kind,
      dueAt,
      daysBefore,
    });

    await recordAuditEvent({
      entityType: auditEntityTypes.course,
      entityId: enrollment.courseId,
      action: result.delivered ? auditActions.course.reminderSent : auditActions.course.reminderFailed,
      actorId: undefined,
      metadata: {
        courseId: enrollment.courseId,
        userId,
        kind,
        ...(daysBefore != null ? { daysBefore } : {}),
        asOfDate,
        dueAt: dueAt.toISOString(),
        channel: result.channel,
        delivered: result.delivered,
        failureReason: result.failureReason ?? null,
      },
    });

    if (result.delivered) {
      summary.sent += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}
