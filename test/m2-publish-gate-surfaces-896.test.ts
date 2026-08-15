import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #896 S4, surface coverage. A gate on one route is not a gate — it is a detour sign.
//
// Publishing a module version can happen through four doors:
//   1. POST /modules/:id/module-versions/:vid/publish  — the author's own action (covered in
//      m2-publish-translation-gate-896.test.ts)
//   2. POST /admin/courses/:id/publish with publishItems — the cascade, covered here
//   3. import with autoPublish — covered here
//   4. calibration threshold publish — deliberately exempt; it re-publishes an already-live
//      version with new thresholds and no new text. See the note on
//      publishModuleVersionWithThresholds.
//
// Door 2 matters most: without it, "add the module to a course and publish the course" is a
// one-click bypass, and the participant sees the same half-translated module either way.

const adminHeaders = {
  "x-user-id": "admin-s4-surfaces",
  "x-user-email": "admin-s4-surfaces@company.com",
  "x-user-name": "Surface Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const rubric = {
  criteria: { clarity: { label: "Clarity", maxScore: 5, weight: 1, candidateVisible: true } },
  scalingRule: { max_total: 5 },
};
const promptTemplate = { systemPrompt: "You assess.", userPromptTemplate: "Assess: {{answer}}" };
const threeLocales = (base: string) => ({ "en-GB": `${base} EN`, nb: `${base} NB`, nn: `${base} NN` });
// MCQ content is gated too — see the note in m2-publish-translation-gate-896.test.ts.
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

async function createModule(taskText: unknown) {
  const moduleRes = await request(app)
    .post("/api/admin/content/modules")
    .set(adminHeaders)
    // certificationLevel is set explicitly because export emits it as null when unset and the
    // import schema rejects null — a round-trip defect of its own (#912), not something these
    // tests are about.
    .send({ title: threeLocales("Cascade gate"), certificationLevel: "foundation" });
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
  return moduleId;
}

async function createCourseWith(moduleId: string) {
  const courseRes = await request(app)
    .post("/api/admin/content/courses")
    .set(adminHeaders)
    .send({ title: threeLocales("Course"), description: threeLocales("Course description") });
  expect(courseRes.status).toBe(201);
  const courseId = courseRes.body.course.id as string;

  const itemsRes = await request(app)
    .put(`/api/admin/content/courses/${courseId}/items`)
    .set(adminHeaders)
    .send({ items: [{ type: "MODULE", moduleId }] });
  expect(itemsRes.status).toBe(204);
  return courseId;
}

