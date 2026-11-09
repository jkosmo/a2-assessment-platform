import { EmailClient, type EmailMessage } from "@azure/communication-email";
import type { AppealStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { ExternalCallTimeoutError, withTimeout } from "../../clients/externalCall.js";
import { classifyAcsError, describeAcsFailure, nextAttemptDelayMs } from "./acsThrottle.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { localizeContentText } from "../../i18n/content.js";
import {
  getAppealNotificationMessage,
  getAssessmentResultNotificationMessage,
  getCourseAssignmentDigestMessage,
  getCourseAssignmentNotificationMessage,
  getCourseMajorVersionNotificationMessage,
  getEmailReason,
  getModuleRevisedNotificationMessage,
  type EmailReason,
} from "../../i18n/notificationMessages.js";
import { logOperationalEvent } from "../../observability/operationalLog.js";
import { auditActions, auditEntityTypes } from "../../observability/auditEvents.js";
import { operationalEvents } from "../../observability/operationalEvents.js";
import { recordAuditEvent } from "../../services/auditService.js";
import { EMAIL_ILLUSTRATIONS, renderIllustratedEmail, type EmailIllustration, type EmailLink, type IllustratedEmail, type InlineImageAttachment } from "./illustratedEmail.js";
import { buildEmailLink } from "./emailLinks.js";

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
  /** Lenken i e-posten. Mangler i rader lagt i køen før lenkene: da går e-posten uten. */
  moduleId?: string;
  locale: SupportedLocale;
  passFailTotal?: boolean;
  resolutionNote?: string;
};

export type NotificationResult = {
  delivered: boolean;
  channel: NotificationChannel;
  subject: string;
  nextStepGuidance: string;
  failureReason?: string;
  /**
   * #1115: the send was cut off while it was under way (our timeout), so it may have gone through.
   * A failure that is certain (a rejection, a missing address) can be tried again; this one cannot,
   * or the participant may get the email twice. The outbox marks it failed, visibly, and does not retry.
   */
  ambiguous?: boolean;
};

/** A request we stopped waiting for: it may have reached the receiver. */
export const isCutOff = (error: unknown) => error instanceof ExternalCallTimeoutError || (error instanceof Error && error.name === "AbortError");

/** En e-post av teksten fra notificationMessages.ts: `nextStepGuidance` er avsnitt skilt med en tom linje. */
export function buildNotificationEmail(input: {
  locale: SupportedLocale;
  message: { subject: string; nextStepGuidance: string };
  reason: EmailReason;
  illustration: EmailIllustration;
  link: EmailLink | null;
}): IllustratedEmail {
  return renderIllustratedEmail({
    locale: input.locale,
    subject: input.message.subject,
    paragraphs: input.message.nextStepGuidance.split("\n\n"),
    reason: getEmailReason(input.locale, input.reason),
    illustration: input.illustration,
    link: input.link,
  });
}

export async function sendAppealStatusNotification(input: AppealNotificationInput): Promise<NotificationResult> {
  const resolution =
    input.currentStatus === "RESOLVED" && input.passFailTotal !== undefined && input.resolutionNote !== undefined
      ? { passFailTotal: input.passFailTotal, resolutionNote: input.resolutionNote }
      : undefined;
  const message = getAppealNotificationMessage(input.locale, input.currentStatus, { moduleTitle: input.moduleTitle, resolution });
  return deliverIllustratedEmail({
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    email: buildNotificationEmail({
      locale: input.locale,
      message,
      reason: "appeal",
      illustration: EMAIL_ILLUSTRATIONS.appeal,
      link: buildEmailLink(input.locale, "module", input.moduleId ? { moduleId: input.moduleId } : null),
    }),
    logPayload: {
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
      nextStepGuidance: message.nextStepGuidance,
    },
  });
}

