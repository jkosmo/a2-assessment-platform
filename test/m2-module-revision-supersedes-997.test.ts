// #997: «bestått gjelder til modulen revideres» — implementert som et valg forfatteren tar ved
// publisering (produkteier 2026-09-19, doc/DESIGN_997.md).
//
// ⚠️ 2026-11-08: #997 er erstattet av regelen om beståtte per kurs (#934 5a-3, på i prod siden 2026-11-06). Flagget gir
// `409 client_outdated`, og veien som satte `SUPERSEDED` og sendte varslene, er fjernet med testene sine. Det som står igjen:
//   - Flagget AV er standard: en vanlig publisering rører ingen sertifisering og sender ingen varsler.
//   - Flagget PÅ avvises, og ingenting er skrevet.
//   - Tallet til den gamle dialogen (`passed-count`), og kursrapportens regel for et forsøk som ikke er avgjort (#1116).
// Hva en ny hovedversjon gjør med beståtte, står i test/m2-module-pass-per-course-934-5a3.test.ts.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { getCourseLearnerReport } from "../src/modules/course/index.js";

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

  it("#1116: et forsøk som ikke er avgjort, teller som under vurdering — ikke bare UNDER_REVIEW", async () => {
    const { moduleId, userId } = await setupPassedModule();
    await prisma.certificationStatus.deleteMany({ where: { userId, moduleId } });
    await prisma.submission.updateMany({ where: { userId, moduleId }, data: { submissionStatus: "PROCESSING" } });
    const course = await prisma.course.create({
      data: { title: L(`Kurs 1116b ${Date.now()}`), publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "MODULE", moduleId, sortOrder: 0 } });
    const row = (await getCourseLearnerReport(course.id, {}, "nb")).rows.find((r) => r.participantId === userId);
    // Før: vedtaket (bestått) talte, så en sak under behandling sto som bestått.
    expect(row).toMatchObject({ passedModules: 0, underReviewModules: 1, failedModules: 0 });
  });

  it("flagget PÅ avvises med 409 client_outdated, og ingenting er skrevet: tallet står, statusen står, ingen varsler", async () => {
    const { moduleId, version2Id, certificationId } = await setupPassedModule();

    const before = await request(app).get(`/api/admin/content/modules/${moduleId}/passed-count`).set(admin);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.passedCount).toBe(1);

    const res = await publish(moduleId, version2Id, { supersedesEarlierPasses: true });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe("client_outdated");

    const cert = await prisma.certificationStatus.findUnique({ where: { id: certificationId } });
    expect(cert?.status).toBe("ACTIVE");
    expect(cert?.supersededByVersionId).toBeNull();
    expect(await outboxFor(version2Id)).toHaveLength(0);
    const after = await request(app).get(`/api/admin/content/modules/${moduleId}/passed-count`).set(admin);
    expect(after.body.passedCount).toBe(1);
  });
});
