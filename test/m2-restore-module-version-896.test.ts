import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #896 S5: returning to an earlier draft.
//
// The load-bearing decision is that history is APPEND-ONLY. Restoring copies the chosen version's
// content forward into a new version rather than rewinding the module to it, so:
//   - the versions created after the restored one stay in the list, and
//   - "I restored the wrong one" is itself undoable.
// Rewinding would make restore the one action in this workspace that destroys work.
//
// The second decision: a restored version is a DRAFT even when its source was published. Restoring
// says "go back to this text", not "put this in front of participants".

const adminHeaders = {
  "x-user-id": "admin-s5",
  "x-user-email": "admin-s5@company.com",
  "x-user-name": "Restore Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const otherAdminHeaders = {
  "x-user-id": "admin-s5-other",
  "x-user-email": "admin-s5-other@company.com",
  "x-user-name": "Other Admin",
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

async function createModuleWithVersions(taskTexts: string[]) {
  const moduleRes = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    .send({ title: threeLocales("Restore"), certificationLevel: "foundation" });
  expect(moduleRes.status).toBe(201);
  const moduleId = moduleRes.body.module.id as string;

  const versionIds: string[] = [];
  for (const taskText of taskTexts) {
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
    versionIds.push(res.body.moduleVersion.id as string);
  }
  return { moduleId, versionIds };
}

describe("#896 S5 restoring an earlier module version", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("copies the chosen version forward as a new draft and leaves the history intact", async () => {
    const { moduleId, versionIds } = await createModuleWithVersions(["First", "Second", "Third"]);

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionIds[0]}/restore`)
      .set(adminHeaders)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const restored = res.body.moduleVersion;
    // A NEW version, not the old one handed back.
    expect(restored.id).not.toBe(versionIds[0]);
    expect(restored.versionNo).toBe(4);
    expect(restored.publishedAt).toBeNull();

    // The content is the first version's.
    const first = await prisma.moduleVersion.findUnique({
      where: { id: versionIds[0] },
      select: { taskText: true, rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    });
    const after = await prisma.moduleVersion.findUnique({
      where: { id: restored.id as string },
      select: { taskText: true, rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    });
    expect(after?.taskText).toBe(first?.taskText);
    // Component versions are REFERENCED, not copied: they are immutable rows, so pointing at the
    // same ones reproduces the source exactly without adding rows nobody can tell apart.
    expect(after?.rubricVersionId).toBe(first?.rubricVersionId);
    expect(after?.promptTemplateVersionId).toBe(first?.promptTemplateVersionId);
    expect(after?.mcqSetVersionId).toBe(first?.mcqSetVersionId);

    // Nothing was removed. Restoring the wrong version has to be undoable.
    const all = await prisma.moduleVersion.findMany({ where: { moduleId }, select: { id: true } });
    expect(all).toHaveLength(4);
    for (const id of versionIds) {
      expect(all.some((v) => v.id === id)).toBe(true);
    }

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("restores a published version as a draft, leaving the live version untouched", async () => {
    const { moduleId, versionIds } = await createModuleWithVersions(["First", "Second"]);

    await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionIds[1]}/publish`)
      .set(adminHeaders)
      .send({})
      .expect(200);

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionIds[1]}/restore`)
      .set(adminHeaders)
      .send({});
    expect(res.status).toBe(201);
    // Restoring is not publishing. The copy is a draft, and it still has to clear the translation
    // gate before it can reach a participant.
    expect(res.body.moduleVersion.publishedAt).toBeNull();

    const module = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true } });
    expect(module?.activeVersionId).toBe(versionIds[1]);

    await request(app).post(`/api/admin/content/modules/${moduleId}/unpublish`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("carries the assessment mode, so restoring an MCQ-only version does not change the module type", async () => {
    const moduleRes = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({ title: threeLocales("MCQ only restore") });
    const moduleId = moduleRes.body.module.id as string;

    const mcqOnly = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ assessmentMode: "MCQ_ONLY", mcqSet, assessmentPolicy: { passRules: { mcqMinPercent: 80 } } });
    expect(mcqOnly.status, JSON.stringify(mcqOnly.body)).toBe(201);

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${mcqOnly.body.moduleVersion.id}/restore`)
      .set(adminHeaders)
      .send({});
    expect(res.status).toBe(201);

    const restored = await prisma.moduleVersion.findUnique({
      where: { id: res.body.moduleVersion.id as string },
      select: { assessmentMode: true, assessmentPolicyJson: true },
    });
    // assessmentMode defaults to FREETEXT_PLUS_MCQ in the schema, so a clone that forgets to carry
    // it silently converts the module to a different type.
    expect(restored?.assessmentMode).toBe("MCQ_ONLY");
    expect(restored?.assessmentPolicyJson).toContain("80");

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("refuses a version id that belongs to a different module", async () => {
    // Without the ownership check on the VERSION (not just the module), this would graft another
    // module's content onto this one.
    const a = await createModuleWithVersions(["A"]);
    const b = await createModuleWithVersions(["B"]);

    const res = await request(app)
      .post(`/api/admin/content/modules/${a.moduleId}/module-versions/${b.versionIds[0]}/restore`)
      .set(adminHeaders)
      .send({});
    expect(res.status).toBe(404);

    const versions = await prisma.moduleVersion.findMany({ where: { moduleId: a.moduleId } });
    expect(versions).toHaveLength(1);

    await request(app).delete(`/api/admin/content/modules/${a.moduleId}`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${b.moduleId}`).set(adminHeaders);
  });

  it("records who restored what, and from which version", async () => {
    const { moduleId, versionIds } = await createModuleWithVersions(["First", "Second"]);

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionIds[0]}/restore`)
      .set(adminHeaders)
      .send({});
    expect(res.status).toBe(201);

    const event = await prisma.auditEvent.findFirst({
      where: { action: "module_version_restored", entityId: res.body.moduleVersion.id as string },
      select: { metadataJson: true },
    });
    expect(event).not.toBeNull();
    // The new version's content did not come from an author editing. Which version it was copied
    // from is the only way to read the history correctly afterwards.
    const metadata = JSON.parse(event!.metadataJson as string);
    expect(metadata.sourceModuleVersionId).toBe(versionIds[0]);
    expect(metadata.sourceVersionNo).toBe(1);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("is idempotent on retry, so a double-click does not create two versions", async () => {
    const { moduleId, versionIds } = await createModuleWithVersions(["First"]);
    const key = `restore-${Date.now()}`;

    const first = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionIds[0]}/restore`)
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send({});
    const second = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionIds[0]}/restore`)
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send({});

    expect(first.status).toBe(201);
    expect(second.body.moduleVersion.id).toBe(first.body.moduleVersion.id);
    const versions = await prisma.moduleVersion.findMany({ where: { moduleId } });
    expect(versions).toHaveLength(2);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("refuses a caller who does not own the module", async () => {
    const { moduleId, versionIds } = await createModuleWithVersions(["First"]);

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionIds[0]}/restore`)
      .set({ ...otherAdminHeaders, "x-user-roles": "SUBJECT_MATTER_OWNER" })
      .send({});
    expect(res.status).toBe(403);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });
});