export async function sendViaAcs(input: {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  body: string;
  logPayload: { channel?: string } & Record<string, unknown>;
  // #934 skive 4b (felles med #1139, #1141): HTML ved siden av den rene teksten, med bildene som innebygde vedlegg
  // (CID). Lages av `renderIllustratedEmail` (illustratedEmail.ts). Uten: ren tekst, som før.
  html?: string;
  attachments?: InlineImageAttachment[];
}): Promise<NotificationResult> {
  const connectionString = env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING!;
  // ACS senderAddress must be a plain email address — display name is set at domain level in Azure.
  const senderAddress = env.ACS_EMAIL_SENDER!;

  const emailClient = new EmailClient(connectionString);
  const message: EmailMessage = {
    senderAddress,
    content: input.html ? { subject: input.subject, plainText: input.body, html: input.html } : { subject: input.subject, plainText: input.body },
    recipients: {
      to: [{ address: input.recipientEmail, displayName: input.recipientName }],
    },
    // #1139: ingen sporing av hvem som åpner e-posten. Med sporing slått på i ACS legger tjenesten inn en
    // sporingspiksel (en nettadresse) i HTML-en — det ville brutt både personvernet og lenkeforbudet.
    ...(input.html ? { disableUserEngagementTracking: true } : {}),
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
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
    return { delivered: false, channel: "acs_email", subject: input.subject, nextStepGuidance: input.body, failureReason, ambiguous: isCutOff(error) };
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

type AssessmentOutcome = "pass" | "fail" | "under_review";

const ASSESSMENT_ILLUSTRATION: Record<AssessmentOutcome, EmailIllustration> = {
  pass: EMAIL_ILLUSTRATIONS.passed,
  fail: EMAIL_ILLUSTRATIONS.notPassed,
  under_review: EMAIL_ILLUSTRATIONS.underReview,
};

/**
 * Sender e-posten om en vurdering og fører den i revisjonsloggen. #1115: gir tilbake hva som skjedde — null når kanalen ikke
 * sender noe (av, logg) — så outboxen skiller en feilet sending fra en levert.
 */
async function sendAssessmentEmail(input: Omit<AssessmentResultNotificationInput, "passFailTotal">, outcome: AssessmentOutcome, notificationType: string): Promise<NotificationResult | null> {
  const message = getAssessmentResultNotificationMessage(input.locale, outcome, {
    moduleTitle: input.moduleTitle,
    submittedAt: input.submittedAt,
  });
  const result = await deliverIllustratedEmail({
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    email: buildNotificationEmail({
      locale: input.locale,
      message,
      reason: "submission",
      illustration: ASSESSMENT_ILLUSTRATION[outcome],
      link: buildEmailLink(input.locale, "module", { moduleId: input.moduleId }),
    }),
    logPayload: {
      notificationType,
      submissionId: input.submissionId,
      moduleId: input.moduleId,
      moduleTitle: input.moduleTitle,
      outcome,
      recipient: { email: input.recipientEmail, locale: input.locale },
    },
  });
  if (result.channel === "disabled" || result.channel === "log") return null;

  await recordAuditEvent({
    entityType: auditEntityTypes.submission,
    entityId: input.submissionId,
    action: result.delivered
      ? auditActions.certification.participantNotificationSent
      : auditActions.certification.participantNotificationFailed,
    metadata: {
      notificationType,
      moduleId: input.moduleId,
      outcome,
      channel: result.channel,
      subject: result.subject,
      delivered: result.delivered,
      failureReason: result.failureReason ?? null,
    },
  });
  return result;
}

export function notifyAssessmentResult(input: AssessmentResultNotificationInput): Promise<NotificationResult | null> {
  return sendAssessmentEmail(input, input.passFailTotal ? "pass" : "fail", "assessment_result");
}

/** Svaret har gått til en sensor. Resultatet kommer i egen e-post når gjennomgangen er ferdig. */
export function notifyAssessmentUnderReview(input: Omit<AssessmentResultNotificationInput, "passFailTotal">): Promise<NotificationResult | null> {
  return sendAssessmentEmail(input, "under_review", "assessment_under_review");
}

/** Sends the appeal notification and records it; returns what happened (#1115). */
export async function notifyAppealStatusTransition(input: AppealNotificationInput): Promise<NotificationResult> {
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
  return result;
}

// #684: e-post til deltakeren når klassen får tildelt et kurs. Sendes bare for publiserte kurs (classService).
export interface CourseAssignmentNotificationInput {
  recipientEmail: string;
  recipientName?: string | null;
  // #970: kurstittelen skal alt være valgt for MOTTAKERENS språk — samme språk som `locale`.
  courseTitle: string;
  className: string;
  dueAt?: Date | null;
  locale: SupportedLocale;
  courseId: string;
}

export async function sendCourseAssignmentNotification(
  input: CourseAssignmentNotificationInput,
): Promise<NotificationResult> {
  // #970: var hardkodet bokmål — den eneste e-posten uten språkparameter. Nå fra samme tabell som resten.
  const message = getCourseAssignmentNotificationMessage(input.locale, {
    courseTitle: input.courseTitle,
    className: input.className,
    dueAt: input.dueAt ?? null,
  });
  return deliverIllustratedEmail({
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    email: buildNotificationEmail({
      locale: input.locale,
      message,
      reason: "assignment",
      illustration: EMAIL_ILLUSTRATIONS.courseAssigned,
      link: buildEmailLink(input.locale, "course", { courseId: input.courseId }),
    }),
    logPayload: {
      notificationType: "class_course_assignment",
      courseId: input.courseId,
      courseTitle: input.courseTitle,
      className: input.className,
      recipient: { email: input.recipientEmail, name: input.recipientName ?? null },
    },
  });
}

// #997: modulen deltakeren besto er revidert, og den tidligere beståtten teller ikke lenger. Ren tekst, utenfor malen med vilje
// (#1141): bryteren for beståtte per kurs stopper alle nye. Denne sender bare det som alt ligger i køen.
export interface ModuleRevisedNotificationInput {
  recipientEmail: string;
  recipientName?: string | null;
  /** Tittelen valgt for mottakerens språk av kalleren — samme språk som `locale`. */
  moduleTitle: string;
  /** Kursene beståtten gjaldt, på mottakerens språk. Tom: varselet nevner ikke noe kurs. */
  courseTitles?: string[];
  moduleId: string;
  moduleVersionId: string;
  locale: SupportedLocale;
}

export async function sendModuleRevisedNotification(
  input: ModuleRevisedNotificationInput,
): Promise<NotificationResult> {
  const message = getModuleRevisedNotificationMessage(input.locale, { moduleTitle: input.moduleTitle, courseTitles: input.courseTitles ?? [] });
  const payload = {
    notificationType: "module_revised",
    moduleId: input.moduleId,
    moduleVersionId: input.moduleVersionId,
    moduleTitle: input.moduleTitle,
    recipient: { email: input.recipientEmail, locale: input.locale },
    subject: message.subject,
    emittedAt: new Date().toISOString(),
  };

  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  if (channel === "disabled") {
    return { delivered: false, channel, subject: message.subject, nextStepGuidance: message.nextStepGuidance, failureReason: "channel_disabled" };
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
  logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...payload });
  return { delivered: true, channel, subject: message.subject, nextStepGuidance: message.nextStepGuidance };
}

// #934 skive 4b (felles med #1139, #1141): sender en e-post laget med den felles malen (`renderIllustratedEmail`).
// E-post (ACS) får HTML med bildet som innebygd vedlegg og ren tekst ved siden av; `log` og `webhook` får den rene
// teksten. Gir tilbake hva som skjedde (#1115), så kalleren skiller en sikker feil (prøv igjen) fra en som ble
// avbrutt underveis og kan ha gått (`ambiguous`: send ikke på nytt).
export async function deliverIllustratedEmail(input: {
  recipientEmail: string;
  recipientName?: string | null;
  email: IllustratedEmail;
  logPayload: Record<string, unknown>;
}): Promise<NotificationResult> {
  const { email } = input;
  const channel = env.PARTICIPANT_NOTIFICATION_CHANNEL;
  const logPayload = { ...input.logPayload, subject: email.subject, emittedAt: new Date().toISOString() };
  const outcome = (delivered: boolean, extra: Partial<NotificationResult> = {}): NotificationResult => ({
    delivered,
    channel,
    subject: email.subject,
    nextStepGuidance: email.plainText,
    ...extra,
  });

  if (channel === "disabled") return outcome(false, { failureReason: "channel_disabled" });
  if (channel === "log") {
    logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...logPayload });
    return outcome(true);
  }
  if (channel === "acs_email") {
    return sendViaAcs({
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName ?? undefined,
      subject: email.subject,
      body: email.plainText,
      html: email.html,
      attachments: email.attachments,
      logPayload,
    });
  }

  const webhookUrl = env.PARTICIPANT_NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    logOperationalEvent(operationalEvents.certification.participantNotificationFailed, { channel, ...logPayload, failureReason: "missing_webhook_url" }, "error");
    return outcome(false, { failureReason: "missing_webhook_url" });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...logPayload, body: email.plainText }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const failureReason = `webhook_non_2xx_${response.status}`;
      logOperationalEvent(operationalEvents.certification.participantNotificationFailed, { channel, ...logPayload, failureReason }, "error");
      return outcome(false, { failureReason });
    }
    logOperationalEvent(operationalEvents.certification.participantNotificationSent, { channel, ...logPayload });
    return outcome(true);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "webhook_send_failed";
    logOperationalEvent(operationalEvents.certification.participantNotificationFailed, { channel, ...logPayload, failureReason }, "error");
    return outcome(false, { failureReason, ambiguous: isCutOff(error) });
  } finally {
    clearTimeout(timeout);
  }
}

