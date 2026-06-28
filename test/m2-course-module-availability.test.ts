import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #502-followup: course-detail markerer en modul uten publisert aktiv versjon som available:false
// (deltaker-UI viser «Ikke tilgjengelig» i stedet for en blindvei-klikk).
const participantHeaders = {
  "x-user-id": "avail-participant",
  "x-user-email": "avail@example.com",
  "x-user-name": "Avail Participant",
  "x-user-roles": "PARTICIPANT",
};

const createdCourseIds: string[] = [];
const createdModuleIds: string[] = [];

describe("Course detail module availability (#502-followup)", () => {
  afterAll(async () => {
    await prisma.courseItem.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    // Nullstill activeVersion-peker + slett versjoner før modulene (FK).
    await prisma.module.updateMany({ where: { id: { in: createdModuleIds } }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: createdModuleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: createdModuleIds } } });
    await prisma.$disconnect();
  });

  it("merker avpublisert modul som available:false, publisert som available:true", async () => {
    // Publisert modul: aktiv versjon med publishedAt.
    const publishedModule = await prisma.module.create({ data: { title: "Avail Published" }, select: { id: true } });
    createdModuleIds.push(publishedModule.id);
    const version = await prisma.moduleVersion.create({
      data: { moduleId: publishedModule.id, versionNo: 1, publishedAt: new Date() },
      select: { id: true },
    });
    await prisma.module.update({ where: { id: publishedModule.id }, data: { activeVersionId: version.id } });

    // Avpublisert modul: ingen aktiv versjon.
    const unpublishedModule = await prisma.module.create({ data: { title: "Avail Unpublished" }, select: { id: true } });
    createdModuleIds.push(unpublishedModule.id);

    const course = await prisma.course.create({
      data: {
        title: JSON.stringify({ "en-GB": "Avail", nb: "Avail", nn: "Avail" }),
        publishedAt: new Date(),
        items: {
          create: [
            { itemType: "MODULE", moduleId: publishedModule.id, sortOrder: 0 },
            { itemType: "MODULE", moduleId: unpublishedModule.id, sortOrder: 1 },
          ],
        },
      },
      select: { id: true },
    });
    createdCourseIds.push(course.id);

    const res = await request(app).get(`/api/courses/${course.id}`).set(participantHeaders);
    expect(res.status).toBe(200);
    const items = res.body.course.items as Array<{ type: string; moduleId: string; available: boolean }>;
    const published = items.find((i) => i.moduleId === publishedModule.id);
    const unpublished = items.find((i) => i.moduleId === unpublishedModule.id);
    expect(published?.available).toBe(true);
    expect(unpublished?.available).toBe(false);
  });
});
