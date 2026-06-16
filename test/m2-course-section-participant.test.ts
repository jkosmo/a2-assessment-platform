import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

// #491/P1 — participant sees sections in the course sequence and reads rendered,
// sanitised content.
describe("Participant course section view", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exposes a section in the course sequence and serves sanitised HTML", async () => {
    const course = await prisma.course.create({
      data: { title: `P1 Course ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Intro", nb: "Intro", nn: "Intro" }) },
      select: { id: true },
    });
    const version = await prisma.courseSectionVersion.create({
      data: {
        sectionId: section.id,
        versionNo: 1,
        bodyMarkdown: JSON.stringify({
          "en-GB": "# Welcome\n\nRead this <script>alert(1)</script> first.",
          nb: "# Velkommen",
          nn: "# Velkomen",
        }),
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
    await prisma.courseItem.create({
      data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder: 0 },
    });

    const detail = await request(app)
      .get(`/api/courses/${course.id}`)
      .set(participantHeaders);
    expect(detail.status).toBe(200);
    const items = detail.body.course.items as Array<{ type: string; sectionId?: string; title?: string }>;
    const sectionItem = items.find((i) => i.type === "SECTION");
    expect(sectionItem?.sectionId).toBe(section.id);
    expect(sectionItem?.title).toBe("Intro");

    const content = await request(app)
      .get(`/api/courses/${course.id}/sections/${section.id}`)
      .set(participantHeaders);
    expect(content.status).toBe(200);
    expect(content.body.title).toBe("Intro");
    expect(content.body.html).toContain("Welcome");
    expect(content.body.html).toContain("Read this");
    // Sanitised: the embedded script must be stripped.
    expect(content.body.html).not.toContain("<script");
    expect(content.body.html).not.toContain("alert(1)");

    await prisma.course.delete({ where: { id: course.id } });
    await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: section.id } });
    await prisma.courseSection.delete({ where: { id: section.id } });
  });

  it("returns 404 for a section that is not part of the course", async () => {
    const course = await prisma.course.create({
      data: { title: `P1 Course Empty ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const orphan = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Orphan" }) },
      select: { id: true },
    });

    const res = await request(app)
      .get(`/api/courses/${course.id}/sections/${orphan.id}`)
      .set(participantHeaders);
    expect(res.status).toBe(404);

    await prisma.course.delete({ where: { id: course.id } });
    await prisma.courseSection.delete({ where: { id: orphan.id } });
  });
});
