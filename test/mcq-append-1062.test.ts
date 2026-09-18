import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1062 leveranse 3: POST /modules/:id/mcq-questions fyller på banken — ny MCQSetVersion med gamle +
// nye, ny modulversjon som utkast, ingenting annet endret og ingenting publisert. Eieren kan; en
// annen SMO kan ikke; agent-token kan (additivt og utkast-bare, i motsetning til replaceExisting).

const owner = {
  "x-user-id": "smo-append-1062",
  "x-user-email": "smo.append1062@company.com",
  "x-user-name": "Append Owner",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};
const stranger = {
  "x-user-id": "smo-append-1062-other",
  "x-user-email": "smo.append1062.other@company.com",
  "x-user-name": "Append Stranger",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const L = (en: string, nb: string, nn: string) => ({ "en-GB": en, nb, nn });
const q = (n: number) => ({
  stem: L(`Stem ${n}`, `Stamme ${n}`, `Stamme ${n}`),
  options: [L(`Right ${n}`, `Rett ${n}`, `Rett ${n}`), L(`Wrong ${n}`, `Feil ${n}`, `Feil ${n}`)],
  correctAnswer: L(`Right ${n}`, `Rett ${n}`, `Rett ${n}`),
  rationale: L(`Because ${n}`, `Fordi ${n}`, `Fordi ${n}`),
});

async function createMcqOnlyModule(): Promise<{ moduleId: string; versionId: string }> {
  const created = await request(app).post("/api/admin/content/modules").set(owner).send({
    title: L(`Append test ${Date.now()}`, "Påfyllingstest", "Påfyllingstest"),
    certificationLevel: "basic",
  });
  expect(created.status).toBe(201);
  const moduleId = created.body.module.id as string;
  const set = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`).set(owner).send({
    title: L("Bank", "Bank", "Bank"),
    questions: [q(1), q(2)],
  });
  expect(set.status).toBe(201);
  const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(owner).send({
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: set.body.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 60 }, mcq: { questionsPerAttempt: 1 } },
  });
  expect(version.status, JSON.stringify(version.body)).toBe(201);
  return { moduleId, versionId: version.body.moduleVersion.id as string };
}

describe("#1062 append MCQ questions", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("eieren legger til to spørsmål: banken er 2 + 2, ny utkastversjon med samme policy, ingenting publisert", async () => {
    const { moduleId, versionId } = await createMcqOnlyModule();
    const res = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-questions`).set(owner).send({ questions: [q(3), q(4)] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.existingCount).toBe(2);
    expect(res.body.addedCount).toBe(2);
    const newVersion = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: res.body.moduleVersion.id } });
    expect(newVersion.id).not.toBe(versionId);
    expect(newVersion.publishedAt).toBeNull();
    expect(newVersion.assessmentMode).toBe("MCQ_ONLY");
    expect(JSON.parse(newVersion.assessmentPolicyJson ?? "{}")).toMatchObject({ mcq: { questionsPerAttempt: 1 } });
    const questions = await prisma.mCQQuestion.findMany({ where: { mcqSetVersionId: res.body.mcqSetVersionId }, orderBy: { createdAt: "asc" } });
    expect(questions).toHaveLength(4);
    const stems = questions.map((x) => JSON.parse(x.stem)["en-GB"]);
    expect(stems).toEqual(["Stem 1", "Stem 2", "Stem 3", "Stem 4"]);
    // Modulen er fortsatt upublisert — påfylling publiserer aldri.
    const mod = await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, select: { activeVersionId: true } });
    expect(mod.activeVersionId).toBeNull();
  });

  it("en annen fagansvarlig får 403; tom liste og feil fasit avvises med 400", async () => {
    const { moduleId } = await createMcqOnlyModule();
    const other = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-questions`).set(stranger).send({ questions: [q(9)] });
    expect(other.status).toBe(403);
    const empty = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-questions`).set(owner).send({ questions: [] });
    expect(empty.status).toBe(400);
    const badKey = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-questions`).set(owner).send({
      questions: [{ ...q(9), correctAnswer: L("Nope", "Nei", "Nei") }],
    });
    expect(badKey.status).toBe(400);
  });

  it("en fritekstmodul uten flervalg får 409 module_has_no_mcq", async () => {
    const created = await request(app).post("/api/admin/content/modules").set(owner).send({
      title: L(`No mcq ${Date.now()}`, "Uten flervalg", "Utan fleirval"), certificationLevel: "basic",
    });
    const moduleId = created.body.module.id as string;
    const rubric = await request(app).post(`/api/admin/content/modules/${moduleId}/rubric-versions`).set(owner).send({
      criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 4 },
    });
    const prompt = await request(app).post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`).set(owner).send({
      systemPrompt: L("sys", "sys", "sys"), userPromptTemplate: L("user {{submission}}", "user {{submission}}", "user {{submission}}"), examples: [],
    });
    const version = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions`).set(owner).send({
      assessmentMode: "FREETEXT_ONLY",
      taskText: L("Task", "Oppgave", "Oppgåve"),
      assessorExpectedContent: L("Expect", "Forvent", "Forvent"),
      rubricVersionId: rubric.body.rubricVersion.id,
      promptTemplateVersionId: prompt.body.promptTemplateVersion.id,
    });
    expect(version.status, JSON.stringify(version.body)).toBe(201);
    const res = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-questions`).set(owner).send({ questions: [q(1)] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("module_has_no_mcq");
  });

  it("et agent-token (utkast-bare) kan fylle på — det kan ikke replaceExisting", async () => {
    const { moduleId } = await createMcqOnlyModule();
    const issued = await request(app).post("/api/admin/content/agent-authoring/tokens").set(owner).send({ label: "append-1062" });
    expect(issued.status).toBe(201);
    const bearer = { authorization: `Bearer ${issued.body.token}` };
    const res = await request(app).post(`/api/admin/content/modules/${moduleId}/mcq-questions`).set(bearer).send({ questions: [q(5)] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.existingCount).toBe(2);
    expect(res.body.addedCount).toBe(1);
  });
});
