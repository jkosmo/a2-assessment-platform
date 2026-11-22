import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { sha256 } from "./mascotFasit.js";
import { env } from "../../src/config/env.js";
import {
  notifyAssessmentResult,
  notifyAssessmentUnderReview,
  sendAppealStatusNotification,
  sendCourseAssignmentDigest,
  sendCourseMajorVersionNotification,
  sendDiscussionNotification,
} from "../../src/modules/certification/participantNotificationService.js";
import { getDiscussionQuestionNotificationMessage, getDiscussionReplyNotificationMessage } from "../../src/i18n/notificationMessages.js";
import { defaultSendCourseReminder } from "../../src/modules/course/courseReminderService.js";
import { deliverCourseMajorVersionNotice } from "../../src/modules/course/courseMajorVersionEmail.js";

// Alle ni bildesituasjonene (`EMAIL_ILLUSTRATIONS`) × nb/nn/en-GB × med og uten lenke, sendt gjennom de ekte
// sendefunksjonene til ACS. Brukes av fasiten (mascot-fasit-email.test.ts, seilbåten) og av testen av et bytte
// (mascot-swap-email.test.ts, testpakken), så begge sender de samme e-postene.
//
// Testfila mocker selv (vi.mock må stå i fila): ACS-klienten legger meldingen i `h.sent`, revisjonsloggen gjør ingenting,
// og databasen svarer for behandleren av ny hovedversjon med `h.notice` og `h.user`.
//
// ⚠️ Datoene skrives av `Intl.DateTimeFormat`, og formatet varierer med ICU-versjonen og tidssonen (Node 24 her, Node
// 22 i CI). Det har ingenting med maskoten å gjøre, så formatteringen byttes ut med en fast tekst som viser datoen,
// språket og valgene. Hvor datoen står i teksten, er fortsatt med.

export type EmailHarnessState = {
  sent: Array<Record<string, any>>;
  notice: null | Record<string, unknown>;
  user: null | Record<string, unknown>;
};

export const EMAIL_LOCALES = ["nb", "nn", "en-GB"] as const;
type Locale = (typeof EMAIL_LOCALES)[number];
const BASE = "https://plattform.example.test";

const mutableEnv = env as unknown as Record<string, unknown>;

/** Kanalen er ACS, med en fast avsender; datoene er fast tekst. Settes tilbake etter hver test. */
export function installEmailTestHooks(h: EmailHarnessState) {
  const original = {
    channel: env.PARTICIPANT_NOTIFICATION_CHANNEL,
    base: env.PUBLIC_APP_BASE_URL,
    acs: env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING,
    sender: env.ACS_EMAIL_SENDER,
  };
  beforeAll(() => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale?: unknown, options?: unknown) {
      return { format: (date: Date) => `[dato ${String(locale)} ${JSON.stringify(options)} ${date.toISOString()}]` };
    } as unknown as typeof Intl.DateTimeFormat);
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    h.sent.length = 0;
    mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "acs_email";
    mutableEnv.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING = "endpoint=https://acs.example.test/;accesskey=dGVzdA==";
    mutableEnv.ACS_EMAIL_SENDER = "avsender@example.test";
  });
  afterEach(() => {
    mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = original.channel;
    mutableEnv.PUBLIC_APP_BASE_URL = original.base;
    mutableEnv.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING = original.acs;
    mutableEnv.ACS_EMAIL_SENDER = original.sender;
  });
}

const SUBMITTED_AT = new Date("2026-11-10T10:00:00.000Z");
const DUE_AT = new Date("2026-11-20T00:00:00.000Z");
const recipient = { recipientEmail: "kari@example.test", recipientName: "Kari Nordmann" };

