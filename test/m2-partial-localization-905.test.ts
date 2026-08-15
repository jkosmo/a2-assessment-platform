import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { localizedTextCodec } from "../src/codecs/localizedTextCodec.js";

// #905: an author writes in one language and has the rest translated afterwards. Until now the
// request schema could not express "nb is translated, nn is not" — it accepted a plain string
// or an object holding all three locales, nothing in between. A client whose translation partly
// failed therefore had to choose between a 400 and filling every locale with the source text,
// and the latter is what shipped: content that looks translated and reads as the wrong language.
//
// These tests pin the three shapes the field must now accept, and — the point of the exercise —
// that a missing locale STAYS missing, because the publish gate (#896 S4) and the translation
// status list (#894) can only measure a hole that is actually there.

const adminHeaders = {
  "x-user-id": "admin-905",
  "x-user-email": "admin-905@company.com",
  "x-user-name": "Localization Admin",
  "x-user-roles": "ADMINISTRATOR",
};

async function createModuleWithComponents() {
  const moduleRes = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    .send({ title: { "en-GB": "Partial locale module", nb: "Delvis modul", nn: "Delvis modul" } });
  expect(moduleRes.status).toBe(201);
  const moduleId = moduleRes.body.module.id as string;

  const rubricRes = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
    .set(adminHeaders)
    .send({
      criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } },
      scalingRule: { max_total: 5 },
      active: true,
    });
  expect(rubricRes.status).toBe(201);

  const promptRes = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
    .set(adminHeaders)
    .send({
      systemPrompt: "You assess practical answers.",
      userPromptTemplate: "Assess: {{answer}}",
      active: true,
    });
  expect(promptRes.status).toBe(201);

  const mcqRes = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`)
    .set(adminHeaders)
    .send({
      title: "Set",
      questions: [
        {
          stem: "Which is true?",
          options: ["This one", "Not this one"],
          correctAnswer: "This one",
          rationale: "Because it is.",
        },
      ],
    });
  expect(mcqRes.status).toBe(201);

  return {
    moduleId,
    rubricVersionId: rubricRes.body.rubricVersion.id as string,
    promptTemplateVersionId: promptRes.body.promptTemplateVersion.id as string,
    mcqSetVersionId: mcqRes.body.mcqSetVersion.id as string,
  };
}

describe("#905 partially translated module-version fields", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts a locale map missing a locale, and does not invent the missing one", async () => {
    const { moduleId, rubricVersionId, promptTemplateVersionId, mcqSetVersionId } =
      await createModuleWithComponents();

    // nb written, en-GB translated, nn never got there.
    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: { nb: "Norsk oppgavetekst", "en-GB": "English task text" },
        assessorExpectedContent: { nb: "Norsk forventning" },
        rubricVersionId,
        promptTemplateVersionId,
        mcqSetVersionId,
      });
    expect(res.status).toBe(201);

    const stored = await prisma.moduleVersion.findUnique({
      where: { id: res.body.moduleVersion.id as string },
      select: { taskText: true, assessorExpectedContent: true },
    });
    const taskText = localizedTextCodec.parse(stored?.taskText ?? null);
    const guidance = localizedTextCodec.parse(stored?.assessorExpectedContent ?? null);

    // The hole is the whole point: nn must be absent, not a copy of nb.
    expect(taskText).toEqual({ nb: "Norsk oppgavetekst", "en-GB": "English task text" });
    expect(taskText).not.toHaveProperty("nn");
    expect(guidance).toEqual({ nb: "Norsk forventning" });

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("still accepts a plain string as 'written in one language, not translated yet'", async () => {
    const { moduleId, rubricVersionId, promptTemplateVersionId, mcqSetVersionId } =
      await createModuleWithComponents();

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: "Bare norsk, ikke oversatt",
        assessorExpectedContent: "Bare norsk forventning",
        rubricVersionId,
        promptTemplateVersionId,
        mcqSetVersionId,
      });
    expect(res.status).toBe(201);

    const stored = await prisma.moduleVersion.findUnique({
      where: { id: res.body.moduleVersion.id as string },
      select: { taskText: true },
    });
    // Stored as the string it was - not expanded into three identical locales.
    expect(stored?.taskText).toBe("Bare norsk, ikke oversatt");

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("rejects an empty locale map, which carries no content at all", async () => {
    const { moduleId, rubricVersionId, promptTemplateVersionId, mcqSetVersionId } =
      await createModuleWithComponents();

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        taskText: {},
        assessorExpectedContent: { nb: "Norsk" },
        rubricVersionId,
        promptTemplateVersionId,
        mcqSetVersionId,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });
});
