import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { getOwnedMcqReview } from "../src/modules/submission/mcqReviewService.js";
import { getMcqQualityReport } from "../src/modules/reporting/mcqSemanticReport.js";

// #1077 leveranse 3: «fyll inn ordet som mangler» (questionType «fill») hele veien, gjennom rutene.
// Alternativene er de godkjente svarene — fasiten — og går derfor ALDRI til deltakeren. Rettingen er
// rett eller galt; ett feil tegn godtas i svar på sju tegn eller mer (produkteier 2026-10-31).

const admin = {
  "x-user-id": "admin-1077-fill",
  "x-user-email": "admin.1077.fill@company.com",
  "x-user-name": "Admin 1077 fill",
  "x-user-roles": "ADMINISTRATOR",
};

const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
const ANSWERS = [L("three", "tre"), "3"];
const fill = (extra: Record<string, unknown> = {}) => ({
  questionType: "fill",
  stem: L("The deadline for an appeal is ___ weeks.", "Fristen for å klage er ___ uker."),
  options: ANSWERS,
  rationale: L("The regulation says three weeks.", "Forskriften sier tre uker."),
  ...extra,
});
const term = () => ({
  questionType: "fill",
  stem: L("The legal basis when the person agrees is ___.", "Grunnlaget når personen sier ja, er ___."),
  options: [L("consent", "samtykke")],
  rationale: L("Consent.", "Samtykke."),
});

