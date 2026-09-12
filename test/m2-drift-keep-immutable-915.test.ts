import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────
// #915: «Behold kriteriene» muterte rubrikkversjonen på stedet, og gjenoppretting løy om drift.
//
// 1. Lagre v1 med blueprint A og rubrikk R1 (hash A)
// 2. Endre til blueprint B, velg «Behold kriteriene» → FØR: R1 fikk hash B, ingen ny versjon
// 3. Gjenopprett v1 → ny versjon med blueprint A som peker på R1 — som nå sa hash B → falsk drift
//
// Nå lager «behold» en NY rubrikkversjon. R1 beholder hash A, og gjenopprettingen stemmer.
// ─────────────────────────────────────────────────────────────────────────────

const adminHeaders = {
  "x-user-id": "admin-915",
  "x-user-email": "admin-915@company.com",
  "x-user-name": "Drift Admin",
  "x-user-roles": "ADMINISTRATOR",
};
const tre = (base: string) => ({ "en-GB": `${base} EN`, nb: `${base} NB`, nn: `${base} NN` });
const HASH_A = "a".repeat(16);
const HASH_B = "b".repeat(16);

describe("#915 — «Behold kriteriene» lager en ny rubrikkversjon; den gamle er uforanderlig", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ R1 beholder hash A etter keep, og en gjenopprettet v1 peker fortsatt på R1", async () => {
    const moduleRes = await request(app).post("/api/admin/content/modules").set(adminHeaders)
      .send({ title: tre("Drift"), certificationLevel: "foundation" });
    expect(moduleRes.status).toBe(201);
    const moduleId = moduleRes.body.module.id as string;

    // v1: rubrikk generert fra blueprint A
    const v1 = await request(app).post(`/api/admin/content/modules/${moduleId}/versions`).set(adminHeaders).send({
      taskText: tre("Oppgave"),
      assessorExpectedContent: tre("Veiledning"),
      rubric: { criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } }, scalingRule: { max_total: 5, generated_from_blueprint_hash: HASH_A } },
      promptTemplate: { systemPrompt: "You assess.", userPromptTemplate: "Assess: {{answer}}" },
      mcqSet: { title: tre("Set"), questions: [{ stem: tre("Q?"), options: [tre("A"), tre("B")], correctAnswer: tre("A"), rationale: tre("Because.") }] },
    });
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    const v1Id = v1.body.moduleVersion.id as string;
    const r1Id = (await prisma.moduleVersion.findUniqueOrThrow({ where: { id: v1Id }, select: { rubricVersionId: true } })).rubricVersionId!;
    expect(r1Id).toBeTruthy();

    // «Behold kriteriene» under blueprint B
    const keep = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions/sync-blueprint`)
      .set(adminHeaders)
      .send({ blueprintHash: HASH_B, rubricVersionId: r1Id });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
    expect(keep.body.previousHash).toBe(HASH_A);
    expect(keep.body.nextHash).toBe(HASH_B);
    // ⚠️ Kjernen: en NY rad, ikke den gamle.
    expect(keep.body.rubricVersionId).not.toBe(r1Id);
    expect(keep.body.previousRubricVersionId).toBe(r1Id);

    const r1 = await prisma.rubricVersion.findUniqueOrThrow({ where: { id: r1Id }, select: { scalingRuleJson: true, versionNo: true } });
    expect(JSON.parse(r1.scalingRuleJson).generated_from_blueprint_hash, "R1 er uforandret").toBe(HASH_A);
    const r2 = await prisma.rubricVersion.findUniqueOrThrow({ where: { id: keep.body.rubricVersionId as string }, select: { scalingRuleJson: true, versionNo: true, criteriaJson: true } });
    expect(JSON.parse(r2.scalingRuleJson).generated_from_blueprint_hash).toBe(HASH_B);
    expect(r2.versionNo).toBe(r1.versionNo + 1);
    expect(r2.criteriaJson, "samme kriterier").toBe((await prisma.rubricVersion.findUniqueOrThrow({ where: { id: r1Id }, select: { criteriaJson: true } })).criteriaJson);

    // Gjenopprett v1: den peker på R1, som fortsatt sier A — ingen falsk drift.
    const restore = await request(app).post(`/api/admin/content/modules/${moduleId}/module-versions/${v1Id}/restore`).set(adminHeaders).send({});
    expect(restore.status, JSON.stringify(restore.body)).toBe(201);
    const restored = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: restore.body.moduleVersion.id as string }, select: { rubricVersionId: true } });
    expect(restored.rubricVersionId).toBe(r1Id);
  });

  it("keep med samme hash er en no-op — ingen ny rad for ingenting", async () => {
    const moduleRes = await request(app).post("/api/admin/content/modules").set(adminHeaders).send({ title: tre("Noop"), certificationLevel: "foundation" });
    const moduleId = moduleRes.body.module.id as string;
    const v1 = await request(app).post(`/api/admin/content/modules/${moduleId}/versions`).set(adminHeaders).send({
      taskText: tre("Oppgave"), assessorExpectedContent: tre("Veiledning"),
      rubric: { criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } }, scalingRule: { max_total: 5, generated_from_blueprint_hash: HASH_A } },
      promptTemplate: { systemPrompt: "You assess.", userPromptTemplate: "Assess: {{answer}}" },
      mcqSet: { title: tre("Set"), questions: [{ stem: tre("Q?"), options: [tre("A"), tre("B")], correctAnswer: tre("A"), rationale: tre("Because.") }] },
    });
    expect(v1.status).toBe(201);
    const før = await prisma.rubricVersion.count({ where: { moduleId } });
    const keep = await request(app).post(`/api/admin/content/modules/${moduleId}/rubric-versions/sync-blueprint`).set(adminHeaders).send({ blueprintHash: HASH_A });
    expect(keep.status).toBe(200);
    expect(await prisma.rubricVersion.count({ where: { moduleId } })).toBe(før);
  });
});
