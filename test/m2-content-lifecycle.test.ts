import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { archiveModule, unpublishModule } from "../src/modules/adminContent/adminContentCommands.js";
import { archiveCourse, unpublishCourse } from "../src/modules/course/courseCommands.js";
import {
  archiveSection,
  unpublishSection,
  restoreSection,
  publishSection,
  deleteSection,
  createSection,
} from "../src/modules/course/sectionCommands.js";

// #705 — enhetlig innholds-livssyklus. Verifiserer de fire vaktene fra
// doc/design/CONTENT_LIFECYCLE.md: G2 (bruk-lås på modul/seksjon i kurs), G3 (aktivitets-lås på
// kurs med påbegynt deltaker), og I3 (arkivering auto-avpubliserer; gjenopprett → utkast).
// Audit events FK actorId → User, so the actor must be a real user row (set in beforeAll).
let ACTOR = "lifecycle-actor";

const courseIds: string[] = [];
const moduleIds: string[] = [];
const sectionIds: string[] = [];
const userIds: string[] = [];

let seq = 0;
const uniq = () => `lc-${Date.now()}-${seq++}`;

async function makePublishedModule(): Promise<string> {
  const module = await prisma.module.create({ data: { title: `LC Module ${uniq()}` }, select: { id: true } });
  moduleIds.push(module.id);
  const version = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 1, publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
  return module.id;
}

async function makeSection(): Promise<string> {
  const section = await createSection({ title: "LC Section", bodyMarkdown: "Body", actorId: ACTOR });
  sectionIds.push(section.id);
  return section.id;
}

async function makeCourse(opts: {
  moduleId?: string;
  sectionId?: string;
  published?: boolean;
}): Promise<string> {
  const items: Array<{ itemType: "MODULE" | "SECTION"; moduleId?: string; sectionId?: string; sortOrder: number }> = [];
  if (opts.moduleId) items.push({ itemType: "MODULE", moduleId: opts.moduleId, sortOrder: items.length });
  if (opts.sectionId) items.push({ itemType: "SECTION", sectionId: opts.sectionId, sortOrder: items.length });
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": "LC Course", nb: "LC Kurs", nn: "LC Kurs" }),
      publishedAt: opts.published ? new Date() : null,
      items: { create: items },
    },
    select: { id: true },
  });
  courseIds.push(course.id);
  return course.id;
}

async function makeUser(): Promise<string> {
  const tag = uniq();
  const user = await prisma.user.create({
    data: { externalId: tag, email: `${tag}@example.com`, name: "LC Participant" },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

describe("Unified content lifecycle (#705)", () => {
  beforeAll(async () => {
    ACTOR = await makeUser();
  });

  afterAll(async () => {
    await prisma.courseSectionRead.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseCompletion.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseItem.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.courseSection.updateMany({ where: { id: { in: sectionIds } }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.courseSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.module.updateMany({ where: { id: { in: moduleIds } }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // G2 — modul i kurs er bærende og kan ikke trekkes vekk.
  it("blokkerer avpubliser OG arkiver av en modul som ligger i et kurs (G2)", async () => {
    const moduleId = await makePublishedModule();
    await makeCourse({ moduleId, published: false }); // også utkast-kurs låser (vedtatt: alle kurs)

    await expect(unpublishModule(moduleId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);
    await expect(archiveModule(moduleId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);

    // Modulen er fortsatt publisert (ingen tilstandsendring skjedde).
    const after = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true, archivedAt: true } });
    expect(after?.activeVersionId).not.toBeNull();
    expect(after?.archivedAt).toBeNull();
  });

  // I3 — arkivering av en modul utenfor kurs auto-avpubliserer.
  it("auto-avpubliserer en modul ved arkivering når den ikke er i noe kurs (I3)", async () => {
    const moduleId = await makePublishedModule();

    await archiveModule(moduleId, ACTOR);

    const after = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true, archivedAt: true } });
    expect(after?.activeVersionId).toBeNull();
    expect(after?.archivedAt).not.toBeNull();
  });

  // G2 — seksjon i kurs.
  it("blokkerer avpubliser/arkiver/slett av en seksjon som ligger i et kurs (G2)", async () => {
    const sectionId = await makeSection();
    await makeCourse({ sectionId, published: false });

    await expect(unpublishSection(sectionId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);
    await expect(archiveSection(sectionId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);
    await expect(deleteSection(sectionId)).rejects.toThrow(/i bruk i 1 kurs/);
  });

  // Seksjon-livssyklus utenfor kurs: full symmetri.
  it("seksjon utenfor kurs: arkiver auto-avpubliserer, gjenopprett → utkast, publiser re-peker (I3)", async () => {
    const sectionId = await makeSection();

    // Auto-publisert ved opprettelse.
    const created = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true } });
    expect(created?.activeVersionId).not.toBeNull();

    await archiveSection(sectionId, ACTOR);
    const archived = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true, archivedAt: true } });
    expect(archived?.activeVersionId).toBeNull();
    expect(archived?.archivedAt).not.toBeNull();

    await restoreSection(sectionId, ACTOR);
    const restored = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true, archivedAt: true } });
    expect(restored?.archivedAt).toBeNull();
    expect(restored?.activeVersionId).toBeNull(); // gjenopprett lander i Utkast

    await publishSection(sectionId, ACTOR);
    const republished = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true } });
    expect(republished?.activeVersionId).not.toBeNull();
  });

  // G3 — kurs med påbegynt-ufullført deltaker.
  it("blokkerer avpubliser OG arkiver av et kurs med påbegynt deltaker; fullføring frigjør (G3, I3)", async () => {
    const sectionId = await makeSection();
    const courseId = await makeCourse({ sectionId, published: true });
    const userId = await makeUser();

    // Påbegynt: deltakeren har lest en seksjon, men ingen completion.
    await prisma.courseSectionRead.create({ data: { userId, courseId, sectionId } });

    await expect(unpublishCourse(courseId, ACTOR)).rejects.toThrow(/påbegynt/);
    await expect(archiveCourse(courseId, ACTOR)).rejects.toThrow(/påbegynt/);

    // Fullført: deltakeren har en completion → ikke lenger «påbegynt-ufullført».
    await prisma.courseCompletion.create({
      data: { userId, courseId, moduleSnapshotJson: "[]" },
    });

    const result = await archiveCourse(courseId, ACTOR);
    expect(result.archivedAt).not.toBeNull();
    expect(result.publishedAt).toBeNull(); // I3: arkivering auto-avpubliserer kurset
  });
});
