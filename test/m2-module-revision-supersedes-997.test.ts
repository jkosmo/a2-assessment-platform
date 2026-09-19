// #997: «bestått gjelder til modulen revideres» — implementert som et valg forfatteren tar ved
// publisering (produkteier 2026-09-19, doc/DESIGN_997.md).
//
// Det testen måler, og hvorfor hver del er her:
//   - Flagget AV er standard: en vanlig publisering rører ingen sertifisering. Uten denne ville
//     «alt teller fortsatt» og «vi glemte å implementere» sett likt ut.
//   - Flagget PÅ setter ACTIVE → SUPERSEDED, bevarer raden (dato + vedtak), og peker på versjonen
//     som gjorde det.
//   - SUPERSEDED teller ikke som bestått noe sted: kursbevisporten og deltakerens modulstatus.
//   - Hver som mistet beståtten får ETT varsel, og det ligger i outboxen — ikke sendt direkte, så
//     en feilet e-post verken ruller tilbake publiseringen eller forsvinner (#1007).
//   - Revisjonssporet har en egen hendelse med antallet.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const L = (s: string) => JSON.stringify({ "en-GB": s, nb: s, nn: s });
let seq = 0;

/** En publisert modul, én deltaker som har bestått den, og et nytt utkast klart til publisering. */
async function setupPassedModule(opts: { preferredLocale?: string | null } = {}) {
  const stamp = `997-${Date.now()}-${seq++}`;
  const module = await prisma.module.create({ data: { title: L(`Revisjon ${stamp}`) }, select: { id: true } });
  const version1 = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date(), taskText: L("v1") },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version1.id } });
  const version2 = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 2, assessmentMode: "MCQ_ONLY", taskText: L("v2 — omskrevet") },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      externalId: `part-${stamp}`,
      email: `part-${stamp}@company.com`,
      name: "Deltaker 997",
      ...(opts.preferredLocale !== undefined ? { preferredLocale: opts.preferredLocale } : {}),
    },
    select: { id: true, email: true },
  });
  const submission = await prisma.submission.create({
    data: {
      userId: user.id,
      moduleId: module.id,
      moduleVersionId: version1.id,
      submissionStatus: "COMPLETED",
      deliveryType: "text",
      responseJson: JSON.stringify({}),
      submittedAt: new Date(),
    },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: version1.id,
      decisionType: "AUTOMATIC",
      passFailTotal: true,
      totalScore: 90,
      mcqScaledScore: 30,
      practicalScaledScore: 60,
      decisionReason: "Pass",
      redFlagsJson: "[]",
      finalisedAt: new Date(),
    },
    select: { id: true },
  });
  const certification = await prisma.certificationStatus.create({
    data: {
      userId: user.id,
      moduleId: module.id,
      latestDecisionId: decision.id,
      status: "ACTIVE",
      passedAt: new Date("2026-05-01T09:00:00.000Z"),
    },
    select: { id: true },
  });

  return { moduleId: module.id, version2Id: version2.id, userId: user.id, userEmail: user.email, certificationId: certification.id };
}

