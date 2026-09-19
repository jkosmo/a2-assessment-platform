// #1005: «bestod flervalgsdelen?» utledes ved lesing, ikke leses fra `MCQAttempt.passFailMcq`.
//
// ⚠️ Testen skriver med vilje en FEIL verdi i kolonnen — nøyaktig utakten #949 fant: forsøket sa
// «bestått» mens modulens grense sa noe annet. Leser noen fortsatt kolonnen, viser skjermen den
// feilen. Utleder de, er den borte uten at raden er rørt.
//
// Kolonnen finnes fortsatt i databasen (den droppes i neste release, kontraktsfasen) — derfor KAN
// testen skrive den. Når kolonnen er borte, skal denne fila erstattes av en som bare måler
// utledningen; det står i #1005.

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

/** En ren flervalgsmodul med grense 70 %, ett forsøk på 60 % — og en LØGN lagret i kolonnen. */
async function setupStaleAttempt() {
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
      // ⚠️ LØGNEN: 60 % mot en grense på 70 % er ikke bestått. Slik så radene ut før #949.
      passFailMcq: true,
    },
  });
  return { moduleId: module.id, submissionId: submission.id };
}

describe("#1005 — flervalgsresultatet utledes ved lesing", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("historikken viser den GJELDENDE regelen, ikke den lagrede verdien", async () => {
    await setupStaleAttempt();

    const res = await request(app).get("/api/submissions/history").set(participant);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const item = (res.body.history as Array<{ latestMcqAttempt: { percentScore: number; passFailMcq: boolean | null } | null }>)
      .find((h) => h.latestMcqAttempt?.percentScore === 60);
    expect(item, "fant ikke forsøket i historikken").toBeTruthy();
    // Kjernen: kolonnen sier `true`, grensen sier noe annet — skjermen skal følge grensen.
    expect(item!.latestMcqAttempt!.passFailMcq).toBe(false);
  });

  it("en høyere grense senere gjør et gammelt forsøk ikke-bestått, uten at raden røres", async () => {
    const { moduleId } = await setupStaleAttempt();

    // Eieren hever grensen til 90 % etterpå — presis den endringen en lagret verdi ikke fanger.
    await prisma.moduleVersion.updateMany({
      where: { moduleId },
      data: { assessmentPolicyJson: JSON.stringify({ passRules: { mcqMinPercent: 90 } }) },
    });

    const res = await request(app).get("/api/submissions/history").set(participant);
    expect(res.status).toBe(200);
    const items = (res.body.history as Array<{ latestMcqAttempt: { percentScore: number; passFailMcq: boolean | null } | null }>)
      .filter((h) => h.latestMcqAttempt?.percentScore === 60);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((h) => h.latestMcqAttempt!.passFailMcq === false)).toBe(true);
  });

  it("en modul uten flervalgsport svarer «ikke aktuelt» (null), ikke «ikke bestått»", async () => {
    const { submissionId } = await setupStaleAttempt();
    // FREETEXT_ONLY har ingen flervalgsgrense — tredje tilstand, jf. mcqPassRule.
    await prisma.moduleVersion.updateMany({
      where: { submissions: { some: { id: submissionId } } },
      data: { assessmentMode: "FREETEXT_ONLY", assessmentPolicyJson: null },
    });

    const res = await request(app).get("/api/submissions/history").set(participant);
    expect(res.status).toBe(200);
    const item = (res.body.history as Array<{ submissionId: string; latestMcqAttempt: { passFailMcq: boolean | null } | null }>)
      .find((h) => h.submissionId === submissionId);
    expect(item?.latestMcqAttempt?.passFailMcq).toBeNull();
  });
});
