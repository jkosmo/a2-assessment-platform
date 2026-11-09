import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1141 og lenkene (compliance 2026-11-06), gjennom rutene: handlingen, raden i køen, og e-posten som går ut. Enhetstestene i
// test/unit/email-template-links-1141.test.ts får id-en servert. Her må rutene selv ha den med, ellers går e-posten uten lenke uten at noe feiler.

const sent: Array<Record<string, any>> = [];
vi.mock("@azure/communication-email", () => ({
  EmailClient: class {
    beginSend(message: Record<string, unknown>) {
      sent.push(message);
      return Promise.resolve({ pollUntilDone: () => Promise.resolve({ status: "Succeeded" }) });
    }
  },
}));

import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";
import { deliverOutboxEvent, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";
import { runCourseAssignmentEmailSchedule } from "../src/modules/course/courseAssignmentNotice.js";
import { findModuleIdByTitle, seenModuleVersionId } from "./support/participantFlow.js";

const BASE = "https://plattform.example.test";
const mutableEnv = env as unknown as Record<string, unknown>;
const original = {
  channel: env.PARTICIPANT_NOTIFICATION_CHANNEL,
  base: env.PUBLIC_APP_BASE_URL,
  connection: env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING,
  sender: env.ACS_EMAIL_SENDER,
};

const tag = `epost1141-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

function headers(suffix: string, roles: string) {
  return {
    "x-user-id": `${tag}-${suffix}`,
    "x-user-email": `${tag}-${suffix}@company.com`,
    "x-user-name": `Bruker ${suffix}`,
    "x-user-roles": roles,
    "x-locale": "nb",
  };
}

// Den seedede deltakeren: bare den kontoen ser den seedede modulen. Radene skilles på innleveringen, ikke på personen.
const seededParticipant = { "x-user-id": "participant-1", "x-user-email": "participant@company.com", "x-user-name": "Platform Participant" };
const admin = headers("admin", "ADMINISTRATOR");
const handler = headers("handler", "APPEAL_HANDLER");
const courseIds: string[] = [];

const mailsTo = (address: string) => sent.filter((m) => m.recipients.to.some((r: { address: string }) => r.address === address));

function expectOwnLink(mail: Record<string, any>, url: string, file: string) {
  expect(mail.attachments.map((a: { name: string }) => a.name)).toEqual([file]);
  expect(mail.content.plainText.match(/https?:\/\/\S+/g)).toEqual([url]);
  expect(mail.content.html).toContain(`href="${url.replace("&", "&amp;")}"`);
}

beforeEach(() => {
  sent.length = 0;
  mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = "acs_email";
  mutableEnv.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING = "endpoint=https://acs.example.test/;accesskey=dGVzdA==";
  mutableEnv.ACS_EMAIL_SENDER = "avsender@example.test";
  mutableEnv.PUBLIC_APP_BASE_URL = BASE;
});

afterEach(() => {
  mutableEnv.PARTICIPANT_NOTIFICATION_CHANNEL = original.channel;
  mutableEnv.PUBLIC_APP_BASE_URL = original.base;
  mutableEnv.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING = original.connection;
  mutableEnv.ACS_EMAIL_SENDER = original.sender;
});

afterAll(async () => {
  await prisma.discussionThread.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.$disconnect();
});

/** En innlevering hele veien gjennom vurderingen, slik m2-manual-review og m2-appeal-flow gjør det. */
async function submitAndAssess(participant: Record<string, string>, response: string, reflection: string) {
  const moduleId = await findModuleIdByTitle(app, participant, "Generative AI Foundations");
  const submission = await request(app)
    .post("/api/submissions")
    .set(participant)
    .send({
      moduleId,
      moduleVersionId: await seenModuleVersionId(app, participant, moduleId),
      deliveryType: "text",
      responseJson: { response, reflection, promptExcerpt: "Assess and summarize." },
    });
  expect(submission.status).toBe(201);
  const submissionId = submission.body.submission.id as string;
  const start = await request(app).get(`/api/modules/${moduleId}/mcq/start`).query({ submissionId }).set(participant);
  expect(start.status).toBe(200);
  const responses = start.body.questions.map((question: { id: string; stem: string }) => ({
    questionId: question.id,
    selectedAnswer: question.stem === "What is the recommended model ownership boundary?" ? "Backend owns final decision" : "Prompt versions and thresholds",
  }));
  const submit = await request(app).post(`/api/modules/${moduleId}/mcq/submit`).set(participant).send({ submissionId, attemptId: start.body.attemptId, responses });
  expect(submit.status).toBe(200);
  const run = await request(app).post(`/api/assessments/${submissionId}/run`).set(participant).send({ sync: true });
  expect(run.status).toBe(202);
  return { moduleId, submissionId };
}

/** Radene for én innlevering. Køen er delt med andre tester, så de leveres enkeltvis, ikke gjennom arbeideren. */
async function rowsFor(type: string, submissionId: string) {
  const rows = await prisma.outboxEvent.findMany({ where: { type }, orderBy: { createdAt: "asc" } });
  return rows.filter((row) => (JSON.parse(row.payloadJson) as { submissionId?: string }).submissionId === submissionId);
}

describe("e-post gjennom rutene", () => {
  it("et svar som går til sensor: raden venter fem minutter, deltakeren får e-posten om sensor, ikke et resultat", async () => {
    const participant = seededParticipant;
    const before = Date.now();
    const { moduleId, submissionId } = await submitAndAssess(
      participant,
      "Submission contains sensitive client data references.",
      "Manual review should be triggered due to sensitive handling concerns.",
    );

    const rows = await rowsFor(OUTBOX_EVENT_TYPES.assessmentUnderReviewNotification, submissionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].availableAt.getTime()).toBeGreaterThanOrEqual(before + 4 * 60 * 1000);
    expect(await rowsFor(OUTBOX_EVENT_TYPES.assessmentNotification, submissionId)).toHaveLength(0);

    await deliverOutboxEvent({ type: rows[0].type, payloadJson: rows[0].payloadJson });
    const mails = mailsTo(participant["x-user-email"]);
    expect(mails).toHaveLength(1);
    expectOwnLink(mails[0], `${BASE}/participant?moduleId=${moduleId}`, "vurdering-sensor.jpg");
    expect(mails[0].content.subject).not.toMatch(/ikke bestått/i);
  });

  it("sensor ble ferdig før raden gikk: deltakeren får resultatet, ikke e-posten om sensor etterpå", async () => {
    const participant = seededParticipant;
    const reviewer = headers("sensor-person", "REVIEWER");
    const { submissionId } = await submitAndAssess(
      participant,
      "Submission contains sensitive client data references.",
      "Manual review should be triggered due to sensitive handling concerns.",
    );
    const [row] = await rowsFor(OUTBOX_EVENT_TYPES.assessmentUnderReviewNotification, submissionId);
    const review = await prisma.manualReview.findFirstOrThrow({ where: { submissionId }, select: { id: true } });
    expect((await request(app).post(`/api/reviews/${review.id}/claim`).set(reviewer)).status).toBe(200);
    const override = await request(app)
      .post(`/api/reviews/${review.id}/override`)
      .set(reviewer)
      .send({ passFailTotal: false, decisionReason: "Manual reviewer overrode the decision.", overrideReason: "Insufficient practical depth." });
    expect(override.status).toBe(200);

    await deliverOutboxEvent({ type: row.type, payloadJson: row.payloadJson });
    expect(mailsTo(participant["x-user-email"])).toHaveLength(0);
  });

  it("sensor har tatt saken, men er ikke ferdig: deltakeren får e-posten om sensor", async () => {
    const participant = seededParticipant;
    const reviewer = headers("sensor-person", "REVIEWER");
    const { submissionId } = await submitAndAssess(
      participant,
      "Submission contains sensitive client data references.",
      "Manual review should be triggered due to sensitive handling concerns.",
    );
    const [row] = await rowsFor(OUTBOX_EVENT_TYPES.assessmentUnderReviewNotification, submissionId);
    const review = await prisma.manualReview.findFirstOrThrow({ where: { submissionId }, select: { id: true } });
    expect((await request(app).post(`/api/reviews/${review.id}/claim`).set(reviewer)).status).toBe(200);

    await deliverOutboxEvent({ type: row.type, payloadJson: row.payloadJson });
    expect(mailsTo(participant["x-user-email"])).toHaveLength(1);
  });

  it("sensor ble ferdig og deltakeren anket før raden gikk: anken gjør ikke e-posten om sensor gyldig igjen", async () => {
    const participant = seededParticipant;
    const reviewer = headers("sensor-person", "REVIEWER");
    const { submissionId } = await submitAndAssess(
      participant,
      "Submission contains sensitive client data references.",
      "Manual review should be triggered due to sensitive handling concerns.",
    );
    const [row] = await rowsFor(OUTBOX_EVENT_TYPES.assessmentUnderReviewNotification, submissionId);
    const review = await prisma.manualReview.findFirstOrThrow({ where: { submissionId }, select: { id: true } });
    expect((await request(app).post(`/api/reviews/${review.id}/claim`).set(reviewer)).status).toBe(200);
    const override = await request(app)
      .post(`/api/reviews/${review.id}/override`)
      .set(reviewer)
      .send({ passFailTotal: false, decisionReason: "Manual reviewer overrode the decision.", overrideReason: "Insufficient practical depth." });
    expect(override.status).toBe(200);
    const appeal = await request(app).post(`/api/submissions/${submissionId}/appeals`).set(participant).send({ appealReason: "I request a second review of the practical quality." });
    expect(appeal.status).toBe(201);
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: submissionId }, select: { submissionStatus: true } });
    expect(submission.submissionStatus).toBe("UNDER_REVIEW");

    await deliverOutboxEvent({ type: row.type, payloadJson: row.payloadJson });
    expect(mailsTo(participant["x-user-email"])).toHaveLength(0);
  });

  it("anke: opprettet, tatt og avgjort har alle lenke til modulen", async () => {
    const participant = seededParticipant;
    const { moduleId, submissionId } = await submitAndAssess(
      participant,
      "A practical submission with analysis and responsible use notes.",
      "I iterated on prompts and manually validated outputs.",
    );
    const created = await request(app).post(`/api/submissions/${submissionId}/appeals`).set(participant).send({ appealReason: "I request a second review of the practical quality." });
    expect(created.status).toBe(201);
    const appealId = created.body.appeal.id as string;
    expect((await request(app).post(`/api/appeals/${appealId}/claim`).set(handler)).status).toBe(200);
    const resolved = await request(app)
      .post(`/api/appeals/${appealId}/resolve`)
      .set(handler)
      .send({ passFailTotal: true, decisionReason: "Adjusted after a second review.", resolutionNote: "The evidence supports a pass, see the rubric." });
    expect(resolved.status).toBe(200);

    const rows = await rowsFor(OUTBOX_EVENT_TYPES.appealNotification, submissionId);
    expect(rows).toHaveLength(3);
    for (const row of rows) await deliverOutboxEvent({ type: row.type, payloadJson: row.payloadJson });
    const mails = mailsTo(participant["x-user-email"]);
    expect(mails).toHaveLength(3);
    for (const mail of mails) expectOwnLink(mail, `${BASE}/participant?moduleId=${moduleId}`, "anke.jpg");
  });

  // #1142 skive 3: tildelingen sender ingenting selv. Jobben i workeren lager raden, samler den et kvarter senere, og
  // behandleren i outboxen sender én e-post med lenke til «Mine kurs» (uten id: e-posten kan nevne flere kurs).
  async function runEmailJob(courseId: string) {
    const t0 = new Date(Date.now() - 60 * 60_000);
    await runCourseAssignmentEmailSchedule({ now: t0, onlyCourseIds: [courseId] });
    await runCourseAssignmentEmailSchedule({ now: new Date(t0.getTime() + 16 * 60_000), onlyCourseIds: [courseId] });
    const rows = await prisma.courseAssignmentNotice.findMany({ where: { courseId, batchId: { not: null } }, select: { batchId: true } });
    const events = await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.courseAssignmentDigest } });
    const batchIds = new Set(rows.map((r) => r.batchId));
    for (const event of events) {
      if (batchIds.has((JSON.parse(event.payloadJson) as { batchId: string }).batchId)) await deliverOutboxEvent({ type: event.type, payloadJson: event.payloadJson, attempts: 0, maxAttempts: 5 });
    }
  }

  it("klassetildeling: ingen e-post fra handlingen; jobben sender én, med lenke til «Mine kurs»", async () => {
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": `Kurs ${tag}`, nb: `Kurs ${tag}`, nn: `Kurs ${tag}` }), enrollmentPolicy: "RESTRICTED", publishedAt: new Date() },
      select: { id: true },
    });
    courseIds.push(course.id);
    const email = `${tag}-medlem@company.com`;
    const member = await prisma.user.create({ data: { externalId: `${tag}-medlem`, name: "Medlem", email, preferredLocale: "nb" }, select: { id: true } });
    const klass = await request(app).post("/api/admin/content/classes").set(admin).send({ name: `Klasse ${tag}` });
    expect(klass.status).toBe(201);
    const classId = klass.body.class.id as string;
    expect((await request(app).post(`/api/admin/content/classes/${classId}/members`).set(admin).send({ userId: member.id })).status).toBe(201);
    expect((await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId: course.id })).status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mailsTo(email), "handlingen sender ingenting").toHaveLength(0);

    await runEmailJob(course.id);
    expect(mailsTo(email)).toHaveLength(1);
    expectOwnLink(mailsTo(email)[0], `${BASE}/participant`, "kurs-tildelt.jpg");
    expect(mailsTo(email)[0].content.subject).toBe(`Du har fått et nytt kurs: «Kurs ${tag}»`);

    // Samme tildeling på nytt med ny frist: fristen oppdateres, og ingen får e-posten om nytt kurs igjen.
    const dueAt = "2030-01-01T00:00:00.000Z";
    expect((await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId: course.id, dueAt })).status).toBe(201);
    await runEmailJob(course.id);
    expect(mailsTo(email)).toHaveLength(1);
    const assignment = await prisma.courseGroupAssignment.findUniqueOrThrow({ where: { courseId_classId: { courseId: course.id, classId } } });
    expect(assignment.dueAt?.toISOString()).toBe(dueAt);
  });

  it("dobbeltklikk på «Tildel kurs»: én tildeling, én rad, én e-post", async () => {
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": `Kurs2 ${tag}`, nb: `Kurs2 ${tag}`, nn: `Kurs2 ${tag}` }), enrollmentPolicy: "RESTRICTED", publishedAt: new Date() },
      select: { id: true },
    });
    courseIds.push(course.id);
    const email = `${tag}-medlem2@company.com`;
    const member = await prisma.user.create({ data: { externalId: `${tag}-medlem2`, name: "Medlem", email }, select: { id: true } });
    const klass = await request(app).post("/api/admin/content/classes").set(admin).send({ name: `Klasse2 ${tag}` });
    const classId = klass.body.class.id as string;
    expect((await request(app).post(`/api/admin/content/classes/${classId}/members`).set(admin).send({ userId: member.id })).status).toBe(201);

    const assign = () => request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId: course.id });
    const [first, second] = await Promise.all([assign(), assign()]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await prisma.courseGroupAssignment.count({ where: { courseId: course.id, classId } })).toBe(1);
    await runEmailJob(course.id);
    expect(await prisma.courseAssignmentNotice.count({ where: { courseId: course.id } })).toBe(1);
    expect(mailsTo(email)).toHaveLength(1);
  });

  it("diskusjon: eieren får lenke til det nye spørsmålet, og den som spurte, til svaret", async () => {
    const owner = headers("eier", "SUBJECT_MATTER_OWNER");
    const asker = headers("spor", "PARTICIPANT");
    const helper = headers("svar", "PARTICIPANT");
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": "K", nb: "K", nn: "K" }), publishedAt: new Date(), discussionsEnabled: true },
      select: { id: true },
    });
    courseIds.push(course.id);
    const ownerUser = await prisma.user.create({ data: { externalId: owner["x-user-id"], name: owner["x-user-name"], email: owner["x-user-email"] }, select: { id: true } });
    await prisma.contentOwner.create({ data: { contentType: "COURSE", contentId: course.id, userId: ownerUser.id } });

    const thread = await request(app).post(`/api/courses/${course.id}/discussions`).set(asker).send({ kind: "QUESTION", title: "Hvordan tolke github.com?", bodyMarkdown: "x" });
    expect(thread.status).toBe(201);
    const threadId = thread.body.thread.id as string;
    const url = `${BASE}/participant?courseId=${course.id}&threadId=${threadId}`;

    await vi.waitFor(() => expect(mailsTo(owner["x-user-email"])).toHaveLength(1), { timeout: 5000 });
    expectOwnLink(mailsTo(owner["x-user-email"])[0], url, "diskusjon.jpg");
    expect(mailsTo(owner["x-user-email"])[0].content.plainText).toContain("github[.]com");

    expect((await request(app).post(`/api/courses/${course.id}/discussions/${threadId}/replies`).set(helper).send({ bodyMarkdown: "Mitt svar" })).status).toBe(201);
    await vi.waitFor(() => expect(mailsTo(asker["x-user-email"])).toHaveLength(1), { timeout: 5000 });
    expectOwnLink(mailsTo(asker["x-user-email"])[0], url, "diskusjon.jpg");
  });
});
