import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";
import {
  deliverWeeklyDigest,
  isInWeeklyDigestWindow,
  runWeeklyDigestSchedule,
  WEEKLY_DIGEST_SPACING_MS,
  weeklyDigestSendStart,
  type WeeklyDigestSend,
} from "../src/modules/weeklyDigest/weeklyDigestJob.js";
import { EmailContainsLinkError } from "../src/modules/certification/illustratedEmail.js";
import { OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";

// #1139 skive 3 (doc/design/PLAN_1139.md, punkt 6-9 og 12): jobben og behandleren for den ukentlige e-posten. Jobben og behandleren
// kalles direkte, som workeren gjør, med `now` satt og `send` byttet ut. Jobben avgrenses til testens personer (`onlyUserIds`):
// databasen deles med andre tester.

const mutableEnv = env as unknown as Record<string, unknown>;
const original = { enabled: env.WEEKLY_EMAIL_ENABLED, recipients: env.WEEKLY_EMAIL_RECIPIENTS };
beforeEach(() => {
  mutableEnv.WEEKLY_EMAIL_ENABLED = true;
  mutableEnv.WEEKLY_EMAIL_RECIPIENTS = "*";
});
afterEach(() => {
  mutableEnv.WEEKLY_EMAIL_ENABLED = original.enabled;
  mutableEnv.WEEKLY_EMAIL_RECIPIENTS = original.recipients;
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Mandag 16. november 2026 kl. 07:30 Oslo (UTC+1). */
const MONDAY_0730 = new Date("2026-11-16T06:30:00.000Z");
const WEEK = "2026-11-16";

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `ukentlig1139 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const admin = { "x-user-id": `ukentlig1139-admin-${RUN}`, "x-user-email": `ukentlig1139.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

async function person(extra: { activeStatus?: boolean; weeklyEmailEnabled?: boolean } = {}) {
  const externalId = `ukentlig1139-p-${RUN}-${seq++}`;
  return prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test`, preferredLocale: "nb", ...extra }, select: { id: true, email: true } });
}

/** Et publisert kurs med én seksjon. */
async function course() {
  const section = await prisma.courseSection.create({ data: { title: L(tag("seksjon")) }, select: { id: true } });
  const version = await prisma.courseSectionVersion.create({ data: { sectionId: section.id, versionNo: 1, bodyMarkdown: L("Tekst."), publishedAt: new Date() }, select: { id: true } });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  return prisma.course.create({
    data: { title: L(tag("kurs")), enrollmentPolicy: "RESTRICTED", publishedAt: new Date(), items: { create: [{ itemType: "SECTION", sectionId: section.id, sortOrder: 0 }] } },
    select: { id: true },
  });
}

/** Personer i en klasse som har et kurs: de har noe utestående (tildelt, ikke påbegynt). */
async function withOutstanding(people: Array<{ id: string }>) {
  const c = await course();
  const created = await request(app).post("/api/admin/content/classes").set(admin).send({ name: tag("klasse") });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const classId = created.body.class.id as string;
  for (const p of people) expect((await request(app).post(`/api/admin/content/classes/${classId}/members`).set(admin).send({ userId: p.id })).status).toBe(201);
  expect((await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(admin).send({ courseId: c.id })).status).toBe(201);
  return { courseId: c.id, classId };
}

const job = (now: Date, ids: string[]) => runWeeklyDigestSchedule({ now, onlyUserIds: ids });
const rows = (ids: string[]) => prisma.weeklyDigest.findMany({ where: { userId: { in: ids } }, orderBy: { userId: "asc" } });
async function eventFor(digestId: string) {
  const events = await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.weeklyDigest } });
  return events.filter((e) => (JSON.parse(e.payloadJson) as { digestId: string }).digestId === digestId);
}
function okSend() {
  return vi.fn<WeeklyDigestSend>(async () => ({ delivered: true, channel: "log", subject: "", nextStepGuidance: "" }));
}

describe("#1139: vinduet (spørsmål 3, planen 12.11)", () => {
  it("mandag 07:00–11:59 Oslo, også om sommeren (UTC+2); ikke søndag, ikke kl. 12, ikke tirsdag", () => {
    expect(isInWeeklyDigestWindow(new Date("2026-11-16T06:00:00Z"))).toBe(true); // 07:00 vinter
    expect(isInWeeklyDigestWindow(new Date("2026-11-16T05:59:00Z"))).toBe(false);
    expect(isInWeeklyDigestWindow(new Date("2026-11-16T10:59:00Z"))).toBe(true); // 11:59
    expect(isInWeeklyDigestWindow(new Date("2026-11-16T11:00:00Z"))).toBe(false); // 12:00
    expect(isInWeeklyDigestWindow(new Date("2026-06-15T05:00:00Z"))).toBe(true); // 07:00 sommer
    expect(isInWeeklyDigestWindow(new Date("2026-06-15T04:59:00Z"))).toBe(false);
    expect(isInWeeklyDigestWindow(new Date("2026-11-15T06:30:00Z"))).toBe(false); // søndag
    expect(isInWeeklyDigestWindow(new Date("2026-11-17T06:30:00Z"))).toBe(false); // tirsdag
  });

  it("utenfor vinduet lages ingen rader", async () => {
    const p = await person();
    await withOutstanding([p]);
    expect(await job(new Date("2026-11-16T11:00:00Z"), [p.id])).toMatchObject({ inWindow: false, evaluated: 0, queued: 0 });
    expect(await rows([p.id])).toEqual([]);
  });
});

describe("#1139: hvem som får e-posten", () => {
  it("utestående → `queued` med hendelse; ingenting → `skipped`; meldt av, sluttet → ingen rad", async () => {
    const [has, nothing, unsubscribed, left] = [await person(), await person(), await person({ weeklyEmailEnabled: false }), await person({ activeStatus: false })];
    await withOutstanding([has, unsubscribed, left]);
    const ids = [has.id, nothing.id, unsubscribed.id, left.id];
    expect(await job(MONDAY_0730, ids)).toMatchObject({ inWindow: true, evaluated: 2, queued: 1, nothingOutstanding: 1 });
    const byUser = new Map((await rows(ids)).map((r) => [r.userId, r]));
    expect(byUser.get(has.id)).toMatchObject({ weekKey: WEEK, status: "queued" });
    expect(byUser.get(nothing.id)).toMatchObject({ weekKey: WEEK, status: "skipped", reason: "nothing_outstanding" });
    expect(byUser.has(unsubscribed.id)).toBe(false);
    expect(byUser.has(left.id)).toBe(false);
    expect(await eventFor(byUser.get(has.id)!.id)).toHaveLength(1);
  });

  it("mottakerlista: tom = ingen; en adresse (store/små bokstaver, mellomrom) = bare den; `*` = alle", async () => {
    const [listed, other] = [await person(), await person()];
    await withOutstanding([listed, other]);
    const ids = [listed.id, other.id];
    mutableEnv.WEEKLY_EMAIL_RECIPIENTS = "";
    expect(await job(MONDAY_0730, ids)).toMatchObject({ evaluated: 0 });
    mutableEnv.WEEKLY_EMAIL_RECIPIENTS = ` x@y.test , ${listed.email.toUpperCase()} `;
    expect(await job(MONDAY_0730, ids)).toMatchObject({ queued: 1 });
    expect((await rows(ids)).map((r) => r.userId)).toEqual([listed.id]);
    mutableEnv.WEEKLY_EMAIL_RECIPIENTS = "*";
    expect(await job(MONDAY_0730, ids)).toMatchObject({ queued: 1 });
  });

  it("av (WEEKLY_EMAIL_ENABLED) → ingen rader", async () => {
    const p = await person();
    await withOutstanding([p]);
    mutableEnv.WEEKLY_EMAIL_ENABLED = false;
    expect(await job(MONDAY_0730, [p.id])).toMatchObject({ evaluated: 0 });
    expect(await rows([p.id])).toEqual([]);
  });
});

describe("#1139: én per uke, og tempoet", () => {
  it("en runde til samme uke, og to runder samtidig, lager ingen ny rad eller hendelse", async () => {
    const p = await person();
    await withOutstanding([p]);
    const [a, b] = await Promise.all([job(MONDAY_0730, [p.id]), job(MONDAY_0730, [p.id])]);
    expect(a.queued + b.queued).toBe(1);
    expect(await job(new Date(MONDAY_0730.getTime() + 60 * 60_000), [p.id])).toMatchObject({ evaluated: 0, queued: 0 });
    const [row] = await rows([p.id]);
    expect(await eventFor(row!.id)).toHaveLength(1);
  });

  it("utsendingen spres: 12 minutter mellom hver, ikke før mandag 07:00", async () => {
    const [first, second] = [await person(), await person()];
    await withOutstanding([first, second]);
    await job(new Date("2026-11-16T06:00:00Z"), [first.id, second.id]);
    const times = [];
    for (const row of await rows([first.id, second.id])) times.push((await eventFor(row.id))[0]!.availableAt.getTime());
    times.sort((x, y) => x - y);
    expect(times[1]! - times[0]!).toBe(WEEKLY_DIGEST_SPACING_MS);
    expect(times[0]!).toBeGreaterThanOrEqual(weeklyDigestSendStart(WEEK).getTime());
  });

  it("QA-porten (bør 1): første runde kl. 09:00 gir ikke flere samme tid; ingen før nå; neste runde fortsetter etter den siste", async () => {
    const week = "2026-11-23";
    const nine = new Date("2026-11-23T08:00:00Z"); // 09:00 Oslo
    const people = [await person(), await person(), await person()];
    await withOutstanding(people);
    await job(nine, [people[0]!.id, people[1]!.id]);
    await job(new Date(nine.getTime() + 5 * 60_000), [people[2]!.id]);
    const queuedAt = (await rows(people.map((p) => p.id))).filter((r) => r.weekKey === week).map((r) => r.queuedAt!.getTime());
    const events = [];
    for (const row of await rows(people.map((p) => p.id))) events.push((await eventFor(row.id))[0]!.availableAt.getTime());
    expect(new Set(events).size).toBe(3);
    expect(events.sort()).toEqual(queuedAt.sort());
    const sorted = [...events].sort((x, y) => x - y);
    expect(sorted[0]!).toBeGreaterThanOrEqual(nine.getTime());
    expect(sorted[1]! - sorted[0]!).toBeGreaterThanOrEqual(WEEKLY_DIGEST_SPACING_MS);
    expect(sorted[2]! - sorted[1]!).toBeGreaterThanOrEqual(WEEKLY_DIGEST_SPACING_MS);
  });
});

describe("#1139: behandleren sjekker alt på nytt rett før sending", () => {
  async function queued() {
    const p = await person();
    const setup = await withOutstanding([p]);
    await job(MONDAY_0730, [p.id]);
    const [row] = await rows([p.id]);
    expect(row).toMatchObject({ status: "queued" });
    return { p, row: row!, ...setup };
  }

  it("sendt én gang; levert på nytt sender ingenting", async () => {
    const q = await queued();
    const send = okSend();
    await deliverWeeklyDigest(q.row.id, { send, now: MONDAY_0730 });
    await deliverWeeklyDigest(q.row.id, { send, now: MONDAY_0730 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].content.notStarted).toHaveLength(1);
    expect((await rows([q.p.id]))[0]).toMatchObject({ status: "sent" });
  });

  it("meldt av etter at raden ble laget → `skipped` (`unsubscribed`), ingen e-post", async () => {
    const q = await queued();
    await prisma.user.update({ where: { id: q.p.id }, data: { weeklyEmailEnabled: false } });
    const send = okSend();
    await deliverWeeklyDigest(q.row.id, { send, now: MONDAY_0730 });
    expect(send).not.toHaveBeenCalled();
    expect((await rows([q.p.id]))[0]).toMatchObject({ status: "skipped", reason: "unsubscribed" });
  });

  it("sluttet eller anonymisert etter at raden ble laget → `skipped` (`not_reachable`), ingen e-post", async () => {
    const send = okSend();
    const left = await queued();
    await prisma.user.update({ where: { id: left.p.id }, data: { activeStatus: false } });
    await deliverWeeklyDigest(left.row.id, { send, now: MONDAY_0730 });
    const anonymized = await queued();
    await prisma.user.update({ where: { id: anonymized.p.id }, data: { isAnonymized: true } });
    await deliverWeeklyDigest(anonymized.row.id, { send, now: MONDAY_0730 });
    expect(send).not.toHaveBeenCalled();
    for (const q of [left, anonymized]) expect((await rows([q.p.id]))[0]).toMatchObject({ status: "skipped", reason: "not_reachable" });
  });

  it("nødstopp, for sent (etter tirsdag 17:00 Oslo), ikke lenger på lista, ingenting igjen → `skipped`", async () => {
    const send = okSend();
    const disabled = await queued();
    mutableEnv.WEEKLY_EMAIL_ENABLED = false;
    await deliverWeeklyDigest(disabled.row.id, { send, now: MONDAY_0730 });
    mutableEnv.WEEKLY_EMAIL_ENABLED = true;
    const late = await queued();
    await deliverWeeklyDigest(late.row.id, { send, now: new Date("2026-11-17T16:01:00Z") });
    const unlisted = await queued();
    mutableEnv.WEEKLY_EMAIL_RECIPIENTS = "noen@andre.test";
    await deliverWeeklyDigest(unlisted.row.id, { send, now: MONDAY_0730 });
    mutableEnv.WEEKLY_EMAIL_RECIPIENTS = "*";
    const done = await queued();
    await prisma.courseCompletion.create({ data: { userId: done.p.id, courseId: done.courseId, moduleSnapshotJson: "[]" } });
    await deliverWeeklyDigest(done.row.id, { send, now: MONDAY_0730 });
    expect(send).not.toHaveBeenCalled();
    const reasons = (await prisma.weeklyDigest.findMany({ where: { id: { in: [disabled.row.id, late.row.id, unlisted.row.id, done.row.id] } } }))
      .map((r) => [r.id, r.status, r.reason]);
    expect(new Map(reasons.map(([id, ...rest]) => [id, rest]))).toEqual(new Map([
      [disabled.row.id, ["skipped", "disabled"]],
      [late.row.id, ["skipped", "too_late"]],
      [unlisted.row.id, ["skipped", "not_listed"]],
      [done.row.id, ["skipped", "nothing_outstanding"]],
    ]));
  });

  it("utfallene: avbrutt → `uncertain`; sikker feil → `queued` og nytt forsøk, siste → `failed`; lenke → `failed`; kanal av → `skipped`", async () => {
    const ambiguous = await queued();
    await deliverWeeklyDigest(ambiguous.row.id, { now: MONDAY_0730, send: async () => ({ delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", failureReason: "timeout", ambiguous: true }) });
    const certain = await queued();
    const rejected: WeeklyDigestSend = async () => ({ delivered: false, channel: "acs_email", subject: "", nextStepGuidance: "", failureReason: "acs_400" });
    await expect(deliverWeeklyDigest(certain.row.id, { now: MONDAY_0730, send: rejected })).rejects.toThrow(/not delivered: acs_400/);
    expect((await rows([certain.p.id]))[0]).toMatchObject({ status: "queued", sendingAt: null });
    await expect(deliverWeeklyDigest(certain.row.id, { now: MONDAY_0730, send: rejected, lastAttempt: true })).rejects.toThrow();
    const link = await queued();
    await deliverWeeklyDigest(link.row.id, { now: MONDAY_0730, send: async () => { throw new EmailContainsLinkError("html"); } });
    const channel = await queued();
    await deliverWeeklyDigest(channel.row.id, { now: MONDAY_0730, send: async () => ({ delivered: false, channel: "disabled", subject: "", nextStepGuidance: "", failureReason: "channel_disabled" }) });
    const state = async (id: string) => (await prisma.weeklyDigest.findUniqueOrThrow({ where: { id } })).status;
    expect([await state(ambiguous.row.id), await state(certain.row.id), await state(link.row.id), await state(channel.row.id)]).toEqual(["uncertain", "failed", "failed", "skipped"]);
  });

  it("en rad som står i `sending` (workeren startet på nytt midt i): `uncertain`, ingen e-post", async () => {
    const q = await queued();
    await prisma.weeklyDigest.update({ where: { id: q.row.id }, data: { status: "sending", sendingAt: new Date() } });
    const send = okSend();
    await deliverWeeklyDigest(q.row.id, { send, now: MONDAY_0730 });
    expect(send).not.toHaveBeenCalled();
    expect((await rows([q.p.id]))[0]).toMatchObject({ status: "uncertain", reason: "interrupted" });
  });
});

describe("#1139: ryddingen og innsynet", () => {
  it("`sending` i over 30 min → `uncertain`; `queued` fra en tidligere uke → `failed` (`lost_event`); eldre enn 12 uker slettes", async () => {
    const [stuck, lost, old] = [await person(), await person(), await person()];
    await prisma.weeklyDigest.createMany({
      data: [
        { userId: stuck.id, weekKey: WEEK, status: "sending", sendingAt: new Date(Date.now() - 31 * 60_000) },
        { userId: lost.id, weekKey: "2026-11-09", status: "queued" },
        { userId: old.id, weekKey: "2026-08-17", status: "sent" },
      ],
    });
    const summary = await job(new Date("2026-11-16T11:30:00Z"), [stuck.id, lost.id, old.id]);
    expect(summary).toMatchObject({ uncertain: 1, lostEvents: 1, deleted: 1 });
    const statuses = new Map((await rows([stuck.id, lost.id, old.id])).map((r) => [r.userId, [r.status, r.reason]]));
    expect(statuses.get(stuck.id)).toEqual(["uncertain", "interrupted"]);
    expect(statuses.get(lost.id)).toEqual(["failed", "lost_event"]);
    expect(statuses.has(old.id)).toBe(false);
  });

  it("QA-porten (bør 3): en rad i kø denne uka står til to timer etter tirsdag 17:00 Oslo; etter det er hendelsen tapt", async () => {
    const p = await person();
    await prisma.weeklyDigest.create({ data: { userId: p.id, weekKey: WEEK, status: "queued" } });
    expect(await job(new Date("2026-11-17T17:59:00Z"), [p.id])).toMatchObject({ lostEvents: 0 }); // 18:59 Oslo
    expect((await rows([p.id]))[0]).toMatchObject({ status: "queued" });
    expect(await job(new Date("2026-11-17T18:01:00Z"), [p.id])).toMatchObject({ lostEvents: 1 }); // 19:01 Oslo
    expect((await rows([p.id]))[0]).toMatchObject({ status: "failed", reason: "lost_event" });
  });

  it("innsynet tar med ukene", async () => {
    const id = `ukentlig1139-innsyn-${RUN}`;
    const headers = { "x-user-id": id, "x-user-email": `${id}@x.test`, "x-user-name": "D", "x-user-roles": "PARTICIPANT" };
    await request(app).get("/api/me").set(headers);
    const user = await prisma.user.findUniqueOrThrow({ where: { externalId: id }, select: { id: true } });
    await prisma.weeklyDigest.create({ data: { userId: user.id, weekKey: WEEK, status: "sent", sentAt: new Date() } });
    const data = await request(app).get("/api/me/data").set(headers);
    expect(JSON.stringify(data.body)).toContain(`"weekKey":"${WEEK}"`);
  });
});
