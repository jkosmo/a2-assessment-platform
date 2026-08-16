import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #896 S6: the workspace's export/import round trip, against the REAL endpoints.
//
// This file exists because the e2e did not catch a total failure. The client sent
// `targetModuleId` where the schema requires `targetId`; Zod strips unknown keys, so every single
// import 400'd — and the Playwright test passed, because it mocked the endpoint and only inspected
// the body it had itself constructed. A mock cannot reject a field name it was never taught.
//
// The rule this encodes: when the client and server agree on a contract, at least one test has to
// exercise BOTH sides of it.

const adminHeaders = {
  "x-user-id": "admin-s6",
  "x-user-email": "admin-s6@company.com",
  "x-user-name": "Workspace Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const threeLocales = (base: string) => ({ "en-GB": `${base} EN`, nb: `${base} NB`, nn: `${base} NN` });
const rubric = {
  criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } },
  scalingRule: { max_total: 5 },
};
const promptTemplate = { systemPrompt: "You assess.", userPromptTemplate: "Assess: {{answer}}" };
const mcqSet = {
  title: threeLocales("Set"),
  questions: [
    {
      stem: threeLocales("Q?"),
      options: [threeLocales("A"), threeLocales("B")],
      correctAnswer: threeLocales("A"),
      rationale: threeLocales("Because."),
    },
  ],
};

async function createModule(taskText: string) {
  const res = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    .send({ title: threeLocales(taskText), certificationLevel: "foundation" });
  expect(res.status).toBe(201);
  return res.body.module.id as string;
}

async function addVersion(moduleId: string, taskText: string) {
  const res = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/versions`)
    .set(adminHeaders)
    .send({
      taskText: threeLocales(taskText),
      assessorExpectedContent: threeLocales("Guidance"),
      rubric,
      promptTemplate,
      mcqSet,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.moduleVersion.id as string;
}

describe("#896 S6 workspace export/import", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("imports a package into the module it is given, as a new unpublished version", async () => {
    const source = await createModule("Source");
    const sourceVersion = await addVersion(source, "Source scenario");
    await request(app)
      .post(`/api/admin/content/modules/${source}/module-versions/${sourceVersion}/publish`)
      .set(adminHeaders)
      .send({})
      .expect(200);

    const exportRes = await request(app)
      .get(`/api/admin/content/modules/${source}/export-package`)
      .set(adminHeaders);
    expect(exportRes.status, JSON.stringify(exportRes.body)).toBe(200);

    const target = await createModule("Target");
    await addVersion(target, "Target scenario");

    // Exactly the body the workspace sends. `targetId` — not `targetModuleId`, which the schema
    // strips, producing a 400 the client reported as a generic import failure.
    const importRes = await request(app)
      .post("/api/admin/content/modules/import")
      .set(adminHeaders)
      .send({
        payload: exportRes.body.envelope,
        mode: "replaceExisting",
        targetId: target,
        autoPublish: false,
      });
    expect(importRes.status, JSON.stringify(importRes.body)).toBe(201);
    expect(importRes.body.moduleId).toBe(target);

    // A new version on the SAME module, not a new module beside it.
    const versions = await prisma.moduleVersion.findMany({
      where: { moduleId: target },
      orderBy: { versionNo: "asc" },
      select: { id: true, taskText: true },
    });
    expect(versions).toHaveLength(2);
    expect(versions[1]!.taskText).toContain("Source scenario");

    // Unpublished, even though the source was live.
    const targetModule = await prisma.module.findUnique({
      where: { id: target },
      select: { activeVersionId: true, title: true },
    });
    expect(targetModule?.activeVersionId).toBeNull();
    // And the module keeps its own identity — the package's title does not overwrite it.
    expect(targetModule?.title).toContain("Target");

    await request(app).delete(`/api/admin/content/modules/${target}`).set(adminHeaders);
    await request(app).post(`/api/admin/content/modules/${source}/unpublish`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${source}`).set(adminHeaders);
  });

  it("exports the version asked for, not just the published one", async () => {
    // The workspace shows the newest draft. Exporting the live version instead meant the author's
    // most recent work silently did not travel.
    const moduleId = await createModule("Export");
    const v1 = await addVersion(moduleId, "First scenario");
    await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${v1}/publish`)
      .set(adminHeaders)
      .send({})
      .expect(200);
    const v2 = await addVersion(moduleId, "Second scenario");

    const live = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package`)
      .set(adminHeaders);
    expect(live.status).toBe(200);
    // Default: the live version, which is what the module list and course export want.
    expect(JSON.stringify(live.body.envelope.module.activeVersion.taskText)).toContain("First scenario");

    const shown = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package?moduleVersionId=${v2}`)
      .set(adminHeaders);
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
    expect(JSON.stringify(shown.body.envelope.module.activeVersion.taskText)).toContain("Second scenario");

    await request(app).post(`/api/admin/content/modules/${moduleId}/unpublish`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("refuses a version id that belongs to another module", async () => {
    const a = await createModule("A");
    await addVersion(a, "A scenario");
    const b = await createModule("B");
    const bVersion = await addVersion(b, "B scenario");

    const res = await request(app)
      .get(`/api/admin/content/modules/${a}/export-package?moduleVersionId=${bVersion}`)
      .set(adminHeaders);
    expect(res.status).toBe(404);

    await request(app).delete(`/api/admin/content/modules/${a}`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${b}`).set(adminHeaders);
  });

  it("is idempotent on retry, so one package does not become two versions", async () => {
    const source = await createModule("Idem source");
    await addVersion(source, "Idem scenario");
    const exportRes = await request(app)
      .get(`/api/admin/content/modules/${source}/export-package`)
      .set(adminHeaders);
    expect(exportRes.status).toBe(200);

    const target = await createModule("Idem target");
    await addVersion(target, "Target scenario");
    const key = `import-${Date.now()}`;

    const body = {
      payload: exportRes.body.envelope,
      mode: "replaceExisting",
      targetId: target,
      autoPublish: false,
    };
    const first = await request(app)
      .post("/api/admin/content/modules/import")
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send(body);
    const second = await request(app)
      .post("/api/admin/content/modules/import")
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send(body);

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.body.moduleVersionId).toBe(first.body.moduleVersionId);
    const versions = await prisma.moduleVersion.findMany({ where: { moduleId: target } });
    expect(versions).toHaveLength(2);

    await request(app).delete(`/api/admin/content/modules/${target}`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${source}`).set(adminHeaders);
  });
});
