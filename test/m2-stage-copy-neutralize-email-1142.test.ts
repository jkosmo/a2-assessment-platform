import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import {
  deliverCourseAssignmentDigest,
  neutralizeEmailStateAfterProdCopy,
  runCourseAssignmentEmailSchedule,
  type CourseAssignmentDigestSend,
} from "../src/modules/course/courseAssignmentNotice.js";
import { runCourseMajorEmailSchedule } from "../src/modules/course/courseMajorVersionEmail.js";
import { enqueueOutboxEvents, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";
import { weeklyDigestWeekKey } from "../src/modules/weeklyDigest/weeklyDigestContent.js";

// #1142 skive 3: prod → stage-kopi (`npm run stage-copy:neutralize-email`, doc/design/PLAN_1142.md, punkt 2; Codex runde 1
// nr. 2 og runde 2). Oppsettet er det en kopi av prod kan ha med seg: rader om nye kurs i `waiting`, `queued` (med en hendelse
// i outboxen) og `sending`, et par prod-jobben ennå ikke hadde sett (uten rad og uten hendelse), en `sent`-rad, og en rad om
// ny hovedversjon (4b) i `waiting` uten hendelse. Etterpå sender verken denne jobben, 4b-jobben eller behandlerne noe.
//
// ⚠️ Skriptet gjelder hele databasen, som deles med andre testfiler (de kjører én om gangen): det setter også andre filers
// ventende rader og hendelser som sender e-post. Ingen annen fil venter på noe fra før den selv begynte.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `stagekopi1142 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const admin = { "x-user-id": `stagekopi1142-admin-${RUN}`, "x-user-email": `stagekopi1142.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR" };

afterAll(async () => {
  await prisma.$disconnect();
});

async function person() {
  const externalId = `stagekopi1142-p-${RUN}-${seq++}`;
  return prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test` }, select: { id: true } });
}

async function call(url: string, body: object, expected: number) {
  const response = await request(app).post(url).set(admin).send(body);
  expect(response.status, `${url} ${JSON.stringify(response.body).slice(0, 300)}`).toBe(expected);
  return response;
}

describe("#1142 skive 3 — prod → stage-kopi: det som venter i prod, sendes aldri fra stage", () => {
  it("ventende rader og par uten rad blir `baseline`, 4b-rader `skipped`, hendelser som sender e-post `failed`; etterpå sender ingenting", async () => {
    const course = await prisma.course.create({ data: { title: L(tag("kurs")), publishedAt: new Date(), versionMajor: 2 }, select: { id: true } });
    const [waiting, queued, sending, unseen, alreadySent] = [await person(), await person(), await person(), await person(), await person()];
    const classId = (await call("/api/admin/content/classes", { name: tag("klasse") }, 201)).body.class.id as string;
    for (const u of [waiting, queued, sending, unseen, alreadySent]) await call(`/api/admin/content/classes/${classId}/members`, { userId: u.id }, 201);
    await call(`/api/admin/content/classes/${classId}/courses`, { courseId: course.id }, 201);

    // Tilstanden i prod da kopien ble tatt. Radene lages direkte: de står for prod-jobbens arbeid.
    const batchId = `batch-${RUN}`;
    const createdAt = new Date(Date.now() - 3 * 60 * 60_000);
    await prisma.courseAssignmentNotice.createMany({
      data: [
        { userId: waiting.id, courseId: course.id, status: "waiting", createdAt },
        { userId: queued.id, courseId: course.id, status: "queued", batchId, queuedAt: createdAt, createdAt },
        { userId: sending.id, courseId: course.id, status: "sending", batchId: `${batchId}-s`, queuedAt: createdAt, sendingAt: new Date(), createdAt },
        // #1146 (planreview R5): varslet for tre timer siden, og tildelingen over er nyere — som et kurs lagt inn igjen like
        // før kopien ble tatt. Prod-jobben setter raden tilbake; stage skal ikke.
        { userId: alreadySent.id, courseId: course.id, status: "sent", batchId: `${batchId}-x`, sentAt: createdAt, settledAt: createdAt, createdAt },
      ],
    });
    await enqueueOutboxEvents([{ type: OUTBOX_EVENT_TYPES.courseAssignmentDigest, payload: { batchId, userId: queued.id } }]);
    await enqueueOutboxEvents([{ type: OUTBOX_EVENT_TYPES.courseCompletionCheck, payload: { userId: queued.id, moduleId: `modul-${RUN}` } }]);
    await prisma.courseVersionNotice.create({ data: { courseId: course.id, versionMajor: 2, userId: waiting.id, status: "waiting" } });
    await prisma.courseVersionNotice.create({ data: { courseId: course.id, versionMajor: 2, userId: alreadySent.id, status: "sent" } });

    // #1139 (PLAN_1139 12.5): en ukentlig e-post i kø i prod, med hendelse.
    const weekly = await prisma.weeklyDigest.create({ data: { userId: queued.id, weekKey: "2026-11-16", status: "queued" }, select: { id: true } });
    await enqueueOutboxEvents([{ type: OUTBOX_EVENT_TYPES.weeklyDigest, payload: { digestId: weekly.id } }]);

    const summary = await neutralizeEmailStateAfterProdCopy();
    expect(summary.weeklyDigestsPendingSkipped).toBeGreaterThanOrEqual(1);
    expect((await prisma.weeklyDigest.findUniqueOrThrow({ where: { id: weekly.id } })).status).toBe("skipped");
    // Uka kopien ble tatt: alle nåbare uten rad har en `skipped`-rad, så stage ikke sender den ukentlige e-posten i dag.
    const thisWeek = weeklyDigestWeekKey(new Date());
    expect(await prisma.weeklyDigest.findUnique({ where: { userId_weekKey: { userId: unseen.id, weekKey: thisWeek } } })).toMatchObject({ status: "skipped", reason: "copied_from_prod" });
    const weeklyEvents = (await prisma.outboxEvent.findMany({ where: { type: OUTBOX_EVENT_TYPES.weeklyDigest } })).filter((e) => e.payloadJson.includes(weekly.id));
    expect(weeklyEvents.map((e) => e.status)).toEqual(["failed"]);
    expect(summary.pendingToBaseline).toBeGreaterThanOrEqual(3);
    expect(summary.unseenPairsToBaseline).toBeGreaterThanOrEqual(1);
    expect(summary.majorVersionNoticesSkipped).toBeGreaterThanOrEqual(1);
    expect(summary.outboxEventsFailed).toBeGreaterThanOrEqual(1);

    // Steg 1 og 2: alt som ventet, og paret ingen hadde sett, er `baseline`. Den sendte raden står.
    const rows = await prisma.courseAssignmentNotice.findMany({ where: { courseId: course.id } });
    const statusOf = (userId: string) => rows.filter((r) => r.userId === userId).map((r) => [r.status, r.reason]);
    for (const u of [waiting, queued, sending, unseen]) expect(statusOf(u.id), u === unseen ? "paret prod-jobben ikke hadde sett" : "ventende rad").toEqual([["baseline", "copied_from_prod"]]);
    expect(statusOf(alreadySent.id)).toEqual([["sent", null]]);
    // Steg 3: 4b-raden som ventet, er `skipped`; den sendte står.
    expect((await prisma.courseVersionNotice.findMany({ where: { courseId: course.id }, orderBy: { status: "asc" } })).map((r) => [r.status, r.reason])).toEqual([
      ["sent", null],
      ["skipped", "copied_from_prod"],
    ]);
    // Steg 4: hendelsen som sender e-post, er `failed`; kursbevissjekken (sender ingenting) står.
    const events = await prisma.outboxEvent.findMany({ where: { payloadJson: { contains: queued.id } } });
    expect(events.map((e) => [e.type, e.status]).sort()).toEqual([
      [OUTBOX_EVENT_TYPES.courseAssignmentDigest, "failed"],
      [OUTBOX_EVENT_TYPES.courseCompletionCheck, "pending"],
    ]);

    // Etterpå: verken jobben, 4b-jobben eller behandlerne sender noe, heller ikke lenge etter.
    const later = new Date(Date.now() + 3 * 60 * 60_000);
    // Tre ventende som ble `baseline`, og den sendte. Paret ingen hadde sett, lages etter (med `settledAt` = nå, sjekket under).
    // Tallet teller hele databasen, så andre testers rader kan komme i tillegg.
    expect(summary.settledNow).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.settledAt !== null), "alle rader regnes som varslet nå").toBe(true);
    expect(await runCourseAssignmentEmailSchedule({ now: later, onlyCourseIds: [course.id] })).toMatchObject({ created: 0, reset: 0, queued: 0, requeued: 0 });
    expect(await runCourseMajorEmailSchedule({ now: later, onlyCourseIds: [course.id] })).toMatchObject({ queued: 0 });
    const send = vi.fn<CourseAssignmentDigestSend>(async () => ({ delivered: true, channel: "log", subject: "", nextStepGuidance: "" }));
    for (const id of [batchId, `${batchId}-s`]) await deliverCourseAssignmentDigest(id, { send });
    expect(send).not.toHaveBeenCalled();
  });
});
