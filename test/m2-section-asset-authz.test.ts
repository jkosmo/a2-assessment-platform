import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #778/#786: a section asset must not be readable by just any authenticated user. Access is granted
// only when the asset's section belongs to a published course the participant can access; authors
// (SMO/ADMIN) bypass so they can preview assets in unpublished/draft sections.

const adminHeaders = {
  "x-user-id": "asset-authz-admin",
  "x-user-email": "asset-authz-admin@company.com",
  "x-user-name": "Asset Authz Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function participant(externalId: string) {
  return {
    "x-user-id": externalId,
    "x-user-email": `${externalId}@x.test`,
    "x-user-name": externalId,
    "x-user-roles": "PARTICIPANT",
  };
}

async function makeUser(tag: string) {
  const ext = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { externalId: ext, name: tag, email: `${ext}@x.test` },
    select: { id: true, externalId: true },
  });
}

// Create a section + a real (blob-backed) PNG asset via the admin API.
async function makeSectionWithAsset(): Promise<{ sectionId: string; assetId: string }> {
  const secRes = await request(app)
    .post("/api/admin/content/sections")
    .set(adminHeaders)
    .send({ title: { nb: `authz-asset ${Date.now()}` }, bodyMarkdown: { nb: "# x" } });
  expect(secRes.status).toBe(201);
  const sectionId = secRes.body.section.id as string;
  const upload = await request(app)
    .post(`/api/admin/content/sections/${sectionId}/assets`)
    .set(adminHeaders)
    .attach("file", PNG_1PX, { filename: "pixel.png", contentType: "image/png" });
  expect(upload.status).toBe(201);
  return { sectionId, assetId: upload.body.asset.id as string };
}

async function linkToCourse(sectionId: string, enrollmentPolicy: "OPEN" | "RESTRICTED"): Promise<string> {
  const course = await prisma.course.create({
    data: { title: `Asset authz ${enrollmentPolicy} ${Date.now()}`, publishedAt: new Date(), enrollmentPolicy },
    select: { id: true },
  });
  await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId, sortOrder: 0 } });
  return course.id;
}

async function cleanup(sectionId: string, courseId?: string) {
  if (courseId) {
    await prisma.courseEnrollment.deleteMany({ where: { courseId } });
    await prisma.course.delete({ where: { id: courseId } }); // cascades CourseItem
  }
  await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
  await prisma.courseSectionVersion.deleteMany({ where: { sectionId } });
  await prisma.courseSection.delete({ where: { id: sectionId } }); // cascades SectionAsset
}

describe("Section asset object-level authorization (#786)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("denies a participant not enrolled in the asset's RESTRICTED course (404)", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "RESTRICTED");
    const outsider = await makeUser("asset-outsider");

    const res = await request(app).get(`/api/content-assets/${assetId}`).set(participant(outsider.externalId));
    expect(res.status).toBe(404);

    await cleanup(sectionId, courseId);
  });

  it("allows a participant enrolled in the asset's RESTRICTED course (200)", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "RESTRICTED");
    const enrolled = await makeUser("asset-enrolled");
    await prisma.courseEnrollment.create({
      data: { courseId, userId: enrolled.id, source: "INDIVIDUAL", assignedAt: new Date() },
    });

    const res = await request(app).get(`/api/content-assets/${assetId}`).set(participant(enrolled.externalId));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");

    await cleanup(sectionId, courseId);
  });

  it("lets an author (ADMINISTRATOR) preview an asset whose section is in NO course (draft)", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();

    // No course link at all → a participant would be denied, but the author bypass applies.
    const denied = await makeUser("asset-draft-participant");
    const p = await request(app).get(`/api/content-assets/${assetId}`).set(participant(denied.externalId));
    expect(p.status).toBe(404);

    const author = await request(app).get(`/api/content-assets/${assetId}`).set(adminHeaders);
    expect(author.status).toBe(200);
    expect(author.headers["content-type"]).toContain("image/png");

    await cleanup(sectionId);
  });
});
