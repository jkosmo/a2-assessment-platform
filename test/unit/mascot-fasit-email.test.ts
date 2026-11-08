import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fasit, sha256 } from "../support/mascotFasit.js";

// Maskotpakken, steg 0: fasit for e-postene, byte for byte (doc/design/MASKOTPAKKE.md).
//
// Alle ni bildesituasjonene (`EMAIL_ILLUSTRATIONS`) × nb/nn/en-GB × med og uten lenke, sendt gjennom de ekte
// sendefunksjonene til ACS (mocket her). Lagret: emne, ren tekst, HTML, og vedleggets navn, type, innholds-id og
// sha256. Påminnelsene (courseReminderService.ts) og ny hovedversjon (courseMajorVersionEmail.ts, med verft-setningen
// fra notificationMessages.ts) går sine egne veier, også de.
//
// ⚠️ Datoene skrives av `Intl.DateTimeFormat`, og formatet varierer med ICU-versjonen og tidssonen (Node 24 her, Node
// 22 i CI). Det har ingenting med maskoten å gjøre, så formatteringen byttes ut med en fast tekst som viser datoen,
// språket og valgene. Hvor datoen står i teksten, er fortsatt med i fasiten.

const h = vi.hoisted(() => {
  const sent: Array<Record<string, any>> = [];
  return {
    sent,
    notice: null as null | Record<string, unknown>,
    user: null as null | Record<string, unknown>,
  };
});

vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    beginSend(message: Record<string, unknown>) {
      h.sent.push(message);
      return Promise.resolve({ pollUntilDone: () => Promise.resolve({ status: "Succeeded" }) });
    }
  },
}));
vi.mock("../../src/services/auditService.js", () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));
// Bare behandleren for ny hovedversjon leser databasen: raden, kurset, personen og versjonen.
vi.mock("../../src/db/prisma.js", () => ({
  prisma: {
    courseVersionNotice: {
      findUnique: vi.fn(async () => h.notice),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    course: { findUnique: vi.fn(async () => ({ title: "Brannvern for alle", publishedAt: new Date("2026-01-01T00:00:00Z"), archivedAt: null, versionMajor: 4 })) },
    user: { findUnique: vi.fn(async () => h.user) },
    courseVersion: { findUnique: vi.fn(async () => ({ changedItemCount: 3 })) },
  },
}));

import { env } from "../../src/config/env.js";
import {
  notifyAssessmentResult,
  notifyAssessmentUnderReview,
  sendAppealStatusNotification,
  sendCourseAssignmentNotification,
  sendCourseMajorVersionNotification,
  sendDiscussionNotification,
} from "../../src/modules/certification/participantNotificationService.js";
import { getDiscussionQuestionNotificationMessage, getDiscussionReplyNotificationMessage } from "../../src/i18n/notificationMessages.js";
import { defaultSendCourseReminder } from "../../src/modules/course/courseReminderService.js";
import { deliverCourseMajorVersionNotice } from "../../src/modules/course/courseMajorVersionEmail.js";

const LOCALES = ["nb", "nn", "en-GB"] as const;
type Locale = (typeof LOCALES)[number];
const BASE = "https://plattform.example.test";

const mutableEnv = env as unknown as Record<string, unknown>;
const original = {
  channel: env.PARTICIPANT_NOTIFICATION_CHANNEL,
  base: env.PUBLIC_APP_BASE_URL,
  acs: env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING,
  sender: env.ACS_EMAIL_SENDER,
};

beforeAll(() => {
  // Se toppen av fila: datoen som fast tekst, uavhengig av ICU og tidssone.
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

const SUBMITTED_AT = new Date("2026-11-10T10:00:00.000Z");
const DUE_AT = new Date("2026-11-20T00:00:00.000Z");
const recipient = { recipientEmail: "kari@example.test", recipientName: "Kari Nordmann" };

/** Hver situasjon (nøkkelen i `EMAIL_ILLUSTRATIONS`) med variantene som gir ulik tekst rundt bildet. */
const SITUATIONS: Record<string, Array<{ variant: string; send: (locale: Locale) => Promise<unknown> }>> = {
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
    { variant: "uten frist", send: (locale) => sendCourseAssignmentNotification({ ...recipient, courseTitle: "Brannvern for alle", className: "Avdeling Vest", locale, courseId: "c1" }) },
    { variant: "med frist", send: (locale) => sendCourseAssignmentNotification({ ...recipient, courseTitle: "Brannvern for alle", className: "Avdeling Vest", dueAt: DUE_AT, locale, courseId: "c1" }) },
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

/** Meldingen slik den går til ACS, med vedleggets innhold som sha256 og lengde i stedet for base64. */
function recorded(message: Record<string, any>) {
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

describe("maskotpakken, steg 0: e-postene byte for byte", () => {
  it("dekker alle ni bildesituasjonene (kontrollcase: en tom liste ville bestått alt under)", () => {
    expect(Object.keys(SITUATIONS).sort()).toEqual(
      ["appeal", "courseAssigned", "courseNewVersion", "discussion", "dueSoon", "notPassed", "overdue", "passed", "underReview"],
    );
  });

  it.each(Object.keys(SITUATIONS))("%s: alle språk og varianter, med og uten lenke", async (situation) => {
    const actual: Record<string, unknown> = {};
    for (const { variant, send } of SITUATIONS[situation]!) {
      for (const locale of LOCALES) {
        for (const link of [true, false]) {
          mutableEnv.PUBLIC_APP_BASE_URL = link ? BASE : undefined;
          h.sent.length = 0;
          await send(locale);
          expect(h.sent, `${situation} ${variant} ${locale}`).toHaveLength(1);
          actual[`${variant} | ${locale} | ${link ? "med lenke" : "uten lenke"}`] = recorded(h.sent[0]!);
        }
      }
    }
    expect(actual).toEqual(fasit(`email/${situation}.json`, actual));
  });
});
