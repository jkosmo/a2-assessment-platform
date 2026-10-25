import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { startMcqAttempt, submitMcqAttempt } from "../src/modules/assessment/mcqService.js";
import { getOwnedMcqReview } from "../src/modules/submission/mcqReviewService.js";
import { getMcqQualityReport } from "../src/modules/reporting/mcqSemanticReport.js";

// #1077 leveranse 2: «sett i riktig rekkefølge» (questionType «order») hele veien. Alternativene lagres
// i riktig rekkefølge — det er fasiten. Deltakeren får dem stokket, aldri i riktig rekkefølge (også når
// modulen har slått av stokking av spørsmålene), rettingen er rett eller galt, og gjennomgangen viser
// begge rekkefølgene. Produkteier 2026-10-25: 3–6 elementer.

const admin = {
  "x-user-id": "admin-1077-order",
  "x-user-email": "admin.1077.order@company.com",
  "x-user-name": "Admin 1077 order",
  "x-user-roles": "ADMINISTRATOR",
};

const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
const STEPS = [L("Receive", "Motta"), L("Assess", "Vurdere"), L("Decide", "Avgjøre"), L("Archive", "Arkivere")];
const NB = ["Motta", "Vurdere", "Avgjøre", "Arkivere"];
const order = (extra: Record<string, unknown> = {}) => ({
  questionType: "order",
  stem: L("Put the steps of a case in order.", "Sett stegene i en sak i rekkefølge."),
  options: STEPS,
  rationale: L("Receive first, archive last.", "Motta først, arkivere sist."),
  ...extra,
});

