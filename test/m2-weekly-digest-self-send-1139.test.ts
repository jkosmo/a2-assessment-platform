import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";
import { sendWeeklyDigestToSelf, WEEKLY_DIGEST_SELF_SEND_ID, type WeeklyDigestSend } from "../src/modules/weeklyDigest/weeklyDigestJob.js";

// #1139: «Send ukens e-post til meg nå» på administratorsiden (produkteier 2026-11-11). Gjennom ruta, som siden bruker, og
// tjenesten med `send` byttet ut der testen må se hvem e-posten gikk til.

const mutableEnv = env as unknown as Record<string, unknown>;
const original = { enabled: env.WEEKLY_EMAIL_ENABLED, recipients: env.WEEKLY_EMAIL_RECIPIENTS };
beforeEach(() => {
  // Jobben er av og lista tom: knappen skal virke likevel.
  mutableEnv.WEEKLY_EMAIL_ENABLED = false;
  mutableEnv.WEEKLY_EMAIL_RECIPIENTS = "";
});
afterEach(() => {
  mutableEnv.WEEKLY_EMAIL_ENABLED = original.enabled;
  mutableEnv.WEEKLY_EMAIL_RECIPIENTS = original.recipients;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `selvsend1139 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const headersFor = (role: string) => {
  const id = `selvsend1139-${RUN}-${seq++}`;
  return { "x-user-id": id, "x-user-email": `${id}@x.test`, "x-user-name": "Person", "x-user-roles": role };
};

async function userIdOf(headers: Record<string, string>) {
  await request(app).get("/api/me").set(headers);
  return (await prisma.user.findUniqueOrThrow({ where: { externalId: headers["x-user-id"] }, select: { id: true } })).id;
}

/** Personen i en klasse med et publisert kurs: noe utestående (tildelt, ikke påbegynt). */
async function giveOutstanding(admin: Record<string, string>, userId: string) {
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const version = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  const course = await prisma.course.create({
    data: { title: L(tag("kurs")), enrollmentPolicy: "RESTRICTED", publishedAt: new Date(), items: { create: [{ itemType: "SECTION", sectionId: section.id, sortOrder: 0 }] } },
    select: { id: true },
  });
  const created = await request(app).post("/api/admin/content/classes").set(admin).send({ name: tag("klasse") });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const classId = created.body.class.id as string;
  expect((await request(app).post(`/api/admin/content/classes/${classId}/members`).set(admin).send({ userId })).status).toBe(201);
  expect((await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId: course.id })).status).toBe(201);
}

const okSend = () => vi.fn<WeeklyDigestSend>(async () => ({ delivered: true, channel: "log", subject: "", nextStepGuidance: "" }));

describe("#1139: ukens e-post til administratoren selv", () => {
  it("sender med en gang, også med jobben av, tom liste og bryteren av; ingen rad, så mandagen går som før", async () => {
    const admin = headersFor("ADMINISTRATOR");
    const adminId = await userIdOf(admin);
    await giveOutstanding(admin, adminId);
    await prisma.user.update({ where: { id: adminId }, data: { weeklyEmailEnabled: false } });

    const response = await request(app).post("/api/admin/platform/weekly-email/send-to-me").set(admin).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({ sent: true });
    expect(await prisma.weeklyDigest.count({ where: { userId: adminId } })).toBe(0);
  });

  it("alltid til egen adresse: en bruker-id i kroppen brukes ikke", async () => {
    const admin = headersFor("ADMINISTRATOR");
    const adminId = await userIdOf(admin);
    const other = headersFor("PARTICIPANT");
    const otherId = await userIdOf(other);
    await giveOutstanding(admin, adminId);
    await giveOutstanding(admin, otherId);

    // Ruta leser ikke kroppen; tjenesten får bare den innloggede.
    expect((await request(app).post("/api/admin/platform/weekly-email/send-to-me").set(admin).send({ userId: otherId })).body).toEqual({ sent: true });
    const send = okSend();
    expect(await sendWeeklyDigestToSelf(adminId, { send })).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ digestId: WEEKLY_DIGEST_SELF_SEND_ID, userId: adminId, recipientEmail: admin["x-user-email"] });
  });

  it("ingenting utestående → ikke sendt, med grunnen", async () => {
    const admin = headersFor("ADMINISTRATOR");
    await userIdOf(admin);
    const response = await request(app).post("/api/admin/platform/weekly-email/send-to-me").set(admin);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: false, reason: "nothing_outstanding" });
  });

  it("ikke levert (kanalen av, feil) → `not_delivered`, og ingen rad", async () => {
    const admin = headersFor("ADMINISTRATOR");
    const adminId = await userIdOf(admin);
    await giveOutstanding(admin, adminId);
    const send = vi.fn<WeeklyDigestSend>(async () => ({ delivered: false, channel: "disabled", subject: "", nextStepGuidance: "", failureReason: "channel_disabled" }));
    expect(await sendWeeklyDigestToSelf(adminId, { send })).toEqual({ sent: false, reason: "not_delivered", detail: "channel_disabled" });
    expect(await prisma.weeklyDigest.count({ where: { userId: adminId } })).toBe(0);
  });

  it("avbrutt underveis (kan ha gått) → `uncertain`, ikke «ikke sendt»", async () => {
    const admin = headersFor("ADMINISTRATOR");
    const adminId = await userIdOf(admin);
    await giveOutstanding(admin, adminId);
    const send = vi.fn<WeeklyDigestSend>(async () => ({ delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", failureReason: "timeout", ambiguous: true }));
    expect(await sendWeeklyDigestToSelf(adminId, { send })).toEqual({ sent: false, reason: "uncertain", detail: "timeout" });
  });

  it("bare administrator: deltaker og fagansvarlig får 403", async () => {
    for (const role of ["PARTICIPANT", "SUBJECT_MATTER_OWNER"]) {
      const response = await request(app).post("/api/admin/platform/weekly-email/send-to-me").set(headersFor(role));
      expect(response.status, role).toBe(403);
    }
  });
});