describe("#896 S4 translation gate — every publish door", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("blocks the course cascade when a module in it is missing a locale", async () => {
    const moduleId = await createModule({ nb: "Norsk oppgave", "en-GB": "English task" });
    const courseId = await createCourseWith(moduleId);

    const preview = await request(app)
      .get(`/api/admin/content/courses/${courseId}/publish-preview`)
      .set(adminHeaders);
    expect(preview.status).toBe(200);
    // The preview is what the confirm dialog reads; it has to show the module as un-publishable,
    // otherwise the author confirms a cascade that then fails.
    const moduleItem = (preview.body.unpublishedItems as Array<Record<string, unknown>>)
      .find((item) => item.id === moduleId);
    expect(moduleItem?.publishable).toBe(false);
    const blockers = moduleItem?.blockers as Array<{ code: string; message: string }>;
    expect(blockers.some((b) => b.code === "translation_incomplete")).toBe(true);
    // The dialog prints `message` verbatim beside blockers written in Norwegian, so this one has
    // to read as a sentence — not as a leaked "taskText: missing nn".
    const message = blockers.find((b) => b.code === "translation_incomplete")!.message;
    expect(message).toContain("oppgavetekst");
    expect(message).toContain("nn");

    const publishRes = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(adminHeaders)
      .send({ publishItems: true });
    expect(publishRes.status).toBe(422);

    // Nothing published: neither the module nor the course.
    const moduleAfter = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true } });
    expect(moduleAfter?.activeVersionId).toBeNull();
    const courseAfter = await prisma.course.findUnique({ where: { id: courseId }, select: { publishedAt: true } });
    expect(courseAfter?.publishedAt).toBeNull();

    await request(app).delete(`/api/admin/content/courses/${courseId}`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("lets the course cascade through when every module is fully translated", async () => {
    const moduleId = await createModule(threeLocales("Task"));
    const courseId = await createCourseWith(moduleId);

    const publishRes = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(adminHeaders)
      .send({ publishItems: true });
    expect(publishRes.status).toBe(200);

    const moduleAfter = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true } });
    expect(moduleAfter?.activeVersionId).not.toBeNull();

    await request(app).post(`/api/admin/content/courses/${courseId}/unpublish`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/courses/${courseId}`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  // Import auto-publish mirrors "the source was live, so the copy should be live". That is the
  // right default — but only for a package that would survive the gate. A package missing a
  // language must still IMPORT (throwing away someone's import over a translation gap is worse
  // than the gap), it just must not go live: it lands as a draft, which is the agreed import
  // model anyway.
  it("imports a package missing a locale as a draft instead of auto-publishing it", async () => {
    const moduleId = await createModule(threeLocales("Task"));
    const versions = await prisma.moduleVersion.findMany({
      where: { moduleId },
      orderBy: { versionNo: "desc" },
      take: 1,
      select: { id: true },
    });
    const publishRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versions[0]!.id}/publish`)
      .set(adminHeaders)
      .send({});
    expect(publishRes.status).toBe(200);

    const exportRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package`)
      .set(adminHeaders);
    expect(exportRes.status).toBe(200);
    const envelope = exportRes.body.envelope;
    expect(envelope.module.activeVersion.audit.publishedAt).toBeTruthy();

    // Knock one language out of the package, as a hand-built or single-language export would be.
    delete envelope.module.activeVersion.taskText.nn;

    const importRes = await request(app)
      .post("/api/admin/content/modules/import")
      .set(adminHeaders)
      .send({ payload: envelope, mode: "createNew" });
    expect(importRes.status, JSON.stringify(importRes.body)).toBe(201);
    const importedId = importRes.body.moduleId as string;

    const imported = await prisma.module.findUnique({
      where: { id: importedId },
      select: { activeVersionId: true },
    });
    expect(imported?.activeVersionId).toBeNull();

    await request(app).delete(`/api/admin/content/modules/${importedId}`).set(adminHeaders);
    await request(app).post(`/api/admin/content/modules/${moduleId}/unpublish`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("still auto-publishes an imported package that has every locale", async () => {
    const moduleId = await createModule(threeLocales("Task"));
    const versions = await prisma.moduleVersion.findMany({
      where: { moduleId },
      orderBy: { versionNo: "desc" },
      take: 1,
      select: { id: true },
    });
    await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versions[0]!.id}/publish`)
      .set(adminHeaders)
      .send({})
      .expect(200);

    const exportRes = await request(app)
      .get(`/api/admin/content/modules/${moduleId}/export-package`)
      .set(adminHeaders);
    expect(exportRes.status).toBe(200);

    const importRes = await request(app)
      .post("/api/admin/content/modules/import")
      .set(adminHeaders)
      .send({ payload: exportRes.body.envelope, mode: "createNew" });
    expect(importRes.status).toBe(201);

    const imported = await prisma.module.findUnique({
      where: { id: importRes.body.moduleId as string },
      select: { activeVersionId: true },
    });
    expect(imported?.activeVersionId).not.toBeNull();

    await request(app).post(`/api/admin/content/modules/${importRes.body.moduleId}/unpublish`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${importRes.body.moduleId}`).set(adminHeaders);
    await request(app).post(`/api/admin/content/modules/${moduleId}/unpublish`).set(adminHeaders);
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });
});