async function createModule(questions: unknown[]) {
  const created = await request(app).post("/api/admin/content/modules").set(admin).send({
    title: L(`Order ${Date.now()}`, `Rekkefølge ${Date.now()}`),
    certificationLevel: "basic",
  });
  expect(created.status).toBe(201);
  const moduleId = created.body.module.id as string;
  const set = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`).set(admin).send({ title: L("Set", "Sett"), questions });
  return { moduleId, set };
}

async function publishVersion(moduleId: string, mcqSetVersionId: string, mcq: Record<string, unknown> = {}) {
  const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin).send({
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId,
    assessmentPolicy: { passRules: { mcqMinPercent: 60 }, mcq: { reviewAfterSubmit: true, ...mcq } },
  });
  expect(version.status, JSON.stringify(version.body)).toBe(201);
  return version.body.moduleVersion.id as string;
}

describe("#1077 leveranse 2 — sett i riktig rekkefølge", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lagres med typen, elementene i riktig rekkefølge og ingen egen fasit", async () => {
    const { set } = await createModule([order()]);
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    const [q] = await prisma.mCQQuestion.findMany({ where: { mcqSetVersionId: set.body.mcqSetVersion.id } });
    expect(q!.questionType).toBe("order");
    expect(q!.answerKeyJson).toBeNull();
    expect((JSON.parse(q!.optionsJson) as unknown[]).map((o) => (typeof o === "string" ? JSON.parse(o).nb : (o as { nb: string }).nb))).toEqual(NB);
  });

  it.each<[string, Record<string, unknown>]>([
    ["to elementer", { options: STEPS.slice(0, 2) }],
    ["sju elementer", { options: [...STEPS, L("E", "E"), L("F", "F"), L("G", "G")] }],
    ["samme element to ganger", { options: [STEPS[0], STEPS[1], STEPS[0]] }],
    ["correctAnswers på en rekkefølge", { correctAnswers: [STEPS[0]] }],
  ])("avvises: %s", async (_navn, extra) => {
    const { set } = await createModule([order(extra)]);
    expect(set.status).toBe(400);
  });

  it("deltakeren får elementene stokket — aldri i riktig rekkefølge, også uten stokking av spørsmål", async () => {
    const { moduleId, set } = await createModule([order()]);
    const moduleVersionId = await publishVersion(moduleId, set.body.mcqSetVersion.id, { shuffleQuestions: false });
    const user = await prisma.user.create({ data: { externalId: `p-order-${Date.now()}`, email: `p-order-${Date.now()}@company.com`, name: "Deltaker rekkefølge" } });
    // 60 forsøk: en vanlig stokking gir den riktige rekkefølgen i 1 av 24, så den ville blitt sett.
    for (let i = 0; i < 60; i++) {
      const submission = await prisma.submission.create({
        data: { userId: user.id, moduleId, moduleVersionId, submissionStatus: "SUBMITTED", deliveryType: "text", responseJson: "{}", submittedAt: new Date() },
      });
      const started = await startMcqAttempt(moduleId, submission.id, user.id, "nb");
      const q = started.questions[0]!;
      expect(q.questionType).toBe("order");
      expect([...q.options].sort()).toEqual([...NB].sort());
      expect(q.options).not.toEqual(NB);
    }
  });

  it("rett eller galt: bare hele rekkefølgen riktig gir poeng; gjennomgangen viser begge rekkefølgene", async () => {
    const { moduleId, set } = await createModule([order()]);
    const moduleVersionId = await publishVersion(moduleId, set.body.mcqSetVersion.id);
    const user = await prisma.user.create({ data: { externalId: `p-order2-${Date.now()}`, email: `p-order2-${Date.now()}@company.com`, name: "Deltaker 2" } });
    const attempt = async (answer: string[]) => {
      const submission = await prisma.submission.create({
        data: { userId: user.id, moduleId, moduleVersionId, submissionStatus: "SUBMITTED", deliveryType: "text", responseJson: "{}", submittedAt: new Date() },
      });
      const started = await startMcqAttempt(moduleId, submission.id, user.id, "nb");
      const done = await submitMcqAttempt({ moduleId, submissionId: submission.id, attemptId: started.attemptId, userId: user.id, responses: [{ questionId: started.questions[0]!.id, orderedAnswers: answer }] });
      return { submission, done };
    };

    const riktig = await attempt(NB);
    expect(riktig.done.percentScore).toBe(100);
    // Språket betyr ingenting; rekkefølgen gjør.
    expect((await attempt(["Receive", "Vurdere", "Decide", "Arkivere"])).done.percentScore).toBe(100);
    // To byttet, et element mangler, ett for mye, et som ikke finnes: galt — ingen delpoeng.
    expect((await attempt(["Vurdere", "Motta", "Avgjøre", "Arkivere"])).done.percentScore).toBe(0);
    expect((await attempt(["Motta", "Vurdere", "Avgjøre"])).done.percentScore).toBe(0);
    expect((await attempt([...NB, "Motta"])).done.percentScore).toBe(0);
    expect((await attempt(["Motta", "Vurdere", "Avgjøre", "Noe annet"])).done.percentScore).toBe(0);

    const feil = await attempt(["Arkivere", "Vurdere", "Avgjøre", "Motta"]);
    const response = await prisma.mCQResponse.findFirstOrThrow({ where: { mcqAttempt: { submissionId: feil.submission.id } } });
    expect(JSON.parse(response.answerJson!)).toEqual({ order: [3, 1, 2, 0] });
    expect(response.selectedAnswer).toBe("Arkivere → Vurdere → Avgjøre → Motta");

    const review = await getOwnedMcqReview(feil.submission.id, user.id, "nb");
    expect(review?.questions[0]).toMatchObject({
      questionType: "order",
      isCorrect: false,
      correctOrder: NB,
      selectedOrder: ["Arkivere", "Vurdere", "Avgjøre", "Motta"],
    });

    // Kvalitetsrapporten: vanskegraden regnes som for de andre typene, men det finnes ingen
    // feilalternativer å telle — alle elementene er med i hvert svar.
    const report = await getMcqQualityReport({ moduleId }, "nb");
    const row = report.rows.find((r) => r.moduleId === moduleId);
    expect(row).toBeTruthy();
    expect(row!.attemptCount).toBe(7);
    expect(row!.distractorUsage).toEqual([]);
  });

  it("eksport → import gir samme spørsmål tilbake", async () => {
    const { moduleId, set } = await createModule([order()]);
    await publishVersion(moduleId, set.body.mcqSetVersion.id);
    const exported = await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(admin);
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    const q = (exported.body.envelope.module.activeVersion.mcqSet.questions as Array<Record<string, unknown>>)[0]!;
    expect(q).toMatchObject({ questionType: "order", options: STEPS, correctAnswer: STEPS[0] });
    expect(q).not.toHaveProperty("correctAnswers");

    const imported = await request(app).post("/api/admin/content/modules/import").set(admin).send({ payload: exported.body.envelope, mode: "createNew" });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const importedVersion = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: imported.body.moduleVersionId } });
    const [copy] = await prisma.mCQQuestion.findMany({ where: { mcqSetVersionId: importedVersion.mcqSetVersionId! } });
    expect(copy!.questionType).toBe("order");
    expect(copy!.optionsJson).toBe((await prisma.mCQQuestion.findFirstOrThrow({ where: { mcqSetVersionId: set.body.mcqSetVersion.id } })).optionsJson);
  });

  it("KI-revisjon av et sett med «sett i rekkefølge» stoppes — rekkefølgen er fasiten (til leveranse 2b)", async () => {
    const res = await request(app).post("/api/admin/content/generate/mcq/revise").set(admin).send({
      instruction: "Gjør spørsmålene vanskeligere",
      locale: "nb",
      questions: [{ questionType: "order", stem: "Sett i rekkefølge", options: NB, correctAnswer: NB[0], rationale: "Fordi." }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("mcq_revision_order_unsupported");
  });
});
