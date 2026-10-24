import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { startMcqAttempt, submitMcqAttempt } from "../src/modules/assessment/mcqService.js";
import { getOwnedMcqReview } from "../src/modules/submission/mcqReviewService.js";

// #1077 leveranse 1: «velg alle som stemmer» (questionType «multiple») hele veien — forfatteren lager
// spørsmålet, feil former avvises, påfylling av banken og eksport → import beholder typen, deltakeren
// får typen men ikke fasiten, rettingen er rett eller galt (produkteier 2026-10-24), og gjennomgangen
// (#1061) viser hva som ble valgt og hva som var riktig.

const admin = {
  "x-user-id": "admin-1077",
  "x-user-email": "admin.1077@company.com",
  "x-user-name": "Admin 1077",
  "x-user-roles": "ADMINISTRATOR",
};

const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
const A = L("Purpose", "Formål");
const B = L("Colour", "Farge");
const C = L("Legal basis", "Behandlingsgrunnlag");
const D = L("Font", "Skrifttype");
const multiple = (extra: Record<string, unknown> = {}) => ({
  questionType: "multiple",
  stem: L("Which must a processing record state?", "Hva må en behandlingsprotokoll inneholde?"),
  options: [A, B, C, D],
  correctAnswers: [A, C],
  rationale: L("Art. 30.", "Art. 30."),
  ...extra,
});
const single = {
  stem: L("Who decides?", "Hvem bestemmer?"),
  options: [L("The controller", "Den behandlingsansvarlige"), L("The processor", "Databehandleren")],
  correctAnswer: L("The controller", "Den behandlingsansvarlige"),
};

