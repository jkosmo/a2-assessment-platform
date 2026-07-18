import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { archiveModule, unpublishModule } from "../src/modules/adminContent/adminContentCommands.js";
import { archiveCourse, unpublishCourse, deleteCourse } from "../src/modules/course/courseCommands.js";
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

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
};

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

  // G3 — kurs med påbegynt-ufullført deltaker. Arkiver blokkeres; avpubliser er bevisst tillatt
  // (reversibel «myk» nedtaking).
  it("blokkerer ARKIVER (ikke avpubliser) av et kurs med påbegynt deltaker; fullføring frigjør (G3, I3)", async () => {
    const sectionId = await makeSection();
    const userId = await makeUser();

    // Eget kurs for avpubliser-delen (slik at vi kan republisere uten å påvirke arkiver-delen).
    const unpubCourseId = await makeCourse({ sectionId, published: true });
    await prisma.courseSectionRead.create({ data: { userId, courseId: unpubCourseId, sectionId } });
    // Avpubliser er IKKE G3-låst — skal lykkes selv med påbegynt deltaker.
    const unpubResult = await unpublishCourse(unpubCourseId, ACTOR);
    expect(unpubResult.publishedAt).toBeNull();

    // Arkiver ER G3-låst.
    const archCourseId = await makeCourse({ sectionId, published: true });
    await prisma.courseSectionRead.create({ data: { userId, courseId: archCourseId, sectionId } });
    await expect(archiveCourse(archCourseId, ACTOR)).rejects.toThrow(/midt i en gjennomføring/);

    // Fullført: deltakeren har en completion → ikke lenger «midt i».
    await prisma.courseCompletion.create({ data: { userId, courseId: archCourseId, moduleSnapshotJson: "[]" } });

    const result = await archiveCourse(archCourseId, ACTOR);
    expect(result.archivedAt).not.toBeNull();
    expect(result.publishedAt).toBeNull(); // I3: arkivering auto-avpubliserer kurset
  });

  // Regresjonsvakt: seksjonslistas status-merkelapp trenger activeVersionId i list-responsen.
  // (Tidligere utelatt → alle seksjoner viste «Utkast» og Publiser-knappen så ingen effekt.)
  it("GET /sections returnerer activeVersionId så status kan utledes", async () => {
    const sectionId = await makeSection(); // createSection auto-publiserer
    const res = await request(app)
      .get("/api/admin/content/sections")
      .set({ "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Admin" });
    expect(res.status).toBe(200);
    const row = (res.body.sections as Array<{ id: string; activeVersionId: string | null }>).find((s) => s.id === sectionId);
    expect(row).toBeTruthy();
    expect(row?.activeVersionId).toBeTruthy(); // publisert → status «Publisert», ikke «Utkast»
  });

  // A1 (#705): en sletting skal logges som `course_deleted`, ikke `course_archived`.
  it("logger course_deleted når et kurs slettes (ikke archived)", async () => {
    const courseId = await makeCourse({ published: false });
    await deleteCourse(courseId, ACTOR);
    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: "course", entityId: courseId },
      orderBy: { timestamp: "desc" },
    });
    expect(audit?.action).toBe("course_deleted");
  });

  // A2 (#705): G1 er enkelt-kilde — publisering av en versjon som ikke finnes på modulen avvises,
  // ingen uvoktet fallthrough.
  it("avviser publisering av en versjon som ikke finnes på modulen (404)", async () => {
    const moduleId = await makePublishedModule();
    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/does-not-exist/publish`)
      .set(adminHeaders);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("module_version_not_found");
  });

  // A3 (#705): modul-slett i bruk gir 409 med den navngitte-kurs-meldingen (som avpubliser/arkiver).
  it("modul-slett i bruk gir 409 med navngitt-kurs-melding", async () => {
    const moduleId = await makePublishedModule();
    await makeCourse({ moduleId, published: false });
    const res = await request(app)
      .delete(`/api/admin/content/modules/${moduleId}`)
      .set(adminHeaders);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("module_in_use");
    expect(res.body.courseCount).toBe(1);
    expect(res.body.message).toContain("i bruk i 1 kurs");
    expect(res.body.message).toContain("«LC Kurs»");
  });
});
