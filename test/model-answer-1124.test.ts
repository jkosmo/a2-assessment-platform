import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1124 del 2: eksempelsvaret (`ModuleVersion.modelAnswer`) etter fritekstvurderingen.
//
// ⚠️ Gjennom RUTENE. To ting bevises:
//   1. Forfattersiden: lagres, beholdes når en lagring ikke nevner det (en eldre fane), tømmes med
//      `null`, følger eksport → import, og stopper publisering når det ikke er oversatt.
//   2. Deltakersiden: eksempelsvaret går ut ÉN vei — `/model-answer` — og bare når modulen har slått
//      det på og vurderingen er ferdig. Teksten finnes ikke i noe annet deltakersvar.

const admin = {
  "x-user-id": "admin-1124b",
  "x-user-email": "admin-1124b@company.com",
  "x-user-name": "Model Answer Admin",
  "x-user-roles": "ADMINISTRATOR",
};
const participant = {
  "x-user-id": "participant-1124b",
  "x-user-email": "participant-1124b@company.com",
  "x-user-name": "Model Answer Participant",
  "x-user-roles": "PARTICIPANT",
};
const other = { ...participant, "x-user-id": "participant-1124b-other", "x-user-email": "participant-1124b-other@company.com" };

const SVAR = { nb: "EKSEMPEL-1124: Vedtak: budsjettet ble godkjent.", nn: "EKSEMPEL-1124: Vedtak: budsjettet vart godkjent.", "en-GB": "EKSEMPEL-1124: Decision: the budget was approved." };
const rubric = {
  criteria: { vedtak: { label: "Vedtak", description: "0 = mangler; 2 = står først", maxScore: 2, weight: 1, candidateVisible: true } },
  scalingRule: { max_total: 2 },
};
const promptTemplate = { systemPrompt: "Du vurderer.", userPromptTemplate: "Vurder: {{answer}}" };
const three = (text: string) => ({ nb: text, nn: text, "en-GB": text });

const createdModules: string[] = [];

async function createModule(title: string) {
  const res = await request(app).post("/api/admin/content/modules").set(admin).send({ title: three(title) });
  expect(res.status).toBe(201);
  createdModules.push(res.body.module.id as string);
  return res.body.module.id as string;
}

