import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { auditActions, auditEntityTypes } from "../src/observability/auditEvents.js";

// #762 — ADMINISTRATOR-only cascade delete of a course + the modules/sections it exclusively owns.
// Verifies the safety model: exclusive deletable content is removed (incl. version rows), shared
// content is spared (only unlinked), and preserved records (submissions/certifications/completions)
// block the whole operation so nothing is destroyed.

const adminHeaders = {
  "x-user-id": "cascade-admin-1",
  "x-user-email": "cascade-admin@company.com",
  "x-user-name": "Cascade Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const smoHeaders = {
  "x-user-id": "cascade-smo-1",
  "x-user-email": "cascade-smo@company.com",
  "x-user-name": "Cascade SMO",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

let seq = 0;
const uniq = () => `ccd-${Date.now()}-${seq++}`;

const courseIds: string[] = [];
const moduleIds: string[] = [];
const sectionIds: string[] = [];
const userIds: string[] = [];

// A module with a full version chain (moduleVersion → rubric/prompt/mcq-set + mcqQuestion) and an
// active (published) version, so the cascade must null the active pointer and clean up every row.
async function makeRichModule(): Promise<string> {
  const module = await prisma.module.create({ data: { title: `CCD Module ${uniq()}` }, select: { id: true } });
  moduleIds.push(module.id);
  const rubric = await prisma.rubricVersion.create({
    data: { moduleId: module.id, versionNo: 1, criteriaJson: "{}", scalingRuleJson: "{}", active: true },
    select: { id: true },
  });
  const prompt = await prisma.promptTemplateVersion.create({
    data: { moduleId: module.id, versionNo: 1, systemPrompt: "sys", userPromptTemplate: "usr", examplesJson: "[]", active: true },
    select: { id: true },
  });
  const mcqSet = await prisma.mCQSetVersion.create({
    data: { moduleId: module.id, versionNo: 1, title: "set", active: true },
    select: { id: true },
  });
  await prisma.mCQQuestion.create({
    data: { moduleId: module.id, mcqSetVersionId: mcqSet.id, stem: "q", optionsJson: "[]", correctAnswer: "a", active: true },
  });
  const version = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: JSON.stringify({ "en-GB": "Task text long enough for assessment." }),
      rubricVersionId: rubric.id,
      promptTemplateVersionId: prompt.id,
      mcqSetVersionId: mcqSet.id,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
  return module.id;
}

async function makeSection(): Promise<string> {
  const section = await prisma.courseSection.create({ data: { title: `CCD Section ${uniq()}` }, select: { id: true } });
  sectionIds.push(section.id);
  const version = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: "Body", publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  return section.id;
}

async function makeCourse(
  items: Array<{ itemType: "MODULE" | "SECTION"; moduleId?: string; sectionId?: string }>,
): Promise<string> {
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": "CCD Course", nb: "CCD Kurs", nn: "CCD Kurs" }),
      items: {
        create: items.map((item, index) => ({
          itemType: item.itemType,
          moduleId: item.moduleId ?? null,
          sectionId: item.sectionId ?? null,
          sortOrder: index,
        })),
      },
    },
    select: { id: true },
  });
  courseIds.push(course.id);
  return course.id;
}

