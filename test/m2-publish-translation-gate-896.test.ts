import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { missingLocalesFor } from "../src/modules/adminContent/contentValidationService.js";

// #896 S4: publishing is the moment content reaches participants, so it is where a
// half-translated module has to stop.
//
// This gate is only possible because of #905. Before it, a field whose translation had failed
// was stored as three identical copies of the source text — structurally identical to a genuine
// translation. The gate would have been a door with no wall: it could not see the hole it was
// meant to guard.

const adminHeaders = {
  "x-user-id": "admin-s4",
  "x-user-email": "admin-s4@company.com",
  "x-user-name": "Publish Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const rubric = {
  criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } },
  scalingRule: { max_total: 5 },
};
const promptTemplate = { systemPrompt: "You assess.", userPromptTemplate: "Assess: {{answer}}" };
const mcqSet = {
  title: "Set",
  questions: [{ stem: "Q?", options: ["A", "B"], correctAnswer: "A", rationale: "Because." }],
};
const threeLocales = (base: string) => ({ "en-GB": `${base} EN`, nb: `${base} NB`, nn: `${base} NN` });

async function createModuleWithVersion(taskText: unknown) {
  const moduleRes = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    .send({ title: threeLocales("Publish gate") });
  expect(moduleRes.status).toBe(201);
  const moduleId = moduleRes.body.module.id as string;

  const versionRes = await request(app)
    .post(`/api/admin/content/modules/${moduleId}/versions`)
    .set(adminHeaders)
    .send({
      taskText,
      assessorExpectedContent: threeLocales("Guidance"),
      rubric,
      promptTemplate,
      mcqSet,
    });
  expect(versionRes.status).toBe(201);
  return { moduleId, moduleVersionId: versionRes.body.moduleVersion.id as string };
}

describe("#896 S4 translation gate on publish", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("missingLocalesFor", () => {
    it("treats a plain string as translated only into the working language", () => {
      // The agreed encoding for "written once, not translated yet" (#892/#905).
      expect(missingLocalesFor("Bare norsk", "nb").sort()).toEqual(["en-GB", "nn"]);
    });

    it("names exactly the locales a partial object is missing", () => {
      expect(missingLocalesFor(JSON.stringify({ nb: "Norsk", "en-GB": "English" }))).toEqual(["nn"]);
    });

    it("passes a complete object", () => {
      expect(missingLocalesFor(JSON.stringify(threeLocales("Complete")))).toEqual([]);
    });

    it("says nothing about a field that has no value at all", () => {
      // An absent optional field is not an untranslated one.
      expect(missingLocalesFor(null)).toEqual([]);
    });
  });

  it("blocks publishing a version whose task text is missing a locale, and names the gap", async () => {
    const { moduleId, moduleVersionId } = await createModuleWithVersion({ nb: "Norsk oppgave", "en-GB": "English task" });

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionId}/publish`)
      .set(adminHeaders)
      .send({});

    expect(res.status).toBe(422);
    const codes = (res.body.issues ?? []).map((i: { code: string }) => i.code);
    expect(codes).toContain("translation_incomplete");
    // The message has to say which field and which language, or the author cannot act on it.
    const message = (res.body.issues ?? [])
      .filter((i: { code: string }) => i.code === "translation_incomplete")
      .map((i: { message: string }) => i.message)
      .join(" ");
    expect(message).toContain("taskText");
    expect(message).toContain("nn");

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("lets a fully translated version through", async () => {
    const { moduleId, moduleVersionId } = await createModuleWithVersion(threeLocales("Task"));

    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${moduleVersionId}/publish`)
      .set(adminHeaders)
      .send({});

    expect(res.status).toBe(200);

    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });
});