// #934 skive 4b: kurset har fått en ny hovedversjon. Teksten på MOTTAKERENS språk (#970), med båten på verftet.
// Sendes av behandleren i outboxen (courseMajorVersionEmail.ts), som eier reglene for hvem og når.
export interface CourseMajorVersionNotificationInput {
  noticeId: string;
  courseId: string;
  recipientEmail: string;
  recipientName?: string | null;
  /** Kurstittelen valgt for mottakerens språk — samme språk som `locale`. */
  courseTitle: string;
  versionMajor: number;
  changedItemCount: number | null;
  locale: SupportedLocale;
}

/** Selve e-posten, uten å sende den. Eksportert for enhetstesten av teksten. */
export function buildCourseMajorVersionEmail(input: Pick<CourseMajorVersionNotificationInput, "courseTitle" | "versionMajor" | "changedItemCount" | "locale"> & { courseId?: string }): IllustratedEmail {
  const message = getCourseMajorVersionNotificationMessage(input.locale, input);
  return renderIllustratedEmail({
    locale: input.locale,
    subject: message.subject,
    paragraphs: message.paragraphs,
    reason: message.reason,
    illustration: EMAIL_ILLUSTRATIONS.courseNewVersion,
    link: buildEmailLink(input.locale, "course", input.courseId ? { courseId: input.courseId } : null),
  });
}