function publish(moduleId: string, moduleVersionId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionId}/publish`)
    .set(admin)
    .send(body);
}

async function outboxFor(moduleVersionId: string) {
  const rows = await prisma.outboxEvent.findMany({ where: { type: "module_revised_notification" } });
  return rows
    .map((row) => ({ row, payload: JSON.parse(row.payloadJson) as Record<string, unknown> }))
    .filter((e) => e.payload.moduleVersionId === moduleVersionId);
}

describe("#997 — en revisjon forfatteren merker gjør tidligere bestått ugyldig", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("standard er AV: en vanlig publisering rører ingen sertifisering og sender ingen varsler", async () => {
    const { moduleId, version2Id, certificationId } = await setupPassedModule();

    const res = await publish(moduleId, version2Id, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const cert = await prisma.certificationStatus.findUnique({ where: { id: certificationId } });
    expect(cert?.status).toBe("ACTIVE");
    expect(cert?.supersededByVersionId).toBeNull();
    expect(await outboxFor(version2Id)).toHaveLength(0);
  });

  it("flagget PÅ: beståtten blir SUPERSEDED, raden bevares og peker på versjonen som gjorde det", async () => {
    const { moduleId, version2Id, certificationId } = await setupPassedModule();

    const res = await publish(moduleId, version2Id, { supersedesEarlierPasses: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const cert = await prisma.certificationStatus.findUnique({ where: { id: certificationId } });
    expect(cert?.status).toBe("SUPERSEDED");
    expect(cert?.supersededByVersionId).toBe(version2Id);
    // ⚠️ Historikken består: raden er ikke slettet, og datoen for den opprinnelige beståtten står.
    expect(cert?.passedAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
    expect(cert?.latestDecisionId).toBeTruthy();
  });

  it("ett varsel per deltaker, i outboxen, på MOTTAKERENS språk", async () => {
    const { moduleId, version2Id, userEmail } = await setupPassedModule({ preferredLocale: "nn" });

    await publish(moduleId, version2Id, { supersedesEarlierPasses: true });

    const events = await outboxFor(version2Id);
    expect(events).toHaveLength(1);
    expect(events[0].payload.recipientEmail).toBe(userEmail);
    expect(events[0].payload.locale).toBe("nn");
    // ⚠️ I outboxen, ikke sendt direkte: publiseringen skal ikke rulle tilbake fordi en e-post
    // feilet, og et tapt varsel skal prøves på nytt (#1007).
    expect(events[0].row.status).toBe("pending");
  });

  it("revisjonssporet har en egen hendelse med antallet", async () => {
    const { moduleId, version2Id } = await setupPassedModule();

    await publish(moduleId, version2Id, { supersedesEarlierPasses: true });

    const event = await prisma.auditEvent.findFirst({
      where: { action: "module_passes_superseded", entityId: moduleId },
      orderBy: { timestamp: "desc" },
    });
    expect(event).not.toBeNull();
    const meta = JSON.parse(event!.metadataJson) as Record<string, unknown>;
    expect(meta).toMatchObject({ moduleId, moduleVersionId: version2Id, supersededCount: 1, notifiedCount: 1 });
  });

  it("deltakeren ser «revidert — ta den på nytt», ikke «ikke påbegynt»", async () => {
    const { moduleId, version2Id, userId } = await setupPassedModule();
    const course = await prisma.course.create({
      data: { title: L(`Kurs 997 ${Date.now()}`), publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "MODULE", moduleId, sortOrder: 0 } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { externalId: true, email: true, name: true } });
    const participantHeaders = {
      "x-user-id": user.externalId,
      "x-user-email": user.email,
      "x-user-name": user.name,
      "x-user-roles": "PARTICIPANT",
    };

    const before = await request(app).get(`/api/courses/${course.id}`).set(participantHeaders);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const moduleBefore = (before.body.course.modules as Array<{ moduleId: string; moduleStatus: string }>)
      .find((m) => m.moduleId === moduleId);
    expect(moduleBefore?.moduleStatus).toBe("PASSED");

    await publish(moduleId, version2Id, { supersedesEarlierPasses: true });

    const after = await request(app).get(`/api/courses/${course.id}`).set(participantHeaders);
    expect(after.status).toBe(200);
    const moduleAfter = (after.body.course.modules as Array<{ moduleId: string; moduleStatus: string }>)
      .find((m) => m.moduleId === moduleId);
    // ⚠️ Kjernen: EGEN tilstand. "NOT_STARTED" ville sagt at deltakeren aldri har vært innom.
    expect(moduleAfter?.moduleStatus).toBe("REVISED_RETAKE_REQUIRED");
  });

  it("forfatteren kan se hvor mange som vil bli berørt før hen svarer", async () => {
    const { moduleId, version2Id } = await setupPassedModule();

    const before = await request(app).get(`/api/admin/content/modules/${moduleId}/passed-count`).set(admin);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.passedCount).toBe(1);

    await publish(moduleId, version2Id, { supersedesEarlierPasses: true });

    // Etterpå er ingen «bestått» igjen å erstatte — tallet er selvkorrigerende.
    const after = await request(app).get(`/api/admin/content/modules/${moduleId}/passed-count`).set(admin);
    expect(after.body.passedCount).toBe(0);
  });
});