async function createModule(questions: unknown[]) {
  const created = await request(app).post("/api/admin/content/modules").set(admin).send({
    title: L(`Multiple ${Date.now()}`, `Flere riktige ${Date.now()}`),
    certificationLevel: "basic",
  });
  expect(created.status).toBe(201);
  const moduleId = created.body.module.id as string;
  const set = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`).set(admin).send({
    title: L("Set", "Sett"),
    questions,
  });
  return { moduleId, set };
}

async function storedQuestions(mcqSetVersionId: string) {
  return prisma.mCQQuestion.findMany({ where: { mcqSetVersionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

describe("#1077 — velg alle som stemmer", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lagres med typen og fasiten som posisjoner; første riktige står som correctAnswer", async () => {
    const { set } = await createModule([multiple(), single]);
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    const [m, s] = await storedQuestions(set.body.mcqSetVersion.id);
    expect(m!.questionType).toBe("multiple");
    expect(JSON.parse(m!.answerKeyJson!)).toEqual({ correct: [0, 2] });
    expect(JSON.parse(m!.correctAnswer)).toMatchObject({ "en-GB": "Purpose" });
    // Kontroll: et vanlig spørsmål er som før.
    expect(s!.questionType).toBe("single");
    expect(s!.answerKeyJson).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ["alle alternativene riktige (ingenting å vurdere bort)", { correctAnswers: [A, B, C, D] }],
    ["et riktig svar som ikke er et alternativ", { correctAnswers: [A, L("Something else", "Noe annet")] }],
    ["ingen riktige", { correctAnswers: [] }],
    ["samme alternativ to ganger", { correctAnswers: [A, A] }],
  ])("avvises: %s", async (_navn, extra) => {
    const { set } = await createModule([multiple(extra)]);
    expect(set.status).toBe(400);
  });

  it("avvises: correctAnswers på et vanlig spørsmål", async () => {
    const { set } = await createModule([{ ...single, correctAnswers: [single.correctAnswer] }]);
    expect(set.status).toBe(400);
  });

  it("påfylling av banken beholder typen på spørsmålene som var der", async () => {
    const { moduleId, set } = await createModule([multiple()]);
    expect(set.status).toBe(201);
    const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin).send({
      assessmentMode: "MCQ_ONLY",
      mcqSetVersionId: set.body.mcqSetVersion.id,
      assessmentPolicy: { passRules: { mcqMinPercent: 60 } },
    });
    expect(version.status, JSON.stringify(version.body)).toBe(201);
    const appended = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-questions`).set(admin).send({ questions: [single] });
    expect(appended.status, JSON.stringify(appended.body)).toBe(201);
    const [kopi, ny] = await storedQuestions(appended.body.mcqSetVersionId);
    expect(kopi!.questionType).toBe("multiple");
    expect(JSON.parse(kopi!.answerKeyJson!)).toEqual({ correct: [0, 2] });
    expect(ny!.questionType).toBe("single");
  });

  it("eksport → import gir samme spørsmål tilbake", async () => {
    const { moduleId, set } = await createModule([multiple(), single]);
    const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin).send({
      assessmentMode: "MCQ_ONLY",
      mcqSetVersionId: set.body.mcqSetVersion.id,
      assessmentPolicy: { passRules: { mcqMinPercent: 60 } },
    });
    expect(version.status, JSON.stringify(version.body)).toBe(201);
    const exported = await request(app).get(`/api/admin/content/modules/${moduleId}/export-package`).set(admin);
    expect(exported.status, JSON.stringify(exported.body)).toBe(200);
    const questions = exported.body.envelope.module.activeVersion.mcqSet.questions as Array<Record<string, unknown>>;
    expect(questions[0]).toMatchObject({ questionType: "multiple", correctAnswers: [A, C] });
    expect(questions[0]).not.toHaveProperty("correctAnswer");
    // Et vanlig spørsmål går ut som før, uten typefelt — eldre importfiler og skillet kjenner det.
    expect(questions[1]).not.toHaveProperty("questionType");
    expect(questions[1]).toMatchObject({ correctAnswer: single.correctAnswer });

    const imported = await request(app).post("/api/admin/content/modules/import").set(admin).send({ payload: exported.body.envelope, mode: "createNew" });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const importedVersion = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: imported.body.moduleVersionId } });
    const [m, s] = await storedQuestions(importedVersion.mcqSetVersionId!);
    expect(m!.questionType).toBe("multiple");
    expect(JSON.parse(m!.answerKeyJson!)).toEqual({ correct: [0, 2] });
    expect(s!.questionType).toBe("single");
  });

  it("deltakeren får typen, ikke fasiten; rett eller galt; gjennomgangen viser valgt og riktig", async () => {
    const { moduleId, set } = await createModule([multiple()]);
    const versionRes = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(admin).send({
      assessmentMode: "MCQ_ONLY",
      mcqSetVersionId: set.body.mcqSetVersion.id,
      assessmentPolicy: { passRules: { mcqMinPercent: 60 }, mcq: { reviewAfterSubmit: true } },
    });
    expect(versionRes.status, JSON.stringify(versionRes.body)).toBe(201);
    const moduleVersionId = versionRes.body.moduleVersion.id as string;
    const user = await prisma.user.create({ data: { externalId: `p-1077-${Date.now()}`, email: `p-1077-${Date.now()}@company.com`, name: "Deltaker 1077" } });

    const attempt = async (choose: (options: string[]) => string[]) => {
      const submission = await prisma.submission.create({
        data: { userId: user.id, moduleId, moduleVersionId, submissionStatus: "SUBMITTED", deliveryType: "text", responseJson: "{}", submittedAt: new Date() },
      });
      const started = await startMcqAttempt(moduleId, submission.id, user.id, "nb");
      const q = started.questions[0]!;
      expect(q).toMatchObject({ questionType: "multiple" });
      expect(JSON.stringify(started)).not.toContain("correct");
      const done = await submitMcqAttempt({
        moduleId,
        submissionId: submission.id,
        attemptId: started.attemptId,
        userId: user.id,
        responses: [{ questionId: q.id, selectedAnswers: choose(q.options) }],
      });
      return { submission, done };
    };

    const riktig = await attempt(() => ["Formål", "Behandlingsgrunnlag"]);
    expect(riktig.done.percentScore).toBe(100);
    // Rekkefølgen og språket på valgene betyr ingenting; mengden gjør.
    expect((await attempt(() => ["Legal basis", "Formål"])).done.percentScore).toBe(100);
    // Én for mye, én for lite, eller et valg som ikke er et alternativ: galt — ingen delpoeng.
    expect((await attempt(() => ["Formål", "Behandlingsgrunnlag", "Farge"])).done.percentScore).toBe(0);
    expect((await attempt(() => ["Formål"])).done.percentScore).toBe(0);
    expect((await attempt(() => ["Formål", "Behandlingsgrunnlag", "Noe annet"])).done.percentScore).toBe(0);

    const response = await prisma.mCQResponse.findFirstOrThrow({ where: { mcqAttempt: { submissionId: riktig.submission.id } } });
    expect(JSON.parse(response.answerJson!)).toEqual({ selected: [0, 2] });
    expect(response.selectedAnswer).toBe("Formål · Behandlingsgrunnlag");

    const review = await getOwnedMcqReview(riktig.submission.id, user.id, "nb");
    expect(review?.questions[0]).toMatchObject({
      questionType: "multiple",
      isCorrect: true,
      correctAnswers: ["Formål", "Behandlingsgrunnlag"],
      selectedAnswers: ["Formål", "Behandlingsgrunnlag"],
    });
  });
});
