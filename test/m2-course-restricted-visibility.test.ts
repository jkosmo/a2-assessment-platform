import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #778/#785: the course LIST endpoint filters RESTRICTED courses by enrolment/class visibility, but
// the direct detail / section-content / mark-read endpoints previously gated only on `publishedAt`.
// An authenticated but unenrolled participant with a RESTRICTED course id could therefore read the
// full sequence + section content and write read-progress. These tests pin the guard.

function headers(externalId: string) {
  return {
    "x-user-id": externalId,
    "x-user-email": `${externalId}@company.com`,
    "x-user-name": externalId,
    "x-user-roles": "PARTICIPANT",
  };
}

async function makeUser(tag: string) {
  const ext = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const user = await prisma.user.create({
    data: { externalId: ext, name: tag, email: `${ext}@x.test` },
    select: { id: true, externalId: true },
  });
  return user;
}

async function makeCourseWithSection(enrollmentPolicy: "OPEN" | "RESTRICTED") {
  const course = await prisma.course.create({
    data: { title: `Visibility ${enrollmentPolicy} ${Date.now()}`, publishedAt: new Date(), enrollmentPolicy },
    select: { id: true },
  });
  const section = await prisma.courseSection.create({
    data: { title: JSON.stringify({ "en-GB": "Secret section" }) },
    select: { id: true },
  });
  const version = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify({ "en-GB": "Secret body." }), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: section.id, sortOrder: 0 } });
  return { courseId: course.id, sectionId: section.id };
}

async function cleanup(courseId: string, sectionId: string) {
  await prisma.courseEnrollment.deleteMany({ where: { courseId } });
  await prisma.courseCompletion.deleteMany({ where: { courseId } });
  await prisma.course.delete({ where: { id: courseId } }); // cascades courseItems
  await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
  await prisma.courseSectionVersion.deleteMany({ where: { sectionId } });
  await prisma.courseSection.delete({ where: { id: sectionId } });
}

describe("RESTRICTED course direct-endpoint visibility (#785)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("denies an unenrolled participant on detail, section content, and mark-read (404)", async () => {
    const { courseId, sectionId } = await makeCourseWithSection("RESTRICTED");
    const outsider = await makeUser("outsider");
    const h = headers(outsider.externalId);

    const detail = await request(app).get(`/api/courses/${courseId}`).set(h);
    expect(detail.status).toBe(404);
    const section = await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(h);
    expect(section.status).toBe(404);
    const read = await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(h);
    expect(read.status).toBe(404);

    // The read must NOT have been recorded (the guard runs before markSectionRead).
    expect(await prisma.courseSectionRead.count({ where: { userId: outsider.id, courseId } })).toBe(0);
    await cleanup(courseId, sectionId);
  });

  it("allows an enrolled participant on all three (200/200/204)", async () => {
    const { courseId, sectionId } = await makeCourseWithSection("RESTRICTED");
    const enrolled = await makeUser("enrolled");
    await prisma.courseEnrollment.create({
      data: { courseId, userId: enrolled.id, source: "INDIVIDUAL", assignedAt: new Date() },
    });
    const h = headers(enrolled.externalId);

    expect((await request(app).get(`/api/courses/${courseId}`).set(h)).status).toBe(200);
    const section = await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(h);
    expect(section.status).toBe(200);
    expect(section.body.html).toContain("Secret body");
    expect((await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(h)).status).toBe(204);
    await cleanup(courseId, sectionId);
  });

  it("does not affect OPEN courses — an unenrolled participant still gets 200", async () => {
    const { courseId, sectionId } = await makeCourseWithSection("OPEN");
    const anyone = await makeUser("open-viewer");
    const h = headers(anyone.externalId);

    expect((await request(app).get(`/api/courses/${courseId}`).set(h)).status).toBe(200);
    expect((await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(h)).status).toBe(200);
    await cleanup(courseId, sectionId);
  });
});
