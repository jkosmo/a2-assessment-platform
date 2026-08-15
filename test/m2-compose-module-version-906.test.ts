import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #906: saving a module used to be five independent calls — title PATCH, rubric, prompt, MCQ,
// then the module version tying them together. Each committed on its own, so a failure on the
// last step left a renamed module with orphaned component versions and no version referencing
// them; retrying produced a second set.
//
// POST /modules/:id/versions composes the whole thing in one transaction. The test that matters
// is the failure one: when the composition is rejected, NOTHING may remain.

const adminHeaders = {
  "x-user-id": "admin-906",
  "x-user-email": "admin-906@company.com",
  "x-user-name": "Compose Admin",
  "x-user-roles": "ADMINISTRATOR",
};

async function createModule(title: string) {
  const res = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    .send({ title: { "en-GB": title, nb: title, nn: title } });
  expect(res.status).toBe(201);
  return res.body.module.id as string;
}

const rubric = {
  criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } },
  scalingRule: { max_total: 5 },
};
const promptTemplate = {
  systemPrompt: "You assess practical answers.",
  userPromptTemplate: "Assess: {{answer}}",
};
const mcqSet = {
  title: "Set",
  questions: [
    {
      stem: "Which is true?",
      options: ["This one", "Not this one"],
      correctAnswer: "This one",
      rationale: "Because it is.",
    },
  ],
};

describe("#906 composed module version", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates the version and every component it references in one call", async () => {
    const moduleId = await createModule("Compose happy path");

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ taskText: "Oppgaveteksten", rubric, promptTemplate, mcqSet });

    expect(res.status).toBe(201);
    expect(res.body.moduleVersion?.id).toBeTruthy();
    expect(res.body.rubricVersion?.id).toBeTruthy();
    expect(res.body.promptTemplateVersion?.id).toBeTruthy();
    expect(res.body.mcqSetVersion?.id).toBeTruthy();

    // The version points at the components created in the same call.
    const stored = await prisma.moduleVersion.findUnique({
      where: { id: res.body.moduleVersion.id as string },
      select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    });
    expect(stored?.rubricVersionId).toBe(res.body.rubricVersion.id);
    expect(stored?.promptTemplateVersionId).toBe(res.body.promptTemplateVersion.id);
    expect(stored?.mcqSetVersionId).toBe(res.body.mcqSetVersion.id);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("leaves nothing behind when the composition fails", async () => {
    const moduleId = await createModule("Compose rollback");

    // FREETEXT_PLUS_MCQ (the default) requires an MCQ set. Sending a rubric and prompt but no
    // MCQ makes createModuleVersion reject AFTER the rubric and prompt have been created inside
    // the transaction — precisely the sequence that used to leave orphans behind.
    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ taskText: "Oppgaveteksten", rubric, promptTemplate });

    expect(res.status).toBe(400);

    const [versions, rubrics, prompts] = await Promise.all([
      prisma.moduleVersion.count({ where: { moduleId } }),
      prisma.rubricVersion.count({ where: { moduleId } }),
      prisma.promptTemplateVersion.count({ where: { moduleId } }),
    ]);

    // The rollback is the whole point: no half-written module.
    expect(versions).toBe(0);
    expect(rubrics).toBe(0);
    expect(prompts).toBe(0);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("reuses component versions passed by id instead of creating new ones", async () => {
    const moduleId = await createModule("Compose reuse");

    const first = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ taskText: "Foerste", rubric, promptTemplate, mcqSet });
    expect(first.status).toBe(201);

    // A second version that only changes the task text should not fork the rubric.
    const second = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({
        taskText: "Andre",
        rubricVersionId: first.body.rubricVersion.id,
        promptTemplateVersionId: first.body.promptTemplateVersion.id,
        mcqSetVersionId: first.body.mcqSetVersion.id,
      });
    expect(second.status).toBe(201);
    expect(second.body.rubricVersion).toBeNull();

    const rubricCount = await prisma.rubricVersion.count({ where: { moduleId } });
    expect(rubricCount).toBe(1);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("denies composing a version on a module the caller does not own", async () => {
    const moduleId = await createModule("Compose ownership");

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set({
        "x-user-id": "smo-906-other",
        "x-user-email": "smo-906-other@company.com",
        "x-user-name": "Other SMO",
        "x-user-roles": "SUBJECT_MATTER_OWNER",
      })
      .send({ taskText: "Oppgaveteksten", rubric, promptTemplate, mcqSet });

    expect(res.status).toBe(403);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });
});
