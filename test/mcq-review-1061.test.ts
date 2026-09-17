import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1061: gjennomgangen av flervalgsdelen er fasitens ENE dør. Den svarer tomt når modulversjonen
// ikke har slått den på, hele trekket med eget svar/riktig svar/begrunnelse når den har det, og
// aldri for en annens innlevering. Resultatkallet lekker ikke fasit i noen av tilfellene.
//
// Kjører mot seed-modulen «Generative AI Foundations» med en EGEN deltaker, så ingen annen test
// ser innleveringen. Policyen på den aktive modulversjonen endres og settes tilbake i samme test.

const participant = {
  "x-user-id": "participant-1061",
  "x-user-email": "participant-1061@company.com",
  "x-user-name": "Review Participant",
  "x-user-roles": "PARTICIPANT",
};
const other = {
  "x-user-id": "participant-1061-other",
  "x-user-email": "participant-1061-other@company.com",
  "x-user-name": "Other Participant",
  "x-user-roles": "PARTICIPANT",
};

async function seedModuleId(): Promise<string> {
  const modules = await request(app).get("/api/modules?includeCompleted=true").set(participant);
  expect(modules.status, JSON.stringify(modules.body)).toBe(200);
  const found = (modules.body.modules as Array<{ id: string; title: string }>).find((m) => m.title === "Generative AI Foundations");
  if (!found) throw new Error("Seed module not found.");
  return found.id;
}

async function submitMcq(moduleId: string, headers: Record<string, string>) {
  const created = await request(app).post("/api/submissions").set(headers).send({
    moduleId,
    deliveryType: "text",
    responseJson: { response: "En besvarelse.", reflection: "Refleksjon.", promptExcerpt: "Prompt." },
  });
  expect(created.status).toBe(201);
  const submissionId = created.body.submission.id as string;
  const started = await request(app).get(`/api/modules/${moduleId}/mcq/start`).query({ submissionId }).set(headers);
  expect(started.status).toBe(200);
  const questions = started.body.questions as Array<{ id: string; stem: string; options: string[] }>;
  // Første spørsmål svares bevisst med et alternativ som ikke er «Backend owns final decision»/
  // «Prompt versions and thresholds» der det er mulig, så minst ett blir feil.
  const responses = questions.map((q, i) => ({
    questionId: q.id,
    selectedAnswer: i === 0 ? q.options.find((o) => o !== "Backend owns final decision" && o !== "Prompt versions and thresholds") ?? q.options[0] : q.options[0],
  }));
  const submitted = await request(app)
    .post(`/api/modules/${moduleId}/mcq/submit`)
    .set(headers)
    .send({ submissionId, attemptId: started.body.attemptId, responses });
  expect(submitted.status).toBe(200);
  return { submissionId, askedIds: questions.map((q) => q.id) };
}

describe("#1061 mcq-review", () => {
  let moduleId: string;
  let versionId: string;
  let originalPolicyJson: string | null;

  beforeAll(async () => {
    moduleId = await seedModuleId();
    const mod = await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, select: { activeVersionId: true } });
    versionId = mod.activeVersionId!;
    originalPolicyJson = (await prisma.moduleVersion.findUniqueOrThrow({ where: { id: versionId } })).assessmentPolicyJson;
  });

  afterAll(async () => {
    await prisma.moduleVersion.update({ where: { id: versionId }, data: { assessmentPolicyJson: originalPolicyJson } });
    await prisma.$disconnect();
  });

  it("uten policy: enabled=false og tom liste — fasiten går ikke ut", async () => {
    await prisma.moduleVersion.update({ where: { id: versionId }, data: { assessmentPolicyJson: originalPolicyJson } });
    const { submissionId } = await submitMcq(moduleId, participant);
    const review = await request(app).get(`/api/submissions/${submissionId}/mcq-review`).set(participant);
    expect(review.status).toBe(200);
    expect(review.body).toEqual({ enabled: false, questions: [] });
    // Kontrollcase: resultatkallet inneholder ingen fasit heller.
    const result = await request(app).get(`/api/submissions/${submissionId}/result`).set(participant);
    expect(JSON.stringify(result.body)).not.toContain("correctAnswer");
  });

  it("med policy: hele trekket, i forsøkets rekkefølge, med eget svar, riktig svar, isCorrect og begrunnelse", async () => {
    const base = originalPolicyJson ? JSON.parse(originalPolicyJson) : {};
    await prisma.moduleVersion.update({
      where: { id: versionId },
      data: { assessmentPolicyJson: JSON.stringify({ ...base, mcq: { ...(base.mcq ?? {}), reviewAfterSubmit: true } }) },
    });
    const { submissionId, askedIds } = await submitMcq(moduleId, participant);
    const review = await request(app).get(`/api/submissions/${submissionId}/mcq-review`).set(participant).set("x-locale", "nb");
    expect(review.status).toBe(200);
    expect(review.body.enabled).toBe(true);
    const questions = review.body.questions as Array<{ id: string; stem: string; options: string[]; selectedAnswer: string | null; correctAnswer: string; isCorrect: boolean; rationale: string | null }>;
    // Samme spørsmål, samme rekkefølge som forsøket fikk.
    expect(questions.map((q) => q.id)).toEqual(askedIds);
    for (const q of questions) {
      expect(q.stem.length).toBeGreaterThan(0);
      expect(q.options.length).toBeGreaterThan(1);
      expect(q.options).toContain(q.correctAnswer);
      expect(typeof q.isCorrect).toBe("boolean");
      expect(q.selectedAnswer).not.toBeNull();
      expect(q.isCorrect).toBe(q.selectedAnswer === q.correctAnswer);
    }
    expect(questions.some((q) => !q.isCorrect), "minst ett svar skal være feil i oppsettet").toBe(true);
    // Fasiten går fortsatt ikke ut gjennom resultatet.
    const result = await request(app).get(`/api/submissions/${submissionId}/result`).set(participant);
    expect(JSON.stringify(result.body)).not.toContain("correctAnswer");
  });

  it("en annens innlevering: 404, ikke tom liste", async () => {
    const { submissionId } = await submitMcq(moduleId, participant);
    const review = await request(app).get(`/api/submissions/${submissionId}/mcq-review`).set(other);
    expect(review.status).toBe(404);
  });
});
