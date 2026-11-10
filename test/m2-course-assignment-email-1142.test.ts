import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1142 skive 3 (doc/design/PLAN_1142.md, punkt 4 og skive 3): e-posten når en deltaker får nye kurs. Handlingene går gjennom
// rutene (klasser, medlemmer, tildelinger, publisering, import). Jobben (`runCourseAssignmentEmailSchedule`) og behandleren
// (`deliverCourseAssignmentDigest`) kalles direkte, som workeren gjør, med `now` satt og `send` byttet ut der testen ser på
// hva som sendes — som i test/m2-course-major-email-934-4b.test.ts.
//
// Klokka: hver test begynner tolv timer tilbake (`clock`), så jobbens tidspunkter (`createdAt`, `queuedAt`) ligger før
// behandlerens (`sendingAt`, satt av databasen nå). Jobben kjøres avgrenset til testens kurs (`onlyCourseIds`): databasen
// deles med andre tester.
//
// Der testen teller e-poster, går de gjennom den ekte sendefunksjonen til en falsk ACS-klient (`sent`), så også en e-post fra
// en annen vei (den gamle e-posten per kurs) blir telt.

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
import { runInTransaction } from "../src/db/transaction.js";
import { SYSTEM_ALL_PARTICIPANTS_CLASS_ID } from "../src/modules/course/classRepository.js";
import {
  collectPersonDigest,
  COURSE_ASSIGNMENT_EMAIL_PER_RUN,
  COURSE_ASSIGNMENT_EMAIL_SPACING_MS,
  COURSE_ASSIGNMENT_PERSON_LOCK_NAMESPACE,
  deliverCourseAssignmentDigest,
  runCourseAssignmentEmailSchedule,
  type CourseAssignmentDigestSend,
} from "../src/modules/course/courseAssignmentNotice.js";
import { EmailContainsLinkError } from "../src/modules/certification/illustratedEmail.js";
import { deliverOutboxEvent, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";

const BASE = "https://plattform.example.test";
const mutableEnv = env as unknown as Record<string, unknown>;
const original = {
  channel: env.PARTICIPANT_NOTIFICATION_CHANNEL,
  base: env.PUBLIC_APP_BASE_URL,
  connection: env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING,
  sender: env.ACS_EMAIL_SENDER,
};

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
  await prisma.$disconnect();
});

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `epost1142 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
// Én administrator per test: rutene har en grense på 120 kall i minuttet per bruker, og noen tester gjør mange.
const makeAdmin = () => ({ "x-user-id": `epost1142-admin-${RUN}-${seq++}`, "x-user-email": `epost1142.admin.${RUN}.${seq}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" });
let admin = makeAdmin();
beforeEach(() => {
  admin = makeAdmin();
});

const mailsTo = (address: string) => sent.filter((m) => m.recipients.to.some((r: { address: string }) => r.address === address));

