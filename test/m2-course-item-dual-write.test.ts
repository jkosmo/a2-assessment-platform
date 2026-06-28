import { afterAll, describe, expect, it } from "vitest";
import { setCourseModules } from "../src/modules/course/courseCommands.js";
import { prisma } from "../src/db/prisma.js";

// #502 contract: setCourseModules skriver MODULE-elementer til CourseItem (eneste sannhetskilde —
// ingen CourseModule-mirror lenger), og lar SECTION-elementer være i fred.
describe("setCourseModules → CourseItem (#502 contract)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("writes modules to CourseItem with order preserved, and re-syncs on re-set", async () => {
    const course = await prisma.course.create({
      data: { title: `DualWrite ${Date.now()}` },
      select: { id: true },
    });
    const moduleA = await prisma.module.create({
      data: { title: `DW Module A ${Date.now()}` },
      select: { id: true },
    });
    const moduleB = await prisma.module.create({
      data: { title: `DW Module B ${Date.now()}` },
      select: { id: true },
    });

    await setCourseModules(course.id, [
      { moduleId: moduleA.id, sortOrder: 2 },
      { moduleId: moduleB.id, sortOrder: 1 },
    ]);

    const courseItems = await prisma.courseItem.findMany({
      where: { courseId: course.id },
      orderBy: { sortOrder: "asc" },
    });

    expect(courseItems).toHaveLength(2);
    expect(courseItems.map((i) => i.moduleId)).toEqual([moduleB.id, moduleA.id]);
    expect(courseItems.every((i) => i.itemType === "MODULE")).toBe(true);
    expect(courseItems.every((i) => i.sectionId === null)).toBe(true);

    // Re-setting modules replaces the MODULE CourseItem rows.
    await setCourseModules(course.id, [{ moduleId: moduleA.id, sortOrder: 1 }]);
    const afterItems = await prisma.courseItem.findMany({ where: { courseId: course.id } });
    expect(afterItems).toHaveLength(1);
    expect(afterItems[0]).toMatchObject({ moduleId: moduleA.id, sortOrder: 1, itemType: "MODULE" });

    await prisma.course.delete({ where: { id: course.id } });
  });

  it("does not touch SECTION CourseItems when modules are re-set", async () => {
    const course = await prisma.course.create({
      data: { title: `DualWrite Section ${Date.now()}` },
      select: { id: true },
    });
    const section = await prisma.courseSection.create({
      data: { title: `DW Section ${Date.now()}` },
      select: { id: true },
    });
    const mod = await prisma.module.create({
      data: { title: `DW Module ${Date.now()}` },
      select: { id: true },
    });
    await prisma.courseItem.create({
      data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder: 5 },
    });

    await setCourseModules(course.id, [{ moduleId: mod.id, sortOrder: 1 }]);

    const items = await prisma.courseItem.findMany({ where: { courseId: course.id } });
    const sectionItems = items.filter((i) => i.itemType === "SECTION");
    const moduleItems = items.filter((i) => i.itemType === "MODULE");
    expect(sectionItems).toHaveLength(1);
    expect(sectionItems[0].sectionId).toBe(section.id);
    expect(moduleItems).toHaveLength(1);
    expect(moduleItems[0].moduleId).toBe(mod.id);

    await prisma.course.delete({ where: { id: course.id } });
    await prisma.courseSection.delete({ where: { id: section.id } });
  });
});
