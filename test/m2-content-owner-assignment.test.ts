import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { createCourse } from "../src/modules/course/courseCommands.js";
import { createSection } from "../src/modules/course/sectionCommands.js";
import { createClass } from "../src/modules/course/classService.js";
import { createModule } from "../src/modules/adminContent/adminContentCommands.js";

// #787 slice 4a: content creation assigns the creator as the sole initial owner (Q3). This is inert
// (nothing enforces ownership until 4b), but it MUST populate ContentOwner so creators aren't locked
// out once 4b enforcement (which reads ContentOwner) lands. Verifies all four content types + that a
// missing actor leaves the object unowned (system/seed creation → admin-managed).

async function makeActor(tag: string) {
  const ext = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { externalId: ext, name: tag, email: `${ext}@x.test` }, select: { id: true } });
}

async function ownerIds(contentType: "COURSE" | "SECTION" | "CLASS" | "MODULE", contentId: string) {
  const rows = await prisma.contentOwner.findMany({ where: { contentType, contentId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

describe("content creation assigns the creator as owner (#787 slice 4a)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("course/section/class/module: creator gets a ContentOwner row", async () => {
    const actor = await makeActor("creator");

    const course = await createCourse({ title: "T", actorId: actor.id });
    expect(await ownerIds("COURSE", course.id)).toEqual([actor.id]);

    const section = await createSection({ title: "S", bodyMarkdown: "# S", actorId: actor.id });
    expect(await ownerIds("SECTION", section.id)).toEqual([actor.id]);

    const klass = await createClass({ name: `Kull-${Date.now()}` }, actor.id);
    expect(await ownerIds("CLASS", klass.id)).toEqual([actor.id]);

    const module = await createModule({ title: "M", actorId: actor.id });
    expect(await ownerIds("MODULE", module.id)).toEqual([actor.id]);
  });

  it("creation without an actor leaves the object unowned (admin-managed)", async () => {
    const course = await createCourse({ title: "No actor" });
    expect(await ownerIds("COURSE", course.id)).toEqual([]);
  });
});