/** Hver situasjon (nøkkelen i `EMAIL_ILLUSTRATIONS`) med variantene som gir ulik tekst rundt bildet. */
export function emailSituations(h: EmailHarnessState): Record<string, Array<{ variant: string; send: (locale: Locale) => Promise<unknown> }>> {
  return {
    courseNewVersion: [
      { variant: "tre endret", send: (locale) => sendCourseMajorVersionNotification({ ...recipient, noticeId: "n1", courseId: "c1", courseTitle: "Brannvern for alle", versionMajor: 4, changedItemCount: 3, locale }) },
      { variant: "ett endret", send: (locale) => sendCourseMajorVersionNotification({ ...recipient, noticeId: "n1", courseId: "c1", courseTitle: "Brannvern for alle", versionMajor: 4, changedItemCount: 1, locale }) },
      { variant: "uten tall", send: (locale) => sendCourseMajorVersionNotification({ ...recipient, noticeId: "n1", courseId: "c1", courseTitle: "Brannvern for alle", versionMajor: 4, changedItemCount: null, locale }) },
      {
        variant: "fra behandleren i outboxen",
        send: async (locale) => {
          h.notice = { id: "n1", status: "queued", courseId: "c1", versionMajor: 4, userId: "u1" };
          h.user = { email: recipient.recipientEmail, name: recipient.recipientName, preferredLocale: locale, activeStatus: true, isAnonymized: false };
          await deliverCourseMajorVersionNotice("n1");
        },
      },
    ],
    courseAssigned: [
      // #1142 skive 3: den samlede e-posten om nye kurs erstattet e-posten per kurs. Fasiten for situasjonen er laget på nytt.
      { variant: "ett kurs uten frist", send: (locale) => sendCourseAssignmentDigest({ ...recipient, batchId: "b1", userId: "u1", locale, courses: [{ courseId: "kurs-1", title: "Brannvern for alle", classNames: ["Avdeling Vest"], dueAt: null }] }) },
      {
        variant: "tre kurs, frist og to klasser",
        send: (locale) =>
          sendCourseAssignmentDigest({
            ...recipient,
            batchId: "b1",
            userId: "u1",
            locale,
            courses: [
              { courseId: "kurs-2", title: "Brannvern for alle", classNames: ["Avdeling Vest"], dueAt: DUE_AT },
              { courseId: "kurs-3", title: "Personvern i praksis", classNames: ["Nyansatte", "Avdeling Vest"], dueAt: null },
              { courseId: "kurs-4", title: "Etikk i rådgivning", classNames: ["Nyansatte"], dueAt: new Date("2027-01-15T00:00:00.000Z") },
            ],
          }),
      },
    ],
    dueSoon: [
      { variant: "om tre dager", send: (locale) => defaultSendCourseReminder({ ...recipient, courseId: "c1", userId: "u1", courseTitle: "Brannvern for alle", locale, kind: "due_soon", dueAt: DUE_AT, daysBefore: 3 }) },
      { variant: "i dag", send: (locale) => defaultSendCourseReminder({ ...recipient, courseId: "c1", userId: "u1", courseTitle: "Brannvern for alle", locale, kind: "due_soon", dueAt: DUE_AT, daysBefore: 0 }) },
    ],
    overdue: [
      { variant: "forfalt", send: (locale) => defaultSendCourseReminder({ ...recipient, courseId: "c1", userId: "u1", courseTitle: "Brannvern for alle", locale, kind: "overdue", dueAt: DUE_AT }) },
    ],
    passed: [
      { variant: "bestått", send: (locale) => notifyAssessmentResult({ ...recipient, submissionId: "s1", submittedAt: SUBMITTED_AT, moduleTitle: "Rømningsveier", moduleId: "m1", passFailTotal: true, locale }) },
    ],
    notPassed: [
      { variant: "ikke bestått", send: (locale) => notifyAssessmentResult({ ...recipient, submissionId: "s1", submittedAt: SUBMITTED_AT, moduleTitle: "Rømningsveier", moduleId: "m1", passFailTotal: false, locale }) },
    ],
    underReview: [
      { variant: "til sensor", send: (locale) => notifyAssessmentUnderReview({ ...recipient, submissionId: "s1", submittedAt: SUBMITTED_AT, moduleTitle: "Rømningsveier", moduleId: "m1", locale }) },
    ],
    appeal: [
      {
        variant: "mottatt",
        send: (locale) => sendAppealStatusNotification({ ...recipient, appealId: "a1", submissionId: "s1", previousStatus: null, currentStatus: "OPEN", recipientUserId: "u1", moduleTitle: "Rømningsveier", moduleId: "m1", locale }),
      },
      {
        variant: "ferdigbehandlet",
        send: (locale) => sendAppealStatusNotification({ ...recipient, appealId: "a1", submissionId: "s1", previousStatus: "IN_REVIEW", currentStatus: "RESOLVED", recipientUserId: "u1", moduleTitle: "Rømningsveier", moduleId: "m1", locale, passFailTotal: true, resolutionNote: "Svaret dekker kravene." }),
      },
    ],
    discussion: [
      {
        variant: "nytt spørsmål",
        send: (locale) => {
          const message = getDiscussionQuestionNotificationMessage(locale, { courseTitle: "Brannvern for alle", threadTitle: "Hvor står slukkeapparatet?" });
          return sendDiscussionNotification({ ...recipient, subject: message.subject, body: message.nextStepGuidance, notificationType: "discussion_question_created", locale, courseId: "c1", threadId: "t1" });
        },
      },
      {
        variant: "nytt svar",
        send: (locale) => {
          const message = getDiscussionReplyNotificationMessage(locale, { threadTitle: "Hvor står slukkeapparatet?" });
          return sendDiscussionNotification({ ...recipient, subject: message.subject, body: message.nextStepGuidance, notificationType: "discussion_reply_created", locale, courseId: "c1", threadId: "t1" });
        },
      },
    ],
  };
}

/** Meldingen slik den går til ACS, med vedleggets innhold som sha256 og lengde i stedet for base64. */
export function recorded(message: Record<string, any>) {
  return {
    senderAddress: message.senderAddress,
    recipients: message.recipients,
    disableUserEngagementTracking: message.disableUserEngagementTracking,
    subject: message.content.subject,
    plainText: message.content.plainText,
    html: message.content.html,
    attachments: (message.attachments ?? []).map((a: Record<string, string>) => {
      const bytes = Buffer.from(a.contentInBase64, "base64");
      return { name: a.name, contentType: a.contentType, contentId: a.contentId, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  };
}

/** Alle varianter av én situasjon på alle språk, med og uten lenke: «variant | språk | lenke» → meldingen. */
export async function sendSituation(h: EmailHarnessState, situation: string): Promise<Record<string, ReturnType<typeof recorded>>> {
  const actual: Record<string, ReturnType<typeof recorded>> = {};
  for (const { variant, send } of emailSituations(h)[situation]!) {
    for (const locale of EMAIL_LOCALES) {
      for (const link of [true, false]) {
        mutableEnv.PUBLIC_APP_BASE_URL = link ? BASE : undefined;
        h.sent.length = 0;
        await send(locale);
        expect(h.sent, `${situation} ${variant} ${locale}`).toHaveLength(1);
        actual[`${variant} | ${locale} | ${link ? "med lenke" : "uten lenke"}`] = recorded(h.sent[0]!);
      }
    }
  }
  return actual;
}
