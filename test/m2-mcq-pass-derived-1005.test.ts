// #1005: «bestod flervalgsdelen?» utledes ved lesing av modulversjonens grense.
//
// ⚠️ Testen så annerledes ut fram til kontraktsfasen 19.09: da fantes kolonnen `passFailMcq`
// fortsatt, og testen skrev en FEIL verdi i den for å måle at skjermen fulgte grensen og ikke
// raden. Kolonnen er nå droppet, og den halvdelen kan ikke lenger skrives — den ville bare målt
// at Prisma avviser et ukjent felt.
//
// Det som står igjen er den sterkeste casen, og den som faktisk beskriver hvorfor utledning er
// riktig: eieren endrer grensen ETTER at forsøket er levert, og svaret følger med. En lagret verdi
// kunne aldri gjort det.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participant = {
  "x-user-id": "mcq-derived-1005",
  "x-user-email": "mcq.derived.1005@company.com",
  "x-user-name": "Deltaker 1005",
  "x-user-roles": "PARTICIPANT",
};

const L = (s: string) => JSON.stringify({ "en-GB": s, nb: s, nn: s });

/** En ren flervalgsmodul med grense 70 % og ett forsøk på 60 % — altså ikke bestått. */
async function setupAttempt() {
  const stamp = `1005-${Date.now()}`;
  const module = await prisma.module.create({ data: { title: L(`Utledet flervalg ${stamp}`) }, select: { id: true } });
  const mcqSetVersion = await prisma.mCQSetVersion.create({
    data: { moduleId: module.id, versionNo: 1, title: L("Sett") },
    select: { id: true },
  });
  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      assessmentMode: "MCQ_ONLY",
      assessmentPolicyJson: JSON.stringify({ passRules: { mcqMinPercent: 70 } }),
      mcqSetVersionId: mcqSetVersion.id,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });

  const user = await prisma.user.upsert({
    where: { externalId: participant["x-user-id"] },
    update: {},
    create: { externalId: participant["x-user-id"], email: participant["x-user-email"], name: participant["x-user-name"] },
    select: { id: true },
  });
  const submission = await prisma.submission.create({
    data: {
      userId: user.id,
      moduleId: module.id,
      moduleVersionId: moduleVersion.id,
      submissionStatus: "COMPLETED",
      deliveryType: "text",
      responseJson: JSON.stringify({}),
      submittedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.mCQAttempt.create({
    data: {
      submissionId: submission.id,
      mcqSetVersionId: mcqSetVersion.id,
      startedAt: new Date(),
      completedAt: new Date(),
      rawScore: 6,
      percentScore: 60,
      scaledScore: 18,
    },
  });
  return { moduleId: module.id, submissionId: submission.id };
}

const historyFor = async () => {
  const res = await request(app).get("/api/submissions/history").set(participant);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.history as Array<{ submissionId: string; latestMcqAttempt: { percentScore: number | null; passFailMcq: boolean | null } | null }>;
};

describe("#1005 — flervalgsresultatet utledes ved lesing", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("60 % mot en grense på 70 % er ikke bestått", async () => {
    const { submissionId } = await setupAttempt();

    const item = (await historyFor()).find((h) => h.submissionId === submissionId);
    expect(item?.latestMcqAttempt?.passFailMcq).toBe(false);
  });

  it("senker eieren grensen etterpå, følger et gammelt forsøk med", async () => {
    const { moduleId, submissionId } = await setupAttempt();

    // ⚠️ Kjernen i #1005: dette er endringen en LAGRET verdi aldri kunne fanget. Forsøket er
    // levert og ferdig; det er grensen som flyttet seg.
    await prisma.moduleVersion.updateMany({
      where: { moduleId },
      data: { assessmentPolicyJson: JSON.stringify({ passRules: { mcqMinPercent: 50 } }) },
    });

    const item = (await historyFor()).find((h) => h.submissionId === submissionId);
    expect(item?.latestMcqAttempt?.passFailMcq).toBe(true);
  });

  it("en modul uten flervalgsport svarer «ikke aktuelt» (null), ikke «ikke bestått»", async () => {
    const { submissionId } = await setupAttempt();
    await prisma.moduleVersion.updateMany({
      where: { submissions: { some: { id: submissionId } } },
      data: { assessmentMode: "FREETEXT_ONLY", assessmentPolicyJson: null },
    });

    const item = (await historyFor()).find((h) => h.submissionId === submissionId);
    expect(item?.latestMcqAttempt?.passFailMcq).toBeNull();
  });
});