async function makeUser(): Promise<string> {
  const tag = uniq();
  const user = await prisma.user.create({
    data: { externalId: tag, email: `${tag}@example.test`, name: "CCD Learner" },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

async function makeSubmission(moduleId: string, userId: string): Promise<void> {
  const version = await prisma.moduleVersion.findFirst({ where: { moduleId }, select: { id: true } });
  await prisma.submission.create({
    data: {
      userId,
      moduleId,
      moduleVersionId: version!.id,
      deliveryType: "FREETEXT",
    },
  });
}

describe("Course cascade delete (#762)", () => {
  afterAll(async () => {
    // Defensive best-effort cleanup — many rows are removed by the feature under test.
    await prisma.submission.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.courseSectionRead.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseCompletion.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseItem.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.courseSection.updateMany({ where: { id: { in: sectionIds } }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.courseSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.module.updateMany({ where: { id: { in: moduleIds } }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.mCQQuestion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.mCQSetVersion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.rubricVersion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.promptTemplateVersion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // (a) Removes the course + its exclusive modules (incl. version rows) + exclusive sections.
  it("deletes the course and its exclusively-owned modules (incl. versions) and sections", async () => {
    const moduleId = await makeRichModule();
    const sectionId = await makeSection();
    const courseId = await makeCourse([
      { itemType: "MODULE", moduleId },
      { itemType: "SECTION", sectionId },
    ]);

    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/cascade-delete`)
      .set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.deletedCourseId).toBe(courseId);
    expect(res.body.deletedModuleIds).toContain(moduleId);
    expect(res.body.deletedSectionIds).toContain(sectionId);

    expect(await prisma.course.findUnique({ where: { id: courseId } })).toBeNull();
    expect(await prisma.module.findUnique({ where: { id: moduleId } })).toBeNull();
    expect(await prisma.moduleVersion.count({ where: { moduleId } })).toBe(0);
    expect(await prisma.rubricVersion.count({ where: { moduleId } })).toBe(0);
    expect(await prisma.promptTemplateVersion.count({ where: { moduleId } })).toBe(0);
    expect(await prisma.mCQSetVersion.count({ where: { moduleId } })).toBe(0);
    expect(await prisma.mCQQuestion.count({ where: { moduleId } })).toBe(0);
    expect(await prisma.courseSection.findUnique({ where: { id: sectionId } })).toBeNull();
    expect(await prisma.courseSectionVersion.count({ where: { sectionId } })).toBe(0);

    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: auditEntityTypes.course, entityId: courseId, action: auditActions.course.cascadeDeleted },
    });
    expect(audit).not.toBeNull();
  });

  // (b) A module used by ANOTHER course is spared — still exists, still in the other course, only
  //     unlinked from the deleted one.
  it("spares a module shared with another course and only unlinks it from the deleted course", async () => {
    const sharedModuleId = await makeRichModule();
    const otherCourseId = await makeCourse([{ itemType: "MODULE", moduleId: sharedModuleId }]);
    const deleteCourseId = await makeCourse([{ itemType: "MODULE", moduleId: sharedModuleId }]);

    const res = await request(app)
      .post(`/api/admin/content/courses/${deleteCourseId}/cascade-delete`)
      .set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.deletedModuleIds).not.toContain(sharedModuleId);
    expect(res.body.sparedModuleIds).toContain(sharedModuleId);

    // Deleted course gone; shared module survives and is still linked to the other course.
    expect(await prisma.course.findUnique({ where: { id: deleteCourseId } })).toBeNull();
    expect(await prisma.module.findUnique({ where: { id: sharedModuleId } })).not.toBeNull();
    expect(await prisma.courseItem.count({ where: { courseId: deleteCourseId, moduleId: sharedModuleId } })).toBe(0);
    expect(await prisma.courseItem.count({ where: { courseId: otherCourseId, moduleId: sharedModuleId } })).toBe(1);
  });

  // (c) A course whose exclusive module has a submission is BLOCKED — nothing deleted, blockers name
  //     the module.
  it("blocks the delete when an exclusive module has a submission and deletes nothing", async () => {
    const moduleId = await makeRichModule();
    const userId = await makeUser();
    await makeSubmission(moduleId, userId);
    const courseId = await makeCourse([{ itemType: "MODULE", moduleId }]);

    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/cascade-delete`)
      .set(adminHeaders);
    expect(res.status).toBe(400);
    const blockerModuleIds = (res.body.details?.blockers ?? []).map((b: { id: string }) => b.id);
    expect(blockerModuleIds).toContain(moduleId);

    // Nothing was removed.
    expect(await prisma.course.findUnique({ where: { id: courseId } })).not.toBeNull();
    expect(await prisma.module.findUnique({ where: { id: moduleId } })).not.toBeNull();
    expect(await prisma.courseItem.count({ where: { courseId } })).toBe(1);
  });

  // (d) A course with a completion is blocked.
  it("blocks the delete when the course has a completion", async () => {
    const userId = await makeUser();
    const courseId = await makeCourse([]);
    await prisma.courseCompletion.create({ data: { userId, courseId, moduleSnapshotJson: "[]" } });

    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/cascade-delete`)
      .set(adminHeaders);
    expect(res.status).toBe(400);
    const blockerIds = (res.body.details?.blockers ?? []).map((b: { id: string }) => b.id);
    expect(blockerIds).toContain(courseId);
    expect(await prisma.course.findUnique({ where: { id: courseId } })).not.toBeNull();
  });

  // (e) Preview reports deletable vs spared vs blocked correctly.
  it("preview reports deletable, spared and blocked items", async () => {
    const exclusiveModuleId = await makeRichModule();
    const exclusiveSectionId = await makeSection();
    const sharedModuleId = await makeRichModule();
    await makeCourse([{ itemType: "MODULE", moduleId: sharedModuleId }]); // other course → shared

    const courseId = await makeCourse([
      { itemType: "MODULE", moduleId: exclusiveModuleId },
      { itemType: "MODULE", moduleId: sharedModuleId },
      { itemType: "SECTION", sectionId: exclusiveSectionId },
    ]);

    const res = await request(app)
      .get(`/api/admin/content/courses/${courseId}/cascade-delete-preview`)
      .set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.deletable).toBe(true);
    expect(res.body.deletableModules.map((m: { id: string }) => m.id)).toEqual([exclusiveModuleId]);
    expect(res.body.deletableSections.map((s: { id: string }) => s.id)).toEqual([exclusiveSectionId]);
    expect(res.body.sparedModules.map((m: { id: string }) => m.id)).toEqual([sharedModuleId]);
    expect(res.body.blockers).toEqual([]);

    // Clean this fixture up explicitly so the preview-only course does not linger.
    await request(app).post(`/api/admin/content/courses/${courseId}/cascade-delete`).set(adminHeaders);
  });

  // Route-level guard: a SUBJECT_MATTER_OWNER (allowed onto the admin_content mount) gets 403 on both
  // endpoints — the per-route ADMINISTRATOR gate is the extra guard.
  it("returns 403 for a SUBJECT_MATTER_OWNER on both cascade-delete endpoints", async () => {
    const courseId = await makeCourse([]);

    const previewRes = await request(app)
      .get(`/api/admin/content/courses/${courseId}/cascade-delete-preview`)
      .set(smoHeaders);
    expect(previewRes.status).toBe(403);
    expect(previewRes.body.error).toBe("forbidden");

    const deleteRes = await request(app)
      .post(`/api/admin/content/courses/${courseId}/cascade-delete`)
      .set(smoHeaders);
    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.error).toBe("forbidden");

    // The course must be untouched by the forbidden calls.
    expect(await prisma.course.findUnique({ where: { id: courseId } })).not.toBeNull();
  });
});
