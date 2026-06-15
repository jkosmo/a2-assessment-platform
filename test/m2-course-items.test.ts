import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

// #486/B2 — mixed CourseItem ordering (modules + sections interleaved).
describe("Admin course item ordering", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sets and reads an interleaved module/section sequence and re-syncs CourseModule", async () => {
    const moduleA = await prisma.module.create({ data: { title: `Item Mod A ${Date.now()}` }, select: { id: true } });
    const moduleB = await prisma.module.create({ data: { title: `Item Mod B ${Date.now()}` }, select: { id: true } });
    const section = await prisma.courseSection.create({ data: { title: `Item Sec ${Date.now()}` }, select: { id: true } });
    const course = await prisma.course.create({ data: { title: `Item Course ${Date.now()}` }, select: { id: true } });

    const setResponse = await request(app)
      .put(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders)
      .send({
        items: [
          { type: "MODULE", moduleId: moduleA.id },
          { type: "SECTION", sectionId: section.id },
          { type: "MODULE", moduleId: moduleB.id },
        ],
      });
    expect(setResponse.status).toBe(204);

    const getResponse = await request(app)
      .get(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders);
    expect(getResponse.status).toBe(200);
    const items = getResponse.body.items as Array<{ type: string; moduleId: string | null; sectionId: string | null; sortOrder: number }>;
    expect(items.map((i) => i.type)).toEqual(["MODULE", "SECTION", "MODULE"]);
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(items[0].moduleId).toBe(moduleA.id);
    expect(items[1].sectionId).toBe(section.id);
    expect(items[2].moduleId).toBe(moduleB.id);

    // CourseModule is re-synced from the MODULE items (read-path compatibility).
    const courseModules = await prisma.courseModule.findMany({
      where: { courseId: course.id },
      orderBy: { sortOrder: "asc" },
    });
    expect(courseModules.map((c) => c.moduleId)).toEqual([moduleA.id, moduleB.id]);
    expect(courseModules.map((c) => c.sortOrder)).toEqual([0, 2]);

    await prisma.course.delete({ where: { id: course.id } });
    await prisma.courseSection.delete({ where: { id: section.id } });
  });

  it("rejects unknown ids and duplicate modules", async () => {
    const course = await prisma.course.create({ data: { title: `Item Course V ${Date.now()}` }, select: { id: true } });
    const mod = await prisma.module.create({ data: { title: `Item Mod V ${Date.now()}` }, select: { id: true } });

    const unknown = await request(app)
      .put(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders)
      .send({ items: [{ type: "MODULE", moduleId: "does-not-exist" }] });
    expect(unknown.status).toBe(400);

    const duplicate = await request(app)
      .put(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders)
      .send({ items: [{ type: "MODULE", moduleId: mod.id }, { type: "MODULE", moduleId: mod.id }] });
    expect(duplicate.status).toBe(400);

    await prisma.course.delete({ where: { id: course.id } });
  });
});