async function createModule(questions: unknown[]) {
  const created = await request(app).post("/api/admin/content/modules").set(admin).send({
    title: L(`Fill ${Date.now()}`, `Fyll inn ${Date.now()}`),
    certificationLevel: "basic",
  });
  expect(created.status).toBe(201);
  const moduleId = created.body.module.id as string;
  const set = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`).set(admin).send({ title: L("Set", "Sett"), questions });
  return { moduleId, set };
}

async function publishVersion(moduleId: string, mcqSetVersionId: string) {
  const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin).send({
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(version.status, JSON.stringify(version.body)).toBe(201);
  return version.body.moduleVersion.id as string;
}

async function participantFor(name: string) {
  const externalId = `p-fill-${name}-${Date.now()}`;
  const user = await prisma.user.create({ data: { externalId, email: `${externalId}@company.com`, name } });
  const headers = { "x-user-id": externalId, "x-user-email": `${externalId}@company.com`, "x-user-name": name, "x-user-roles": "PARTICIPANT" };
  await request(app).post("/api/me/consent").set(headers).send({ consentVersion: "1.0" });
  return { user, headers };
}

describe("#1077 leveranse 3 — fyll inn ordet som mangler", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lagres med typen, de godkjente svarene som alternativer og ingen egen fasit", async () => {
    const { set } = await createModule([fill()]);
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    const [q] = await prisma.mCQQuestion.findMany({ where: { mcqSetVersionId: set.body.mcqSetVersion.id } });
    expect(q!.questionType).toBe("fill");
    expect(q!.answerKeyJson).toBeNull();
    expect(JSON.parse(q!.optionsJson)).toHaveLength(2);
  });

  it.each<[string, Record<string, unknown>]>([
    ["uten lukke", { stem: L("The deadline is three weeks.", "Fristen er tre uker.") }],
    ["to lukker", { stem: L("___ is ___ weeks.", "___ er ___ uker.") }],
    ["lukke bare på bokmål", { stem: L("The deadline is three weeks.", "Fristen er ___ uker.") }],
    ["samme svar to ganger", { options: ["tre", "tre"] }],
    ["sju godkjente svar", { options: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["correctAnswers på en fyll inn", { correctAnswers: ["tre"] }],
  ])("avvises: %s", async (_navn, extra) => {
    const { set } = await createModule([fill(extra)]);
    expect(set.status).toBe(400);
  });

  it("gjennom rutene: deltakeren får aldri de godkjente svarene; innlevering med textAnswer rettes", async () => {
    const { moduleId, set } = await createModule([fill(), term()]);
    const moduleVersionId = await publishVersion(moduleId, set.body.mcqSetVersion.id);
    const { user, headers } = await participantFor("rute");

    const attempt = async (answers: [string, string]) => {
      const submission = await prisma.submission.create({
        data: { userId: user.id, moduleId, moduleVersionId, submissionStatus: "SUBMITTED", deliveryType: "text", responseJson: "{}", submittedAt: new Date() },
      });
      const start = await request(app).get(`/api/modules/${moduleId}/mcq/start?submissionId=${submission.id}`).set(headers).set("x-locale", "nb");
      expect(start.status, JSON.stringify(start.body)).toBe(200);
      // Fasiten er alternativene — de finnes ikke i svaret, på noe språk.
      for (const q of start.body.questions) {
        expect(q.questionType).toBe("fill");
        expect(q.options).toEqual([]);
      }
      const sent = JSON.stringify(start.body);
      for (const secret of ["tre", "three", "samtykke", "consent"]) expect(sent).not.toMatch(new RegExp(`"${secret}"`));
      expect(start.body.questions[0].stem).toBe("Fristen for å klage er ___ uker.");

      const levert = await request(app).post(`/api/modules/${moduleId}/mcq/submit`).set(headers).send({
        submissionId: submission.id,
        attemptId: start.body.attemptId,
        responses: start.body.questions.map((q: { id: string }, i: number) => ({ questionId: q.id, textAnswer: answers[i] })),
      });
      expect(levert.status, JSON.stringify(levert.body)).toBe(200);
      return { submission, percent: levert.body.percentScore as number };
    };

    // Store bokstaver, tegnsetting og et annet språk: riktig. Ett tegn feil i et langt ord: riktig.
    expect((await attempt(["Tre.", "Samtyke"])).percent).toBe(100);
    expect((await attempt(["3", "consent"])).percent).toBe(100);
    // Et annet ord, og ett tegn feil i et kort ord: galt.
    expect((await attempt(["fire", "samtykke"])).percent).toBe(50);
    expect((await attempt(["tro", "avtale"])).percent).toBe(0);

    // Gjennomgangen etter levering viser det deltakeren skrev og de godkjente svarene.
    const feil = await attempt(["fire", "samtykke"]);
    const review = await getOwnedMcqReview(feil.submission.id, user.id, "nb");
    expect(review?.questions[0]).toMatchObject({ questionType: "fill", isCorrect: false, selectedAnswer: "fire", acceptedAnswers: ["tre", "3"], options: [] });
    const response = await prisma.mCQResponse.findFirstOrThrow({ where: { mcqAttempt: { submissionId: feil.submission.id }, selectedAnswer: "fire" } });
    expect(JSON.parse(response.answerJson!)).toEqual({ text: "fire" });

    // Kvalitetsrapporten: vanskegrad som for de andre typene, men ingen feilalternativer å telle.
    const report = await getMcqQualityReport({ moduleId }, "nb");
    const row = report.rows.find((r) => r.moduleId === moduleId);
    expect(row!.distractorUsage).toEqual([]);
  });

  it("ruta avviser to svarformer samtidig, og tar imot et tomt skrevet svar som galt", async () => {
    const { moduleId, set } = await createModule([fill()]);
    const moduleVersionId = await publishVersion(moduleId, set.body.mcqSetVersion.id);
    const { user, headers } = await participantFor("former");
    const submission = await prisma.submission.create({
      data: { userId: user.id, moduleId, moduleVersionId, submissionStatus: "SUBMITTED", deliveryType: "text", responseJson: "{}", submittedAt: new Date() },
    });
    const start = await request(app).get(`/api/modules/${moduleId}/mcq/start?submissionId=${submission.id}&locale=nb`).set(headers);
    const q = start.body.questions[0];
    const begge = await request(app).post(`/api/modules/${moduleId}/mcq/submit`).set(headers)
      .send({ submissionId: submission.id, attemptId: start.body.attemptId, responses: [{ questionId: q.id, textAnswer: "tre", selectedAnswer: "tre" }] });
    expect(begge.status).toBe(400);
    const tomt = await request(app).post(`/api/modules/${moduleId}/mcq/submit`).set(headers)
      .send({ submissionId: submission.id, attemptId: start.body.attemptId, responses: [{ questionId: q.id, textAnswer: "" }] });
    expect(tomt.status, JSON.stringify(tomt.body)).toBe(200);
    expect(tomt.body.percentScore).toBe(0);
  });

  it("eksport → import gir samme spørsmål tilbake", async () => {
    const { moduleId, set } = await createModule([fill()]);
    await publishVersion(moduleId, set.body.mcqSetVersion.id);
    const exported = await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(admin);
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    const q = (exported.body.envelope.module.activeVersion.mcqSet.questions as Array<Record<string, unknown>>)[0]!;
    expect(q).toMatchObject({ questionType: "fill", options: ANSWERS, correctAnswer: ANSWERS[0] });
    expect(q).not.toHaveProperty("correctAnswers");

    const imported = await request(app).post("/api/admin/content/modules/import").set(admin).send({ payload: exported.body.envelope, mode: "createNew" });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const importedVersion = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: imported.body.moduleVersionId } });
    const [copy] = await prisma.mCQQuestion.findMany({ where: { mcqSetVersionId: importedVersion.mcqSetVersionId! } });
    expect(copy!.questionType).toBe("fill");
  });
});
