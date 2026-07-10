import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #734 — cascade publish. Publishing a COURSE must not leave it containing unavailable (draft/
// archived) modules or sections (content-lifecycle invariant I1, doc/design/CONTENT_LIFECYCLE.md).
// The publish route now: publishes directly when everything is already live (unchanged happy path);
// asks for confirmation (409) when there are unpublished items; cascade-publishes them (items → course)
// on `{ publishItems: true }`; and returns 422 without publishing anything when an item is un-publishable.
const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const courseIds: string[] = [];
const moduleIds: string[] = [];
const sectionIds: string[] = [];

let seq = 0;
const uniq = () => `cp-${Date.now()}-${seq++}`;

async function makeModule(opts: { published?: boolean; withVersion?: boolean } = {}): Promise<string> {
  const withVersion = opts.withVersion ?? true;
  const module = await prisma.module.create({ data: { title: `CP Module ${uniq()}` }, select: { id: true } });
  moduleIds.push(module.id);
  if (withVersion) {
    const version = await prisma.moduleVersion.create({
      data: {
        moduleId: module.id,
        versionNo: 1,
        taskText: JSON.stringify({ "en-GB": "A task text that is clearly long enough to be meaningful." }),
        publishedAt: opts.published ? new Date() : null,
      },
      select: { id: true },
    });
    if (opts.published) {
      await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
    }
  }
  return module.id;
}

async function makeSection(opts: { published?: boolean } = {}): Promise<string> {
  const section = await prisma.courseSection.create({
    data: { title: JSON.stringify({ "en-GB": "CP Section", nb: "CP Seksjon", nn: "CP Seksjon" }) },
    select: { id: true },
  });
  sectionIds.push(section.id);
  const version = await prisma.courseSectionVersion.create({
    data: {
      sectionId: section.id,
      versionNo: 1,
      bodyMarkdown: "Section body content.",
      publishedAt: opts.published ? new Date() : null,
    },
    select: { id: true },
  });
  if (opts.published) {
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  }
  return section.id;
}

async function makeCourse(items: Array<{ type: "MODULE" | "SECTION"; id: string }>): Promise<string> {
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": "CP Course", nb: "CP Kurs", nn: "CP Kurs" }),
      items: {
        create: items.map((item, index) => ({
          itemType: item.type,
          moduleId: item.type === "MODULE" ? item.id : null,
          sectionId: item.type === "SECTION" ? item.id : null,
          sortOrder: index,
        })),
      },
    },
    select: { id: true },
  });
  courseIds.push(course.id);
  return course.id;
}

describe("Course cascade publish (#734)", () => {
  afterAll(async () => {
    await prisma.courseItem.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.courseSection.updateMany({ where: { id: { in: sectionIds } }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.courseSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.module.updateMany({ where: { id: { in: moduleIds } }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
    await prisma.$disconnect();
  });

  // Unchanged happy path: everything already published → publish directly, no cascade.
  it("publishes a course whose items are all already published (no cascade needed)", async () => {
    const moduleId = await makeModule({ published: true });
    const sectionId = await makeSection({ published: true });
    const courseId = await makeCourse([
      { type: "MODULE", id: moduleId },
      { type: "SECTION", id: sectionId },
    ]);

    const preview = await request(app)
      .get(`/api/admin/content/courses/${courseId}/publish-preview`)
      .set(adminHeaders);
    expect(preview.status).toBe(200);
    expect(preview.body.allPublished).toBe(true);
    expect(preview.body.unpublishedItems).toHaveLength(0);

    const res = await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.course.publishedAt).toBeTruthy();
    expect(res.body.publishedItems).toHaveLength(0);

    const after = await prisma.course.findUnique({ where: { id: courseId }, select: { publishedAt: true } });
    expect(after?.publishedAt).not.toBeNull();
  });

  // Cascade: unpublished (but publishable) module + section → publish them and the course together.
  it("cascade-publishes unpublished modules and sections, then the course", async () => {
    const moduleId = await makeModule({ published: false }); // has a version, activeVersionId null
    const sectionId = await makeSection({ published: false }); // has a version, activeVersionId null
    const courseId = await makeCourse([
      { type: "MODULE", id: moduleId },
      { type: "SECTION", id: sectionId },
    ]);

    // Preview reports both as unpublished + publishable.
    const preview = await request(app)
      .get(`/api/admin/content/courses/${courseId}/publish-preview`)
      .set(adminHeaders);
    expect(preview.status).toBe(200);
    expect(preview.body.allPublished).toBe(false);
    expect(preview.body.publishable).toBe(true);
    expect(preview.body.unpublishedItems).toHaveLength(2);
    expect(preview.body.unpublishedItems.every((i: { publishable: boolean }) => i.publishable)).toBe(true);

    // Without opting in, publishing is refused (confirmation required) and nothing changes.
    const needsConfirm = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(adminHeaders)
      .send({});
    expect(needsConfirm.status).toBe(409);
    expect(needsConfirm.body.error).toBe("course_has_unpublished_items");
    const stillDraft = await prisma.course.findUnique({ where: { id: courseId }, select: { publishedAt: true } });
    expect(stillDraft?.publishedAt).toBeNull();

    // Opt in → items and course all get published.
    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(adminHeaders)
      .send({ publishItems: true });
    expect(res.status).toBe(200);
    expect(res.body.course.publishedAt).toBeTruthy();
    expect(res.body.publishedItems).toHaveLength(2);

    const module = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true } });
    const section = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true } });
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { publishedAt: true } });
    expect(module?.activeVersionId).not.toBeNull();
    expect(section?.activeVersionId).not.toBeNull();
    expect(course?.publishedAt).not.toBeNull();
  });

  // An un-publishable item (module with no version/content) blocks the whole publish — nothing is
  // left half-published.
  it("blocks publish and reports blockers when an item cannot be published; nothing is half-published", async () => {
    const shellModuleId = await makeModule({ withVersion: false }); // no version → not publishable
    const sectionId = await makeSection({ published: false }); // publishable, but must NOT get published
    const courseId = await makeCourse([
      { type: "MODULE", id: shellModuleId },
      { type: "SECTION", id: sectionId },
    ]);

    const preview = await request(app)
      .get(`/api/admin/content/courses/${courseId}/publish-preview`)
      .set(adminHeaders);
    expect(preview.status).toBe(200);
    expect(preview.body.publishable).toBe(false);
    const blockedModule = preview.body.unpublishedItems.find(
      (i: { type: string; id: string }) => i.id === shellModuleId,
    );
    expect(blockedModule.publishable).toBe(false);
    expect(blockedModule.blockers.map((b: { code: string }) => b.code)).toContain("module_no_content");

    const res = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(adminHeaders)
      .send({ publishItems: true });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("course_publish_blocked_by_items");
    expect(res.body.details.unpublishedItems.some((i: { publishable: boolean }) => !i.publishable)).toBe(true);

    // Nothing published: course still draft, the publishable section was NOT published either.
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { publishedAt: true } });
    const section = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true } });
    expect(course?.publishedAt).toBeNull();
    expect(section?.activeVersionId).toBeNull();
  });
});
