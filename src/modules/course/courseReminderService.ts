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
import { classRepository } from "./classRepository.js";
import { findActiveParticipants } from "../../repositories/userRepository.js";

// #497: automatiske kurs-frist-påminnelser (Epic #478, siste «Done når»-pilar). Klon av
// recert-påminnelses-mønsteret (recertificationService.ts): audit-basert dedup gjør re-kjøring
// idempotent og restart-trygg. Dekker to kilder til kurs-frister:
//   1. INDIVIDUELLE (eksplisitt tildelte) CourseEnrollment.dueAt.
//   2. KLASSE-tildelte CourseGroupAssignment.dueAt (fase 2), ekspandert til medlemmer — MANUAL-
//      klasser (ClassMember-rader) + system-klassen «Alle deltakere» (alle aktive deltakere).
//      ENTRA-klasser kan ikke oppløses i en bakgrunnsjobb (ingen token/lagrede medlemskanter) og
//      hoppes over, på samme måte som tildelings-e-posten (classService).
// Per (bruker, kurs) beregnes ÉN effektiv frist: individuell frist vinner over klasse; ved flere
// klasse-frister vinner den tidligste. Slik unngås dobbel-varsling. Ingen per-bruker locale finnes
// ennå → org-default (nb), samme som diskusjonsvarsler.

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
  skippedEntraClass: number;
};

// En effektiv frist-kandidat per (bruker, kurs) etter sammenslåing av individuelle + klasse-kilder.
type ReminderCandidate = {
  userId: string;
  courseId: string;
  dueAt: Date;
  recipientEmail: string;
  recipientName: string | null;
  courseTitle: string; // lokalisert
  activeStatus: boolean;
  isAnonymized: boolean;
  source: "individual" | "class";
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

function localizeTitle(title: string): string {
  return localizeContentText(NOTIFY_LOCALE, title) ?? title ?? "";
}

// Samler individuelle + klasse-tildelte frister til ÉN effektiv kandidat per (bruker, kurs).
// Presedens: individuell frist vinner over klasse; ved flere klasse-frister vinner den tidligste.
async function gatherCandidates(summary: CourseReminderScheduleSummary): Promise<ReminderCandidate[]> {
  const map = new Map<string, ReminderCandidate>();
  const keyOf = (userId: string, courseId: string) => `${userId}::${courseId}`;

  // 1. Individuelle (eksplisitt tildelte) enrollments med frist.
  const enrollments = await enrollmentRepository.findIndividualEnrollmentsWithDueDate();
  for (const enrollment of enrollments) {
    if (!enrollment.dueAt) continue;
    map.set(keyOf(enrollment.userId, enrollment.courseId), {
      userId: enrollment.userId,
      courseId: enrollment.courseId,
      dueAt: enrollment.dueAt,
      recipientEmail: enrollment.user.email,
      recipientName: enrollment.user.name,
      courseTitle: localizeTitle(enrollment.course.title),
      activeStatus: enrollment.user.activeStatus,
      isAnonymized: enrollment.user.isAnonymized,
      source: "individual",
    });
  }

  // 2. Klasse-tildelte frister → ekspander til medlemmer. MANUAL = ClassMember-rader;
  //    system-klassen «Alle deltakere» = alle aktive deltakere (ingen rader). ENTRA hoppes over.
  const assignments = await classRepository.findCourseGroupAssignmentsWithDueDate();
  let allParticipants: Array<{ id: string; name: string; email: string }> | null = null;

  for (const assignment of assignments) {
    if (!assignment.dueAt) continue;
    if (assignment.class.kind === "ENTRA") {
      summary.skippedEntraClass += 1;
      continue;
    }

    const members: Array<{
      id: string;
      name: string;
      email: string;
      activeStatus: boolean;
      isAnonymized: boolean;
    }> = assignment.class.isSystem
      ? (allParticipants ??= await findActiveParticipants()).map((u) => ({
          ...u,
          activeStatus: true,
          isAnonymized: false,
        }))
      : assignment.class.members.map((m) => m.user);

    const courseTitle = localizeTitle(assignment.course.title);
    for (const user of members) {
      const key = keyOf(user.id, assignment.courseId);
      const existing = map.get(key);
      if (existing) {
        // Individuell frist vinner; ellers behold tidligste klasse-frist.
        if (existing.source === "class" && assignment.dueAt < existing.dueAt) {
          existing.dueAt = assignment.dueAt;
        }
        continue;
      }
      map.set(key, {
        userId: user.id,
        courseId: assignment.courseId,
        dueAt: assignment.dueAt,
        recipientEmail: user.email,
        recipientName: user.name,
        courseTitle,
        activeStatus: user.activeStatus,
        isAnonymized: user.isAnonymized,
        source: "class",
      });
    }
  }

  return Array.from(map.values());
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
    skippedEntraClass: 0,
  };

  const candidates = await gatherCandidates(summary);

  for (const candidate of candidates) {
    if (!candidate.activeStatus || candidate.isAnonymized) {
      summary.skippedInactive += 1;
      continue;
    }

    const status = await deriveStatus(candidate.userId, candidate.courseId, candidate.dueAt, asOf);
    if (status === "COMPLETED") {
      summary.skippedCompleted += 1;
      continue;
    }

    // Bestem type: forfalt (dueAt < i dag) → overdue, ellers sjekk due_soon-offsets.
    let kind: CourseReminderKind | null = null;
    let daysBefore: number | undefined;

    if (dueDateIsBefore(candidate.dueAt, asOf)) {
      kind = "overdue";
    } else {
      const matched = reminderDaysBefore.find((d) => sameUtcDate(addDays(asOf, d), candidate.dueAt));
      if (matched != null) {
        kind = "due_soon";
        daysBefore = matched;
      }
    }

    if (kind == null) {
      summary.skippedNoTrigger += 1;
      continue;
    }

    const userId = candidate.userId;
    const alreadySent = await hasReminderBeenSent(candidate.courseId, (metadataJson) => {
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

    const result = await send({
      courseId: candidate.courseId,
      userId,
      recipientEmail: candidate.recipientEmail,
      recipientName: candidate.recipientName,
      courseTitle: candidate.courseTitle,
      kind,
      dueAt: candidate.dueAt,
      daysBefore,
    });

    await recordAuditEvent({
      entityType: auditEntityTypes.course,
      entityId: candidate.courseId,
      action: result.delivered ? auditActions.course.reminderSent : auditActions.course.reminderFailed,
      actorId: undefined,
      metadata: {
        courseId: candidate.courseId,
        userId,
        kind,
        ...(daysBefore != null ? { daysBefore } : {}),
        asOfDate,
        dueAt: candidate.dueAt.toISOString(),
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