// #1142 skive 2: ÉN e-post når en deltaker har fått nye kurs, med alle kursene i en liste (doc/design/PLAN_1142.md,
// punkt 5). Bare selve e-posten: behandleren i outboxen som slår opp kursene og sender den, kommer i skive 3. Til da
// sendes den gamle e-posten per kurs (`sendCourseAssignmentNotification`).
export type CourseAssignmentDigestCourseInput = {
  /** Tittelen slik den er lagret (JSON med språkene, eller ren tekst). Velges for mottakerens språk her. */
  title: string;
  /** Klassene personen har kurset fra. */
  classNames: string[];
  /** Den tidligste fristen blant klassene, eller null. */
  dueAt: Date | null;
};

/** Selve e-posten, uten å sende den. Lenken går til «Mine kurs» uten id, siden e-posten kan nevne flere kurs. */
export function buildCourseAssignmentDigestEmail(input: { locale: SupportedLocale; courses: CourseAssignmentDigestCourseInput[] }): IllustratedEmail {
  const courses = input.courses.map((course) => ({ ...course, title: localizeContentText(input.locale, course.title) ?? course.title }));
  const message = getCourseAssignmentDigestMessage(input.locale, courses);
  return renderIllustratedEmail({
    locale: input.locale,
    subject: message.subject,
    paragraphs: message.paragraphs,
    reason: getEmailReason(input.locale, "classMember"),
    illustration: EMAIL_ILLUSTRATIONS.courseAssigned,
    link: buildEmailLink(input.locale, "myCourses", { page: "myCourses" }),
  });
}

export async function sendCourseMajorVersionNotification(input: CourseMajorVersionNotificationInput): Promise<NotificationResult> {
  return deliverIllustratedEmail({
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    email: buildCourseMajorVersionEmail(input),
    logPayload: {
      notificationType: "course_major_version",
      noticeId: input.noticeId,
      courseId: input.courseId,
      versionMajor: input.versionMajor,
      recipient: { email: input.recipientEmail, locale: input.locale },
    },
  });
}

// #495/T-QA-5: e-post om diskusjoner (nytt spørsmål → kursets eiere; nytt svar → dem som følger tråden). Emne og tekst bygges av
// kalleren (notificationMessages.ts). Lenken åpner tråden på deltakersiden.
export interface DiscussionNotificationInput {
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  body: string;
  notificationType: "discussion_question_created" | "discussion_reply_created";
  locale: SupportedLocale;
  courseId: string;
  threadId: string;
}

export function sendDiscussionNotification(input: DiscussionNotificationInput): Promise<NotificationResult> {
  return deliverIllustratedEmail({
    recipientEmail: input.recipientEmail,
    recipientName: input.recipientName,
    email: buildNotificationEmail({
      locale: input.locale,
      message: { subject: input.subject, nextStepGuidance: input.body },
      reason: input.notificationType === "discussion_question_created" ? "discussionQuestion" : "discussionReply",
      illustration: EMAIL_ILLUSTRATIONS.discussion,
      link: buildEmailLink(input.locale, "discussion", { courseId: input.courseId, threadId: input.threadId }),
    }),
    logPayload: {
      notificationType: input.notificationType,
      courseId: input.courseId,
      threadId: input.threadId,
      recipient: { email: input.recipientEmail, name: input.recipientName ?? null },
    },
  });
}