async function person(extra: { activeStatus?: boolean; isAnonymized?: boolean } = {}) {
  const externalId = `epost1142-p-${RUN}-${seq++}`;
  return prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test`, preferredLocale: "nb", ...extra }, select: { id: true, email: true } });
}

/**
 * Et kurs med én publisert modul og én publisert seksjon. `published: false`: et ekte utkast. `sectionOnly`: uten modul, for
 * eksporten (en modul uten spørsmålssett kan ikke eksporteres).
 */
async function course(options: { published?: boolean; title?: string; sectionOnly?: boolean } = {}) {
  const title = options.title ?? tag("kurs");
  const module = await prisma.module.create({ data: { title: L(tag("modul")) }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({ data: { moduleId: module.id, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() }, select: { id: true } });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const sectionVersion = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: sectionVersion.id } });
  const created = await prisma.course.create({
    data: {
      title: L(title),
      enrollmentPolicy: "RESTRICTED",
      publishedAt: options.published === false ? null : new Date(),
      items: {
        create: options.sectionOnly
          ? [{ itemType: "SECTION", sectionId: section.id, sortOrder: 0 }]
          : [{ itemType: "MODULE", moduleId: module.id, sortOrder: 0 }, { itemType: "SECTION", sectionId: section.id, sortOrder: 1 }],
      },
    },
    select: { id: true },
  });
  return { id: created.id, title };
}

async function newClass(name = tag("klasse")) {
  const created = await request(app).post("/api/admin/content/classes").set(admin).send({ name });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.class.id as string;
}

async function addMember(classId: string, userId: string) {
  const response = await request(app).post(`/api/admin/content/classes/${classId}/members`).set(admin).send({ userId });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function removeMember(classId: string, userId: string) {
  const response = await request(app).delete(`/api/admin/content/classes/${classId}/members/${userId}`).set(admin);
  expect(response.status, JSON.stringify(response.body)).toBe(204);
}

async function assign(classId: string, courseId: string, dueAt?: string) {
  const response = await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId, ...(dueAt ? { dueAt } : {}) });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function unassign(classId: string, courseId: string) {
  const response = await request(app).delete(`/api/admin/content/classes/${classId}/courses/${courseId}`).set(admin);
  expect(response.status, JSON.stringify(response.body)).toBe(204);
}

async function post(path: string, body: object = {}, expected = 200) {
  const response = await request(app).post(path).set(admin).send(body);
  expect(response.status, `${path} ${JSON.stringify(response.body).slice(0, 400)}`).toBe(expected);
  return response;
}

const publish = (courseId: string) => post(`/api/admin/content/courses/${courseId}/publish`);
const unpublish = (courseId: string) => post(`/api/admin/content/courses/${courseId}/unpublish`);

/** Jobbens klokke: minutter etter et utgangspunkt tolv timer tilbake. */
function clock() {
  const t0 = Date.now() - 12 * 60 * 60_000;
  return (minutes: number) => new Date(t0 + minutes * 60_000);
}

const job = (now: Date, courseIds: string[]) => runCourseAssignmentEmailSchedule({ now, onlyCourseIds: courseIds });

async function rows(courseIds: string[]) {
  return prisma.courseAssignmentNotice.findMany({ where: { courseId: { in: courseIds } }, orderBy: [{ userId: "asc" }, { courseId: "asc" }] });
}

/** Hendelsene i outboxen for en person, eldst først. */
async function eventsFor(userId: string) {
  const events = await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.courseAssignmentDigest }, orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }] });
  return events
    .map((event) => ({ ...event, payload: JSON.parse(event.payloadJson) as { batchId: string; userId: string } }))
    .filter((event) => event.payload.userId === userId);
}

/** Den nyeste samlingen for en person (fra hendelsen). */
async function latestBatch(userId: string) {
  const events = await eventsFor(userId);
  expect(events.length, "ingen samling for personen").toBeGreaterThan(0);
  return events.at(-1)!.payload.batchId;
}

/** Leverer hendelsen gjennom outboxen, slik workeren gjør (ekte sendefunksjon, falsk ACS). */
async function deliverThroughOutbox(batchId: string) {
  const event = (await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.courseAssignmentDigest } })).find(
    (e) => (JSON.parse(e.payloadJson) as { batchId: string }).batchId === batchId,
  );
  expect(event, `ingen hendelse for ${batchId}`).toBeDefined();
  await deliverOutboxEvent({ type: event!.type, payloadJson: event!.payloadJson, attempts: 0, maxAttempts: 5 });
}

function okSend() {
  return vi.fn<CourseAssignmentDigestSend>(async () => ({ delivered: true, channel: "log", subject: "", nextStepGuidance: "" }));
}

const titlesSent = (send: ReturnType<typeof okSend>, call = 0) => send.mock.calls[call]![0].courses.map((c) => JSON.parse(c.title).nb as string).sort();
const sorted = (values: string[]) => [...values].sort();

describe("#1142 skive 3 — veiene inn gir én samlet e-post", () => {
  it("nytt medlem i en klasse med to publiserte kurs: én e-post med to kurs. Handlingene sender ingenting; vinduet er per person", async () => {
    const t = clock();
    const a = await course();
    const b = await course();
    const fromBefore = await person();
    const added = await person();
    const classId = await newClass();
    await addMember(classId, fromBefore.id);
    await assign(classId, a.id, "2030-03-01T00:00:00.000Z");
    await assign(classId, b.id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent, "tildelingen sender ingenting selv").toHaveLength(0);

    expect(await job(t(0), [a.id, b.id])).toMatchObject({ created: 2, queued: 0 });
    await addMember(classId, added.id); // vei 1
    expect(await job(t(5), [a.id, b.id])).toMatchObject({ created: 2, queued: 0 });
    expect(await job(t(14), [a.id, b.id])).toMatchObject({ queued: 0 });
    expect(await job(t(16), [a.id, b.id])).toMatchObject({ queued: 1 });
    expect(await job(t(21), [a.id, b.id])).toMatchObject({ queued: 1 });

    for (const user of [fromBefore, added]) {
      await deliverThroughOutbox(await latestBatch(user.id));
      const mails = mailsTo(user.email);
      expect(mails, user === fromBefore ? "medlemmet fra før" : "det nye medlemmet").toHaveLength(1);
      expect(mails[0].content.subject).toBe("Du har fått 2 nye kurs");
      expect(mails[0].content.plainText).toContain(`• «${a.title}»`);
      expect(mails[0].content.plainText).toContain(`• «${b.title}»`);
      expect(mails[0].content.plainText.match(/https?:\/\/\S+/g)).toEqual([`${BASE}/participant`]);
      expect(mails[0].attachments.map((x: { name: string }) => x.name)).toEqual(["kurs-tildelt.jpg"]);
    }
    expect((await rows([a.id, b.id])).map((r) => r.status)).toEqual(["sent", "sent", "sent", "sent"]);
    expect(sent).toHaveLength(2);
  });

  it("tre kurs tildelt innen vinduet (t0, +5, +10): ingen e-post ved +20, én med alle tre ved +26", async () => {
    const t = clock();
    const courses = [await course(), await course(), await course()];
    const ids = courses.map((c) => c.id);
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    for (const [i, c] of courses.entries()) {
      await assign(classId, c.id);
      expect(await job(t(i * 5), ids)).toMatchObject({ created: 1, queued: 0 });
    }
    expect(await job(t(20), ids)).toMatchObject({ queued: 0 });
    expect(await job(t(26), ids)).toMatchObject({ queued: 1 });
    expect(await job(t(27), ids)).toMatchObject({ queued: 0 });

    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(titlesSent(send)).toEqual(sorted(courses.map((c) => c.title)));
    // Hvert kurs har sin egen id med til e-posten (ett kurs: lenken går rett til kurset, produkteier 2026-11-09).
    const sentPairs = send.mock.calls[0]![0].courses.map((c) => `${c.courseId}=${JSON.parse(c.title).nb}`).sort();
    expect(sentPairs).toEqual(courses.map((c) => `${c.id}=${c.title}`).sort());
  });

  describe("upublisert kurs: ingen e-post ved tildeling, én når det publiseres", () => {
    async function memberWithDraft() {
      const draft = await course({ published: false });
      const u = await person();
      const classId = await newClass();
      await addMember(classId, u.id);
      await assign(classId, draft.id);
      return { draft, u, classId };
    }

    async function expectOneEmailAfterPublish(courseId: string, userId: string, t: (m: number) => Date) {
      expect(await job(t(1), [courseId])).toMatchObject({ created: 1 });
      expect(await job(t(17), [courseId])).toMatchObject({ queued: 1 });
      const send = okSend();
      await deliverCourseAssignmentDigest(await latestBatch(userId), { send });
      expect(send).toHaveBeenCalledTimes(1);
    }

    it("«Publiser kurs» uten kaskade", async () => {
      const t = clock();
      const { draft, u } = await memberWithDraft();
      expect(await job(t(0), [draft.id])).toMatchObject({ created: 0 });
      expect(await rows([draft.id])).toEqual([]);
      await publish(draft.id);
      await expectOneEmailAfterPublish(draft.id, u.id, t);
    });

    it("«Publiser kurs» med kaskade (kurset har et upublisert element)", async () => {
      const t = clock();
      const { draft, u } = await memberWithDraft();
      const extra = await prisma.courseSection.create({ data: { title: L(tag("utkast-seksjon")) }, select: { id: true } });
      await prisma.courseSectionVersion.create({ data: { sectionId: extra.id, versionNo: 1, bodyMarkdown: L("Utkast.") } });
      await prisma.courseItem.create({ data: { courseId: draft.id, itemType: "SECTION", sectionId: extra.id, sortOrder: 2 } });
      expect(await job(t(0), [draft.id])).toMatchObject({ created: 0 });
      await post(`/api/admin/content/courses/${draft.id}/publish`, {}, 409);
      expect(await job(t(0), [draft.id])).toMatchObject({ created: 0 });
      await post(`/api/admin/content/courses/${draft.id}/publish`, { publishItems: true });
      await expectOneEmailAfterPublish(draft.id, u.id, t);
    });

    it("import med replaceExisting av et kurs som har klasser, når fila sier publisert", async () => {
      const t = clock();
      const c = await course({ sectionOnly: true });
      const exported = await request(app).get(`/api/admin/content/courses/${c.id}/export-package`).set(admin);
      expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
      const file = JSON.parse(JSON.stringify(exported.body.envelope ?? exported.body));
      await unpublish(c.id);
      const u = await person();
      const classId = await newClass();
      await addMember(classId, u.id);
      await assign(classId, c.id);
      expect(await job(t(0), [c.id])).toMatchObject({ created: 0 });
      const imported = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: file, mode: "replaceExisting", targetId: c.id });
      expect(imported.status, JSON.stringify(imported.body).slice(0, 400)).toBe(201);
      expect((await prisma.course.findUniqueOrThrow({ where: { id: c.id } })).publishedAt).not.toBeNull();
      await expectOneEmailAfterPublish(c.id, u.id, t);
    });
  });

  it("OPEN-kurs tildelt en klasse gir e-post (avgjort 2026-11-09)", async () => {
    const t = clock();
    const c = await course();
    await prisma.course.update({ where: { id: c.id }, data: { enrollmentPolicy: "OPEN" } });
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    expect(await job(t(0), [c.id])).toMatchObject({ created: 1 });
    expect(await job(t(16), [c.id])).toMatchObject({ queued: 1 });
  });
});

describe("#1142 skive 3 — det som ikke gjelder lenger, tas ut", () => {
  it("ved samlingen: avpublisert og ikke lenger tildelt slettes, ingen e-post; publisert og tildelt igjen gir én e-post med begge", async () => {
    const t = clock();
    const a = await course();
    const b = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, a.id);
    await assign(classId, b.id);
    expect(await job(t(0), [a.id, b.id])).toMatchObject({ created: 2 });

    await unpublish(a.id);
    await unassign(classId, b.id);
    expect(await job(t(16), [a.id, b.id])).toMatchObject({ queued: 0, removed: 2 });
    expect(await rows([a.id, b.id])).toEqual([]);
    expect(await eventsFor(u.id)).toEqual([]);

    await publish(a.id);
    await assign(classId, b.id);
    expect(await job(t(17), [a.id, b.id])).toMatchObject({ created: 2, queued: 0 });
    expect(await job(t(33), [a.id, b.id])).toMatchObject({ queued: 1 });
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send });
    expect(titlesSent(send)).toEqual(sorted([a.title, b.title]));
  });

  it("mellom kø og behandler: et avpublisert kurs tas ut av lista og raden slettes; publisert igjen gir en ny e-post om det", async () => {
    const t = clock();
    const a = await course();
    const b = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, a.id);
    await assign(classId, b.id);
    await job(t(0), [a.id, b.id]);
    expect(await job(t(16), [a.id, b.id])).toMatchObject({ queued: 1 });
    expect((await rows([a.id, b.id])).map((r) => r.status)).toEqual(["queued", "queued"]);

    await unpublish(a.id);
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send });
    expect(titlesSent(send)).toEqual([b.title]);
    expect((await rows([a.id, b.id])).map((r) => [r.courseId, r.status])).toEqual([[b.id, "sent"]]);

    await publish(a.id);
    expect(await job(t(17), [a.id, b.id])).toMatchObject({ created: 1 });
    expect(await job(t(33), [a.id, b.id])).toMatchObject({ queued: 1 });
    const again = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send: again });
    expect(titlesSent(again)).toEqual([a.title]);
  });

  it("mellom kø og behandler, tom liste: fjernet fra klassen → ingen e-post, raden slettes", async () => {
    const t = clock();
    const c = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    await job(t(16), [c.id]);
    await removeMember(classId, u.id);
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send });
    expect(send).not.toHaveBeenCalled();
    expect(await rows([c.id])).toEqual([]);
  });

  it("de som har sluttet eller er anonymisert, får ingen rad og ingen e-post. En som blir aktiv igjen, får e-post om kurs fra mens hen var borte, men ikke om `baseline`-kurs (vei 4)", async () => {
    const t = clock();
    const before1142 = await course();
    const fresh = await course();
    const ids = [before1142.id, fresh.id];
    const active = await person();
    const left = await person({ activeStatus: false });
    const anonymized = await person({ isAnonymized: true });
    const classId = await newClass();
    for (const u of [active, left, anonymized]) await addMember(classId, u.id);
    await assign(classId, before1142.id);
    // Kurset hen hadde før #1142 (det migreringen ga `baseline`). Lages direkte: migreringen er testet for seg.
    await prisma.courseAssignmentNotice.create({ data: { userId: left.id, courseId: before1142.id, status: "baseline", reason: "before_1142" } });
    await assign(classId, fresh.id);

    await job(t(0), ids);
    expect((await rows(ids)).filter((r) => r.status !== "baseline").map((r) => r.userId).sort()).toEqual([active.id, active.id]);

    await prisma.user.update({ where: { id: left.id }, data: { activeStatus: true } });
    expect(await job(t(1), ids)).toMatchObject({ created: 1 });
    expect(await job(t(17), ids)).toMatchObject({ queued: 2 });
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(left.id), { send });
    expect(titlesSent(send)).toEqual([fresh.title]);
    expect(await eventsFor(anonymized.id)).toEqual([]);
  });

  // #1146 (produkteier 2026-11-10, svar 1): fjernet og lagt til igjen ETTER sending gir nå én ny e-post (før: ingen).
  it("fjernet og lagt til igjen ETTER sending: én ny e-post (#1146). Fjernet FØR sending og lagt til igjen: én e-post", async () => {
    const t = clock();
    const c = await course();
    const afterSend = await person();
    const beforeSend = await person();
    const classId = await newClass();
    await addMember(classId, afterSend.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    await job(t(16), [c.id]);
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(afterSend.id), { send });
    expect(send).toHaveBeenCalledTimes(1);

    await removeMember(classId, afterSend.id);
    await addMember(classId, afterSend.id);
    await addMember(classId, beforeSend.id);
    expect(await job(t(20), [c.id])).toMatchObject({ created: 1, reset: 1 });
    await removeMember(classId, beforeSend.id);
    // Den tilbakestilte raden (vinduet fra t(20)) samles; den som ble fjernet før sending, slettes.
    expect(await job(t(36), [c.id])).toMatchObject({ queued: 1, removed: 1 });
    await deliverCourseAssignmentDigest(await latestBatch(afterSend.id), { send });
    await addMember(classId, beforeSend.id);
    expect(await job(t(37), [c.id])).toMatchObject({ created: 1, reset: 0 });
    expect(await job(t(53), [c.id])).toMatchObject({ queued: 1 });
    await deliverCourseAssignmentDigest(await latestBatch(beforeSend.id), { send });
    expect(await job(t(120), [c.id])).toMatchObject({ created: 0, reset: 0, queued: 0 });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([input]) => input.userId)).toEqual([afterSend.id, afterSend.id, beforeSend.id]);
    expect((await rows([c.id])).map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("kurs i to klasser: én linje, begge klassene, den tidligste fristen. En arkivert klasse er ikke med", async () => {
    const t = clock();
    const c = await course();
    const u = await person();
    const bravo = await newClass(`Bravo ${RUN}`);
    const alfa = await newClass(`Alfa ${RUN}`);
    const archived = await newClass(`Arkivert ${RUN}`);
    for (const [classId, dueAt] of [[bravo, "2030-05-01T00:00:00.000Z"], [alfa, "2030-03-01T00:00:00.000Z"], [archived, "2030-01-01T00:00:00.000Z"]] as const) {
      await addMember(classId, u.id);
      await assign(classId, c.id, dueAt);
    }
    await post(`/api/admin/content/classes/${archived}/archive`);
    expect(await job(t(0), [c.id])).toMatchObject({ created: 1 });
    await job(t(16), [c.id]);

    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send });
    const [course1] = send.mock.calls[0]![0].courses;
    expect(sorted(course1!.classNames)).toEqual([`Alfa ${RUN}`, `Bravo ${RUN}`]);
    expect(course1!.dueAt?.toISOString()).toBe("2030-03-01T00:00:00.000Z");

    // Den ekte e-posten: én linje, klassene sortert, fristen.
    await prisma.courseAssignmentNotice.updateMany({ where: { courseId: c.id }, data: { status: "queued" } });
    await deliverCourseAssignmentDigest(await latestBatch(u.id));
    const text = mailsTo(u.email)[0].content.plainText as string;
    const lines = text.split("\n").filter((line) => line.startsWith("• "));
    expect(lines).toEqual([`• «${c.title}» – fra klassene «Alfa ${RUN}» og «Bravo ${RUN}», frist 1. mars 2030`]);
  });

  it("klasser fra Entra og «Alle deltakere» gir ingen rad og ingen e-post", async () => {
    const t = clock();
    const c = await course();
    const u = await person();
    // Tildeling til systemklassen gjennom ruta: kurset står i «Mine kurs» for alle deltakere, men gir ingen rad.
    await assign(SYSTEM_ALL_PARTICIPANTS_CLASS_ID, c.id);
    try {
      const entra = await prisma.class.create({ data: { name: tag("entra"), kind: "ENTRA", entraGroupId: `gruppe-${RUN}-${seq++}` }, select: { id: true } });
      await prisma.classMember.create({ data: { classId: entra.id, userId: u.id } });
      await prisma.courseGroupAssignment.create({ data: { classId: entra.id, courseId: c.id } });
      expect(await job(t(0), [c.id])).toMatchObject({ created: 0 });
      expect(await job(t(70), [c.id])).toMatchObject({ queued: 0 });
      expect(await rows([c.id])).toEqual([]);
      // Kontroll: samme klasse som vanlig klasse gir raden.
      await prisma.class.update({ where: { id: entra.id }, data: { kind: "MANUAL", entraGroupId: null } });
      expect(await job(t(71), [c.id])).toMatchObject({ created: 1 });
    } finally {
      await unassign(SYSTEM_ALL_PARTICIPANTS_CLASS_ID, c.id);
    }
  });
});

describe("#1142 skive 3 — vinduet og tempoet", () => {
  it("sikkerhetsnettet: et nytt kurs hvert tiende minutt gir likevel e-post når den eldste raden er 60 minutter", async () => {
    const t = clock();
    const courses: Array<{ id: string; title: string }> = [];
    for (let i = 0; i < 7; i += 1) courses.push(await course());
    const ids = courses.map((c) => c.id);
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    for (let i = 0; i < 6; i += 1) {
      await assign(classId, courses[i]!.id);
      expect(await job(t(i * 10), ids)).toMatchObject({ created: 1, queued: 0 });
    }
    expect(await job(t(59), ids)).toMatchObject({ queued: 0 });
    await assign(classId, courses[6]!.id);
    expect(await job(t(60), ids)).toMatchObject({ created: 1, queued: 1 });
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send });
    expect(titlesSent(send)).toEqual(sorted(courses.map((c) => c.title)));
  });

  it(`høyst ${COURSE_ASSIGNMENT_EMAIL_PER_RUN} samlinger per runde, med tre sekunder imellom; resten i neste runde`, async () => {
    const t = clock();
    const c = await course();
    const classId = await newClass();
    const people = [];
    for (let i = 0; i < COURSE_ASSIGNMENT_EMAIL_PER_RUN + 3; i += 1) {
      const u = await person();
      await addMember(classId, u.id);
      people.push(u);
    }
    await assign(classId, c.id);
    expect(await job(t(0), [c.id])).toMatchObject({ created: 23 });
    expect(await job(t(16), [c.id])).toMatchObject({ queued: 20, deferred: 3 });
    const firstRound = (await Promise.all(people.map((u) => eventsFor(u.id)))).flat().sort((x, y) => x.availableAt.getTime() - y.availableAt.getTime());
    expect(firstRound).toHaveLength(20);
    expect(firstRound.map((e) => e.availableAt.getTime() - t(16).getTime())).toEqual(Array.from({ length: 20 }, (_, i) => i * COURSE_ASSIGNMENT_EMAIL_SPACING_MS));
    expect(await job(t(17), [c.id])).toMatchObject({ queued: 3, deferred: 0 });
  });
});

describe("#1142 skive 3 — ingen dobbel e-post", () => {
  async function queuedFor(count = 1) {
    const t = clock();
    const courses = [];
    for (let i = 0; i < count; i += 1) courses.push(await course());
    const ids = courses.map((c) => c.id);
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    for (const c of courses) await assign(classId, c.id);
    await job(t(0), ids);
    expect(await job(t(16), ids)).toMatchObject({ queued: 1 });
    return { t, ids, u, classId, batchId: await latestBatch(u.id) };
  }

  it("samme samling levert to ganger: sendt én gang", async () => {
    const q = await queuedFor(2);
    const send = okSend();
    await deliverCourseAssignmentDigest(q.batchId, { send });
    await deliverCourseAssignmentDigest(q.batchId, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rows(q.ids)).every((r) => r.status === "sent" && r.sentAt !== null)).toBe(true);
  });

  it("to forsøk samtidig på samme samling: e-posten sendes én gang", async () => {
    const q = await queuedFor(1);
    const slow = vi.fn<CourseAssignmentDigestSend>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { delivered: true, channel: "log", subject: "", nextStepGuidance: "" };
    });
    await Promise.all([deliverCourseAssignmentDigest(q.batchId, { send: slow }), deliverCourseAssignmentDigest(q.batchId, { send: slow })]);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("rader i `sending` (workeren startet på nytt midt i): `uncertain`, ingen e-post", async () => {
    const q = await queuedFor(2);
    await prisma.courseAssignmentNotice.updateMany({ where: { batchId: q.batchId }, data: { status: "sending", sendingAt: new Date() } });
    const send = okSend();
    await deliverCourseAssignmentDigest(q.batchId, { send });
    expect(send).not.toHaveBeenCalled();
    expect((await rows(q.ids)).map((r) => [r.status, r.reason])).toEqual([["uncertain", "interrupted"], ["uncertain", "interrupted"]]);
  });

  it("to samlinger samtidig for samme person (to workere): én samling, én hendelse", async () => {
    const t = clock();
    const c = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    const input = { now: t(16), availableAt: t(16), onlyCourseIds: [c.id] };
    const [first, second] = await Promise.all([collectPersonDigest(u.id, input), collectPersonDigest(u.id, input)]);
    expect([first.batchId, second.batchId].filter(Boolean)).toHaveLength(1);
    expect(await eventsFor(u.id)).toHaveLength(1);
  });

  it("samlingen sjekker vinduet på nytt under låsen: rader som kom etter at jobben fant personen, venter", async () => {
    const t = clock();
    const c = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    const early = await collectPersonDigest(u.id, { now: t(5), availableAt: t(5), onlyCourseIds: [c.id] });
    expect(early).toEqual({ batchId: null, courseIds: [], removed: 0 });
    expect((await rows([c.id])).map((r) => r.status)).toEqual(["waiting"]);
    expect((await collectPersonDigest(u.id, { now: t(15), availableAt: t(15), onlyCourseIds: [c.id] })).courseIds).toEqual([c.id]);
  });

  it("personlåsen: samlingen venter på en annen transaksjon som holder låsen for personen", async () => {
    const t = clock();
    const c = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = runInTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${COURSE_ASSIGNMENT_PERSON_LOCK_NAMESPACE}::int, hashtext(${u.id}))`;
      locked();
      await released;
    });
    await isLocked;
    let done = false;
    const collecting = collectPersonDigest(u.id, { now: t(16), availableAt: t(16), onlyCourseIds: [c.id] }).then((result) => {
      done = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(done, "samlingen skal vente på låsen").toBe(false);
    expect(await eventsFor(u.id)).toEqual([]);
    release();
    await holder;
    expect((await collecting).batchId).not.toBeNull();
  });

  it("`queued` i over 2 timer (hendelsen er borte): ny samling, og den gamle hendelsen sender ingenting", async () => {
    const q = await queuedFor(1);
    expect(await job(q.t(16 + 119), q.ids)).toMatchObject({ requeued: 0, queued: 0 });
    expect(await job(q.t(16 + 121), q.ids)).toMatchObject({ requeued: 1, queued: 1 });
    const fresh = await latestBatch(q.u.id);
    expect(fresh).not.toBe(q.batchId);
    const send = okSend();
    await deliverCourseAssignmentDigest(q.batchId, { send });
    expect(send).not.toHaveBeenCalled();
    await deliverCourseAssignmentDigest(fresh, { send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("tilbakerulling: en gammel worker brukte opp hendelsen («Unknown outbox event type», fem forsøk). Radene står i `queued` og sendes i en ny samling etter 2 timer", async () => {
    const q = await queuedFor(2);
    const [event] = await eventsFor(q.u.id);
    await prisma.outboxEvent.update({ where: { id: event!.id }, data: { status: "failed", attempts: 5, lastError: "Unknown outbox event type: course_assignment_digest" } });
    expect((await rows(q.ids)).map((r) => r.status)).toEqual(["queued", "queued"]);
    expect(await job(q.t(16 + 121), q.ids)).toMatchObject({ requeued: 2, queued: 1 });
    const send = okSend();
    await deliverCourseAssignmentDigest(q.batchId, { send });
    expect(send).not.toHaveBeenCalled();
    await deliverCourseAssignmentDigest(await latestBatch(q.u.id), { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].courses).toHaveLength(2);
  });

  it("Codex runde 1 nr. 3: en rad som sto over 30 min i `queued`, blir ikke `uncertain` mens den sendes; en sikker feil gir nytt forsøk", async () => {
    const q = await queuedFor(1);
    // `queuedAt` er tolv timer tilbake. Ryddingen kjører med klokka nå, mens `send` holdes åpen.
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    let started!: () => void;
    const isSending = new Promise<void>((resolve) => (started = resolve));
    const rejected = vi.fn<CourseAssignmentDigestSend>(async () => {
      started();
      await gate;
      return { delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", failureReason: "acs_400" };
    });
    const delivering = deliverCourseAssignmentDigest(q.batchId, { send: rejected });
    await isSending;
    expect(await runCourseAssignmentEmailSchedule({ now: new Date(), onlyCourseIds: q.ids })).toMatchObject({ uncertain: 0 });
    expect((await rows(q.ids)).map((r) => r.status)).toEqual(["sending"]);
    finish();
    await expect(delivering).rejects.toThrow(/not delivered: acs_400/);
    // #1146: e-posten gikk ikke, så personen er ikke varslet: `settledAt` er tom igjen (som for alle rader som venter).
    expect((await rows(q.ids)).map((r) => [r.status, r.reason, r.settledAt])).toEqual([["queued", "acs_400", null]]);
    const send = okSend();
    await deliverCourseAssignmentDigest(q.batchId, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await rows(q.ids)).map((r) => r.status)).toEqual(["sent"]);
  });

  it("en rad som har stått i `sending` i over 30 minutter uten nytt forsøk, blir `uncertain` av ryddingen (målt fra behandlerens `sendingAt`)", async () => {
    const q = await queuedFor(1);
    // Behandleren tar radene og blir aldri ferdig (workeren stoppet midt i sendingen). Ryddingen måler fra `sendingAt`, som
    // behandleren selv satte, ikke fra et tidspunkt testen skrev inn.
    let finish!: () => void;
    const never = new Promise<void>((resolve) => (finish = resolve));
    let started!: () => void;
    const isSending = new Promise<void>((resolve) => (started = resolve));
    const hanging = vi.fn<CourseAssignmentDigestSend>(async () => {
      started();
      await never;
      return { delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", failureReason: "timeout", ambiguous: true };
    });
    const delivering = deliverCourseAssignmentDigest(q.batchId, { send: hanging });
    await isSending;
    const [row] = await rows(q.ids);
    expect(row!.status).toBe("sending");
    expect(row!.sendingAt, "overgangen setter `sendingAt`").not.toBeNull();
    expect(Math.abs(row!.sendingAt!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await runCourseAssignmentEmailSchedule({ now: new Date(Date.now() + 29 * 60_000), onlyCourseIds: q.ids })).toMatchObject({ uncertain: 0 });
    expect(await runCourseAssignmentEmailSchedule({ now: new Date(Date.now() + 31 * 60_000), onlyCourseIds: q.ids })).toMatchObject({ uncertain: 1 });
    expect((await rows(q.ids)).map((r) => [r.status, r.reason])).toEqual([["uncertain", "interrupted"]]);
    finish();
    await delivering;
  });
});

describe("#1142 skive 3 — utfallet av sendingen", () => {
  async function queuedFor() {
    const t = clock();
    const c = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    await job(t(16), [c.id]);
    return { t, ids: [c.id], u, batchId: await latestBatch(u.id) };
  }
  const result = (extra: Record<string, unknown>) => vi.fn<CourseAssignmentDigestSend>(async () => ({ delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", ...extra }));

  it("kanalen av: ingenting sendt, radene tilbake til `waiting` uten samling", async () => {
    const q = await queuedFor();
    await deliverCourseAssignmentDigest(q.batchId, { send: result({ channel: "disabled", failureReason: "channel_disabled" }) });
    expect((await rows(q.ids)).map((r) => [r.status, r.batchId, r.queuedAt, r.reason])).toEqual([["waiting", null, null, "channel_disabled"]]);
  });

  it("avbrutt underveis → `uncertain`; sikker feil → `queued` og nytt forsøk; siste forsøk → `failed`", async () => {
    const a = await queuedFor();
    await deliverCourseAssignmentDigest(a.batchId, { send: result({ failureReason: "timeout", ambiguous: true }) });
    expect((await rows(a.ids)).map((r) => [r.status, r.reason])).toEqual([["uncertain", "timeout"]]);

    const b = await queuedFor();
    await expect(deliverCourseAssignmentDigest(b.batchId, { send: result({ failureReason: "acs_400" }), lastAttempt: true })).rejects.toThrow(/acs_400/);
    expect((await rows(b.ids)).map((r) => [r.status, r.reason])).toEqual([["failed", "acs_400"]]);
  });

  it("en tekst som ligner en lenke malen ikke fikk gjort ufarlig: `failed` (`contains_link`), ikke prøvd igjen", async () => {
    const q = await queuedFor();
    const send = vi.fn<CourseAssignmentDigestSend>(async () => {
      throw new EmailContainsLinkError("html");
    });
    await deliverCourseAssignmentDigest(q.batchId, { send });
    expect((await rows(q.ids)).map((r) => [r.status, r.reason])).toEqual([["failed", "contains_link"]]);
  });

  it("en feil i oppslagene før sendingen: radene står i `queued`; på siste forsøk tilbake til `waiting`, og jobben samler dem på nytt", async () => {
    const q = await queuedFor();
    const send = okSend();
    // Ingen `mockRestore`: på en Prisma-modell fjerner den funksjonen. Spionens egen gjennomgang ga `undefined` tilbake for
    // `findMany` (målt 2026-11-09), så de to første kallene feiler og resten går til funksjonen, bundet til modellen.
    const findMany = prisma.courseGroupAssignment.findMany.bind(prisma.courseGroupAssignment);
    let failures = 2;
    vi.spyOn(prisma.courseGroupAssignment, "findMany").mockImplementation(((args: Parameters<typeof findMany>[0]) =>
      failures-- > 0 ? Promise.reject(new Error("database borte")) : findMany(args)) as never);
    await expect(deliverCourseAssignmentDigest(q.batchId, { send })).rejects.toThrow("database borte");
    expect((await rows(q.ids)).map((r) => r.status)).toEqual(["queued"]);

    await expect(deliverCourseAssignmentDigest(q.batchId, { send, lastAttempt: true })).rejects.toThrow("database borte");
    expect((await rows(q.ids)).map((r) => [r.status, r.batchId])).toEqual([["waiting", null]]);
    expect(send).not.toHaveBeenCalled();

    expect(await job(q.t(30), q.ids)).toMatchObject({ queued: 1 });
    await deliverCourseAssignmentDigest(await latestBatch(q.u.id), { send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("gjennom outboxen: den ekte e-posten på mottakerens språk", async () => {
    const q = await queuedFor();
    await prisma.user.update({ where: { id: q.u.id }, data: { preferredLocale: "en-GB" } });
    await deliverThroughOutbox(q.batchId);
    const [mail] = mailsTo(q.u.email);
    expect(mail.content.subject).toMatch(/^You have a new course: «/);
    expect((await rows(q.ids)).map((r) => r.status)).toEqual(["sent"]);
  });
});

// #1146 (doc/design/PLAN_1146.md): kurset kommer tilbake. Personen får e-post igjen når ALLE åpne veier til kurset (klasse,
// medlemskap, tildeling) er nyere enn `settledAt`, tidspunktet hen sist ble varslet. Veiene har ekte tid (rutene), og
// `settledAt` settes av databasen; jobbens klokke (tolv timer tilbake) styrer bare vinduet (planreview R1).
describe("#1146 — et kurs som legges til igjen, gir e-post", () => {
  /** Ett medlem, ett kurs, sendt. Gir tilbake det testen trenger for å fjerne og legge til igjen. */
  async function sentOnce() {
    const t = clock();
    const c = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    expect(await job(t(16), [c.id])).toMatchObject({ queued: 1 });
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send });
    expect(send).toHaveBeenCalledTimes(1);
    return { t, c, u, classId, send };
  }

  it("kurset fjernet og lagt inn igjen med frist etter sending: én ny e-post med fristen; en runde til gir ingen (ingen løkke)", async () => {
    const s = await sentOnce();
    await unassign(s.classId, s.c.id);
    await assign(s.classId, s.c.id, "2026-12-31T12:00:00.000Z");
    expect(await job(s.t(30), [s.c.id])).toMatchObject({ reset: 1, created: 0 });
    const [row] = await rows([s.c.id]);
    expect(row).toMatchObject({ status: "waiting", reason: "re_added", settledAt: null, batchId: null, sentAt: null });
    expect(await job(s.t(46), [s.c.id])).toMatchObject({ queued: 1 });
    await deliverCourseAssignmentDigest(await latestBatch(s.u.id), { send: s.send });
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send.mock.calls[1]![0].courses[0]!.dueAt?.toISOString()).toBe("2026-12-31T12:00:00.000Z");
    expect(await job(s.t(120), [s.c.id])).toMatchObject({ reset: 0, created: 0, queued: 0 });
    expect(await job(s.t(240), [s.c.id])).toMatchObject({ reset: 0 });
  });

  it("ny frist på en tildeling som står: ingen e-post", async () => {
    const s = await sentOnce();
    await assign(s.classId, s.c.id, "2027-01-15T12:00:00.000Z");
    expect(await job(s.t(30), [s.c.id])).toMatchObject({ reset: 0, created: 0 });
  });

  it("planreview B2: fjernet og lagt inn igjen INNENFOR vinduet (før sending), og medlem flyttet fra A til B innenfor vinduet: én e-post, også etter flere runder", async () => {
    const t = clock();
    const c = await course();
    const readded = await person();
    const moved = await person();
    const a = await newClass();
    const b = await newClass();
    await addMember(a, readded.id);
    await addMember(a, moved.id);
    await assign(a, c.id);
    await assign(b, c.id);
    await job(t(0), [c.id]);
    // Innenfor vinduet: tildelingen fjernes og legges inn igjen (ny `createdAt`), og den ene flyttes fra A til B.
    await unassign(a, c.id);
    await assign(a, c.id, "2026-12-31T12:00:00.000Z");
    await removeMember(a, moved.id);
    await addMember(b, moved.id);
    expect(await job(t(16), [c.id])).toMatchObject({ queued: 2, reset: 0 });
    const send = okSend();
    await deliverCourseAssignmentDigest(await latestBatch(readded.id), { send });
    await deliverCourseAssignmentDigest(await latestBatch(moved.id), { send });
    expect(send).toHaveBeenCalledTimes(2);
    for (const at of [30, 60, 240]) expect(await job(t(at), [c.id])).toMatchObject({ reset: 0, created: 0, queued: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("svar 2: kurset lagt til klasse B mens personen har det fra A gir ingen e-post; fjern A mens B står: ingen; fjern B og legg til A igjen: én", async () => {
    const s = await sentOnce();
    const b = await newClass();
    await addMember(b, s.u.id);
    await assign(b, s.c.id);
    expect(await job(s.t(30), [s.c.id])).toMatchObject({ reset: 0 });
    await unassign(s.classId, s.c.id);
    expect(await job(s.t(31), [s.c.id])).toMatchObject({ reset: 0 });
    await unassign(b, s.c.id);
    await assign(s.classId, s.c.id);
    expect(await job(s.t(32), [s.c.id])).toMatchObject({ reset: 1 });
  });

  it("svar 1: medlem fjernet fra klassen og lagt til igjen etter sending gir én e-post", async () => {
    const s = await sentOnce();
    await removeMember(s.classId, s.u.id);
    await addMember(s.classId, s.u.id);
    expect(await job(s.t(30), [s.c.id])).toMatchObject({ reset: 1 });
  });

  it("`baseline` (hadde kurset før #1142) og kurset lagt inn igjen: én e-post. `baseline` uten `settledAt` (gamle testdata) røres ikke", async () => {
    const c = await course();
    const withSettled = await person();
    const withoutSettled = await person();
    const classId = await newClass();
    await addMember(classId, withSettled.id);
    await addMember(classId, withoutSettled.id);
    await assign(classId, c.id);
    await prisma.courseAssignmentNotice.create({ data: { userId: withSettled.id, courseId: c.id, status: "baseline", reason: "before_1142", settledAt: new Date() } });
    await prisma.courseAssignmentNotice.create({ data: { userId: withoutSettled.id, courseId: c.id, status: "baseline", reason: "before_1142" } });
    const t = clock();
    expect(await job(t(0), [c.id])).toMatchObject({ created: 0, reset: 0 });
    await unassign(classId, c.id);
    await assign(classId, c.id);
    expect(await job(t(1), [c.id])).toMatchObject({ reset: 1 });
    expect((await rows([c.id])).find((r) => r.userId === withSettled.id)?.status).toBe("waiting");
  });

  it("kurset avpublisert eller klassen arkivert når det legges inn igjen: ingen tilbakestilling før det er publisert igjen", async () => {
    const s = await sentOnce();
    await unassign(s.classId, s.c.id);
    await assign(s.classId, s.c.id);
    await unpublish(s.c.id);
    expect(await job(s.t(30), [s.c.id])).toMatchObject({ reset: 0 });
    await publish(s.c.id);
    expect(await job(s.t(31), [s.c.id])).toMatchObject({ reset: 1 });
  });

  it("rader i `waiting`, `queued` og `sending` røres ikke, selv om kurset legges inn igjen", async () => {
    const t = clock();
    const c = await course();
    const users = [await person(), await person(), await person()];
    const classId = await newClass();
    for (const u of users) await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    const [w, q, s] = users;
    await prisma.courseAssignmentNotice.updateMany({ where: { userId: q!.id, courseId: c.id }, data: { status: "queued", batchId: `b-${RUN}-${seq++}`, queuedAt: new Date() } });
    await prisma.courseAssignmentNotice.updateMany({ where: { userId: s!.id, courseId: c.id }, data: { status: "sending", batchId: `b-${RUN}-${seq++}`, sendingAt: new Date(), settledAt: new Date(Date.now() - 60_000) } });
    await unassign(classId, c.id);
    await assign(classId, c.id);
    expect(await job(t(1), [c.id])).toMatchObject({ reset: 0 });
    const byUser = new Map((await rows([c.id])).map((r) => [r.userId, r.status]));
    expect([byUser.get(w!.id), byUser.get(q!.id), byUser.get(s!.id)]).toEqual(["waiting", "queued", "sending"]);
  });

  it("`failed` (`contains_link`) settes tilbake én gang når kurset legges inn igjen, og går ikke i ring", async () => {
    const t = clock();
    const c = await course();
    const u = await person();
    const classId = await newClass();
    await addMember(classId, u.id);
    await assign(classId, c.id);
    await job(t(0), [c.id]);
    await job(t(16), [c.id]);
    const linky = vi.fn<CourseAssignmentDigestSend>(async () => { throw new EmailContainsLinkError("lenke"); });
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send: linky });
    expect((await rows([c.id]))[0]).toMatchObject({ status: "failed", reason: "contains_link" });
    await unassign(classId, c.id);
    await assign(classId, c.id);
    expect(await job(t(30), [c.id])).toMatchObject({ reset: 1 });
    await job(t(46), [c.id]);
    await deliverCourseAssignmentDigest(await latestBatch(u.id), { send: linky });
    for (const at of [60, 120]) expect(await job(t(at), [c.id])).toMatchObject({ reset: 0, queued: 0 });
    expect(linky).toHaveBeenCalledTimes(2);
  });

  it("to runder samtidig (to workere): raden settes tilbake én gang", async () => {
    const s = await sentOnce();
    await unassign(s.classId, s.c.id);
    await assign(s.classId, s.c.id);
    const [first, second] = await Promise.all([job(s.t(30), [s.c.id]), job(s.t(30), [s.c.id])]);
    expect(first.reset + second.reset).toBe(1);
  });

  describe("kursbevis og hovedversjon (vilkår 8 og 9, planreview B1)", () => {
    /** Kurset får hovedversjon 2 NÅ: raden i `CourseVersion` og `versionMajor` på kurset, som `courseVersioning.ts` gjør. */
    async function newMajor(courseId: string) {
      await prisma.courseVersion.create({ data: { courseId, versionMajor: 2, publishedAt: new Date(), sectionVersionsJson: "{}" } });
      await prisma.course.update({ where: { id: courseId }, data: { versionMajor: 2 } });
    }
    const certificate = (userId: string, courseId: string, versionMajor: number) =>
      prisma.courseCompletion.create({ data: { userId, courseId, versionMajor, moduleSnapshotJson: "[]" } });

    it("kursbevis på v1 og i klassen fra før, så v2: ingen rad (bare e-posten fra #934)", async () => {
      const t = clock();
      const c = await course();
      const u = await person();
      const classId = await newClass();
      await addMember(classId, u.id);
      await assign(classId, c.id);
      await certificate(u.id, c.id, 1);
      await newMajor(c.id);
      expect(await job(t(0), [c.id])).toMatchObject({ created: 0, reset: 0 });
    });

    it("kursbevis på v1, og kurset lagt til klassen etter v2: e-post, også om hen har lest i kurset", async () => {
      const t = clock();
      const c = await course();
      const u = await person();
      const classId = await newClass();
      await addMember(classId, u.id);
      await certificate(u.id, c.id, 1);
      const section = await prisma.courseItem.findFirstOrThrow({ where: { courseId: c.id, itemType: "SECTION" }, select: { sectionId: true } });
      await prisma.courseSectionRead.create({ data: { userId: u.id, courseId: c.id, sectionId: section.sectionId! } });
      await newMajor(c.id);
      await assign(classId, c.id);
      expect(await job(t(0), [c.id])).toMatchObject({ created: 1 });
    });

    it("kursbevis på kursets hovedversjon: ingen rad, heller ikke når kurset legges til etter v2", async () => {
      const t = clock();
      const c = await course();
      const u = await person();
      const classId = await newClass();
      await addMember(classId, u.id);
      await newMajor(c.id);
      await certificate(u.id, c.id, 2);
      await assign(classId, c.id);
      expect(await job(t(0), [c.id])).toMatchObject({ created: 0 });
    });

    it("kursbevis på v1, klassen arkivert før v2 og gjenopprettet etter: ingen e-post (veien er gammel)", async () => {
      const t = clock();
      const c = await course();
      const u = await person();
      const classId = await newClass();
      await addMember(classId, u.id);
      await assign(classId, c.id);
      await certificate(u.id, c.id, 1);
      await prisma.class.update({ where: { id: classId }, data: { archivedAt: new Date() } });
      await newMajor(c.id);
      await prisma.class.update({ where: { id: classId }, data: { archivedAt: null } });
      expect(await job(t(0), [c.id])).toMatchObject({ created: 0 });
    });

    it("påbegynt uten kursbevis: ingen rad, også når kurset legges inn igjen", async () => {
      const t = clock();
      const c = await course();
      const u = await person();
      const classId = await newClass();
      await addMember(classId, u.id);
      const section = await prisma.courseItem.findFirstOrThrow({ where: { courseId: c.id, itemType: "SECTION" }, select: { sectionId: true } });
      await prisma.courseSectionRead.create({ data: { userId: u.id, courseId: c.id, sectionId: section.sectionId! } });
      await assign(classId, c.id);
      expect(await job(t(0), [c.id])).toMatchObject({ created: 0 });
      await unassign(classId, c.id);
      await assign(classId, c.id);
      expect(await job(t(1), [c.id])).toMatchObject({ created: 0, reset: 0 });
    });
  });
});
