import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #952: en deltaker som STRØK på en frittstående modul mistet enhver inngang til å ta den på nytt.
//
// ⚠️ Årsaken var at «fullført» ble lest som ren `submissionStatus`. Både bestått og strøket gir
// `COMPLETED` på innleveringen, så filteret som skjuler fullførte moduler skjulte begge. Modulen
// forsvant fra /api/modules og dukket opp under «Fullførte moduler» — og eneste vei tilbake var
// via kurs-spilleren, hvis modulen tilfeldigvis lå i et kurs.
//
// Hver assertion har en makker: en BESTÅTT modul skal fortsatt skjules. Uten den ville testen
// bestått av at filteret sluttet å virke i det hele tatt.

const stamp = `f952-${Date.now()}`;
let seq = 0;

function participant(externalId: string) {
  return {
    "x-user-id": externalId,
    "x-user-email": `${externalId}@x.test`,
    "x-user-name": externalId,
    "x-user-roles": "PARTICIPANT",
  };
}

async function seedAttempt(passFailTotal: boolean, submissionStatus: "COMPLETED" | "UNDER_REVIEW") {
  seq += 1;
  const tag = `${stamp}-${seq}`;
  const user = await prisma.user.create({
    data: {
      externalId: tag,
      name: tag,
      email: `${tag}@x.test`,
      roleAssignments: { create: { appRole: "PARTICIPANT", validFrom: new Date("2020-01-01T00:00:00.000Z") } },
    },
    select: { id: true, externalId: true },
  });
  const module = await prisma.module.create({
    data: { title: `Retake ${tag}`, description: "d", certificationLevel: "foundation" },
    select: { id: true },
  });
  const version = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 1, publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });

  const submission = await prisma.submission.create({
    data: {
      userId: user.id,
      moduleId: module.id,
      moduleVersionId: version.id,
      submissionStatus,
      submittedAt: new Date(),
      deliveryType: "TEXT",
      responseJson: "{}",
    },
    select: { id: true },
  });
  await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: version.id,
      redFlagsJson: "[]",
      decisionType: "AUTOMATIC",
      passFailTotal,
      mcqScaledScore: 0,
      practicalScaledScore: 0,
      totalScore: passFailTotal ? 90 : 10,
      decisionReason: "seeded",
      finalisedAt: new Date(),
    },
  });
  return { user, moduleId: module.id };
}

async function availableModuleIds(externalId: string): Promise<string[]> {
  const res = await request(app).get("/api/modules").set(participant(externalId));
  expect(res.status).toBe(200);
  return (res.body.modules as Array<{ id: string }>).map((m) => m.id);
}

describe("#952 en strøket modul kan tas på nytt", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("en STRØKET modul blir stående tilgjengelig", async () => {
    const { user, moduleId } = await seedAttempt(false, "COMPLETED");
    expect(await availableModuleIds(user.externalId)).toContain(moduleId);
  });

  it("KONTROLLCASE: en BESTÅTT modul skjules fortsatt", async () => {
    // ⚠️ Uten denne kunne fiksen ha slått av skjulingen helt, og testen over hadde bestått.
    const { user, moduleId } = await seedAttempt(true, "COMPLETED");
    expect(await availableModuleIds(user.externalId)).not.toContain(moduleId);
  });

  it("#948 KARAKTERISERING: et «bestått» vedtak UNDER VURDERING skjuler ikke modulen", async () => {
    // `decisionService` kan sette passFailTotal: true samtidig som innleveringen er UNDER_REVIEW.
    // Sertifiseringen hoppes korrekt over, så modulen er ikke bestått ennå — og da skal den heller
    // ikke forsvinne fra deltakerens liste.
    //
    // ⚠️ MERK HVA DENNE IKKE BEVISER. Mutasjonstesting viste at den er grønn OGSÅ med den gamle
    // regelen, fordi `completedSubmissionStatuses` i dag bare er `["COMPLETED"]` — så en
    // UNDER_REVIEW-innlevering stoppes allerede av statusfilteret og når aldri
    // `isSettledPass`. Testen er derfor en KARAKTERISERING av dagens oppførsel, ikke en
    // regresjonsvakt for #952-endringen.
    //
    // Den beholdes fordi nøkkelen er konfigurerbar: utvides den, er `isSettledPass` det som
    // hindrer at et uavklart «bestått» skjuler modulen — og da blir denne testen den som fanger
    // det. Se `submissionOutcome.ts`.
    const { user, moduleId } = await seedAttempt(true, "UNDER_REVIEW");
    expect(await availableModuleIds(user.externalId)).toContain(moduleId);
  });
});