async function compose(moduleId: string, extra: Record<string, unknown>) {
  const res = await request(app).post(`/api/admin/content/modules/${moduleId}/versions`).set(admin).send({
    assessmentMode: "FREETEXT_ONLY",
    taskText: three("Skriv referatet."),
    assessorExpectedContent: three("Vedtaket står først."),
    rubric,
    promptTemplate,
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.moduleVersion.id as string;
}

const storedAnswer = async (versionId: string) =>
  (await prisma.moduleVersion.findUniqueOrThrow({ where: { id: versionId }, select: { modelAnswer: true } })).modelAnswer;

afterAll(async () => {
  for (const id of createdModules) await request(app).delete(`/api/admin/content/modules/${id}`).set(admin);
  await prisma.$disconnect();
});

describe("#1124 del 2 — forfattersiden", () => {
  it("lagres, beholdes når lagringen ikke nevner det, og tømmes med null", async () => {
    const moduleId = await createModule(`Eksempelsvar lagring ${Date.now()}`);
    const first = await compose(moduleId, { modelAnswer: SVAR, assessmentPolicy: { practical: { modelAnswerAfterAssessment: true } } });
    expect(JSON.parse((await storedAnswer(first))!)).toEqual(SVAR);
    const policy = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: first }, select: { assessmentPolicyJson: true } });
    expect(JSON.parse(policy.assessmentPolicyJson!)).toMatchObject({ practical: { modelAnswerAfterAssessment: true } });

    // En fane åpnet før utrullingen kjenner ikke feltet. Lagringen skal ikke slette eksempelsvaret.
    const second = await compose(moduleId, {});
    expect(JSON.parse((await storedAnswer(second))!)).toEqual(SVAR);

    const cleared = await compose(moduleId, { modelAnswer: null });
    expect(await storedAnswer(cleared)).toBeNull();

    // Forfatterens lesing av modulen har det med.
    await compose(moduleId, { modelAnswer: SVAR });
    const bundle = await request(app).get(`/api/admin/content/modules/${moduleId}/export`).set(admin);
    expect(bundle.status).toBe(200);
    expect(bundle.body.moduleExport.selectedConfiguration.moduleVersion.modelAnswer).toEqual(SVAR);
  });

  it("følger eksport → import", async () => {
    const moduleId = await createModule(`Eksempelsvar eksport ${Date.now()}`);
    await compose(moduleId, { modelAnswer: SVAR, assessmentPolicy: { practical: { modelAnswerAfterAssessment: true } } });
    const exported = await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(admin);
    expect(exported.status).toBe(200);
    expect(exported.body.envelope.module.activeVersion.modelAnswer).toEqual(SVAR);

    const imported = await request(app).post("/api/admin/content/modules/import").set(admin).send({ payload: exported.body.envelope, mode: "createNew" });
    expect(imported.status).toBe(201);
    createdModules.push(imported.body.moduleId as string);
    expect(JSON.parse((await storedAnswer(imported.body.moduleVersionId as string))!)).toEqual(SVAR);
  });

  it("publisering stoppes når eksempelsvaret ikke er oversatt", async () => {
    const moduleId = await createModule(`Eksempelsvar oversatt ${Date.now()}`);
    const versionId = await compose(moduleId, { modelAnswer: { nb: "Bare på bokmål." } });
    const res = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions/${versionId}/publish`).set(admin);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain("modelAnswer");
  });
});

describe("#1124 del 2 — deltakersiden", () => {
  let moduleId: string;
  let versionId: string;
  let submissionId: string;

  beforeAll(async () => {
    moduleId = await createModule(`Eksempelsvar deltaker ${Date.now()}`);
    versionId = await compose(moduleId, { modelAnswer: SVAR });
    await prisma.moduleVersion.update({ where: { id: versionId }, data: { publishedAt: new Date() } });
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: versionId } });

    await request(app).get("/api/me").set(participant);
    await request(app).get("/api/me").set(other);
    const user = await prisma.user.findUniqueOrThrow({ where: { externalId: participant["x-user-id"] } });
    submissionId = (await prisma.submission.create({
      data: {
        userId: user.id,
        moduleId,
        moduleVersionId: versionId,
        deliveryType: "text",
        responseJson: JSON.stringify({ response: "Mitt referat.", reflection: "  " }),
        submissionStatus: "SCORED",
      },
      select: { id: true },
    })).id;
  });

  afterAll(async () => {
    await prisma.assessmentDecision.deleteMany({ where: { submissionId } });
    await prisma.submission.deleteMany({ where: { moduleId } });
    await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: null } });
    await prisma.user.deleteMany({ where: { externalId: { in: [participant["x-user-id"], other["x-user-id"]] } } });
  });

  const setPolicy = (on: boolean) =>
    prisma.moduleVersion.update({
      where: { id: versionId },
      data: { assessmentPolicyJson: JSON.stringify(on ? { practical: { modelAnswerAfterAssessment: true } } : {}) },
    });

  it("slått av (standard): ingen eksempelsvar", async () => {
    await setPolicy(false);
    const res = await request(app).get(`/api/submissions/${submissionId}/model-answer`).set(participant);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, modelAnswer: null, ownAnswer: [] });
  });

  it("slått på, men vurderingen er ikke ferdig: ingen eksempelsvar ennå", async () => {
    await setPolicy(true);
    const res = await request(app).get(`/api/submissions/${submissionId}/model-answer`).set(participant);
    expect(res.body).toEqual({ enabled: true, modelAnswer: null, ownAnswer: [] });
  });

  it("slått på og vurdert: eksempelsvaret på deltakerens språk, ved siden av eget svar", async () => {
    await setPolicy(true);
    await prisma.assessmentDecision.create({
      data: {
        submissionId,
        moduleVersionId: versionId,
        mcqScaledScore: 0,
        practicalScaledScore: 100,
        totalScore: 100,
        redFlagsJson: "[]",
        passFailTotal: true,
        decisionType: "AUTOMATIC",
        decisionReason: "Bestått.",
      },
    });
    const nn = await request(app).get(`/api/submissions/${submissionId}/model-answer`).set(participant).set("x-locale", "nn");
    expect(nn.status).toBe(200);
    expect(nn.body).toEqual({ enabled: true, modelAnswer: SVAR.nn, ownAnswer: ["Mitt referat."] });
  });

  it("en annens innlevering: 404", async () => {
    const res = await request(app).get(`/api/submissions/${submissionId}/model-answer`).set(other);
    expect(res.status).toBe(404);
  });

  it("eksempelsvaret finnes ikke i noe annet deltakersvar", async () => {
    await setPolicy(true);
    const sent = [
      await request(app).get("/api/modules?includeCompleted=true").set(participant),
      await request(app).get(`/api/modules/${moduleId}`).set(participant),
      await request(app).get(`/api/submissions/${submissionId}`).set(participant),
      await request(app).get(`/api/submissions/${submissionId}/result`).set(participant),
      await request(app).get("/api/submissions/history").set(participant),
    ];
    for (const res of sent) {
      expect(res.status).toBeLessThan(500);
      expect(JSON.stringify(res.body)).not.toContain("EKSEMPEL-1124");
      // Feltet, ikke bryteren: `modelAnswerAfterAssessment` i vurderingsreglene har deltakeren alltid sett.
      expect(JSON.stringify(res.body)).not.toContain('"modelAnswer"');
    }
  });
});
