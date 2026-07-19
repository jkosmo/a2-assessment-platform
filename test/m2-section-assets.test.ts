import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { getAsset } from "../src/modules/course/assetStorage.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};
const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

// 1x1 transparent PNG.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// #483/F4 — section asset upload + serve (filesystem fallback in CI; no Azure storage).
describe("Section asset upload + serve", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createSection(): Promise<string> {
    const res = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({ title: { nb: `Asset-seksjon ${Date.now()}` }, bodyMarkdown: { nb: "# Hei" } });
    expect(res.status).toBe(201);
    return res.body.section.id as string;
  }

  // Sections can't be deleted while their version FK (Restrict) holds; detach + drop versions
  // first. Assets cascade with the section.
  async function deleteSectionFully(sectionId: string): Promise<void> {
    await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId } });
    await prisma.courseSection.delete({ where: { id: sectionId } });
  }

  // #778/#786: a participant may only fetch a section asset if the section is in a published course
  // they can access. Link an OPEN published course so the participant-serve cases stay realistic.
  async function linkSectionToOpenCourse(sectionId: string): Promise<string> {
    const course = await prisma.course.create({
      data: { title: `Asset course ${Date.now()}`, publishedAt: new Date() }, // enrollmentPolicy defaults OPEN
      select: { id: true },
    });
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId, sortOrder: 0 } });
    return course.id;
  }
  // Delete the course first (cascades the CourseItem) so the section is no longer Restrict-referenced.
  async function deleteSectionAndCourse(sectionId: string, courseId: string): Promise<void> {
    await prisma.courseCompletion.deleteMany({ where: { courseId } });
    await prisma.course.delete({ where: { id: courseId } });
    await deleteSectionFully(sectionId);
  }

  it("uploads an image, lists it, and serves it back to a participant in an accessible course", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);

    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", PNG_1PX, { filename: "pixel.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    const assetId = upload.body.asset.id as string;
    expect(upload.body.asset.ref).toBe(`asset:${assetId}`);

    const list = await request(app)
      .get(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders);
    expect(list.status).toBe(200);
    expect((list.body.assets as Array<{ id: string }>).some((a) => a.id === assetId)).toBe(true);

    // Served back (any authenticated content viewer, e.g. a participant).
    const served = await request(app)
      .get(`/api/content-assets/${assetId}`)
      .set(participantHeaders);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(served.body.length).toBe(PNG_1PX.length);

    await deleteSectionAndCourse(sectionId, courseId);
  });

  // #657: SVG is accepted but sanitised before storage; the served bytes must be inert and the
  // serve endpoint must add hardening headers.
  it("sanitises an uploaded SVG and serves it with hardening headers", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);
    const dirtySvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><script>alert(1)</script><rect onload="x()" width="50" height="20"/><text x="2" y="12">Hei</text></svg>`,
      "utf8",
    );

    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", dirtySvg, { filename: "drawing.svg", contentType: "image/svg+xml" });
    expect(upload.status).toBe(201);
    const assetId = upload.body.asset.id as string;

    const served = await request(app)
      .get(`/api/content-assets/${assetId}`)
      .set(participantHeaders);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/svg+xml");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("sandbox");
    const body = served.text ?? served.body.toString();
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/onload/i);
    expect(body).toMatch(/Hei/);

    await deleteSectionAndCourse(sectionId, courseId);
  });

  // #657: the explicit localize action generates a translated SVG variant per other locale; the
  // serve endpoint returns the variant for `?locale=`. LLM stub mode tags text as `[<locale>] …`.
  it("localises SVG text and serves the per-locale variant", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><text x="2" y="12">Start</text></svg>`,
      "utf8",
    );
    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", svg, { filename: "d.svg", contentType: "image/svg+xml" });
    const assetId = upload.body.asset.id as string;

    const localize = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets/localize`)
      .set(adminHeaders)
      .send({ sourceLocale: "nb" });
    expect(localize.status).toBe(200);
    expect(localize.body.localizedAssetCount).toBe(1);

    // #663: re-running with the same source locale must NOT re-translate the unchanged drawing.
    const localizeAgain = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets/localize`)
      .set(adminHeaders)
      .send({ sourceLocale: "nb" });
    expect(localizeAgain.status).toBe(200);
    expect(localizeAgain.body.localizedAssetCount).toBe(0);
    expect(localizeAgain.body.skippedAssetCount).toBe(1);

    // Source locale → original text; another locale → stub-translated text.
    const original = await request(app).get(`/api/content-assets/${assetId}?locale=nb`).set(participantHeaders);
    expect((original.text ?? original.body.toString())).toMatch(/>Start</);

    const english = await request(app).get(`/api/content-assets/${assetId}?locale=en-GB`).set(participantHeaders);
    expect((english.text ?? english.body.toString())).toMatch(/\[en-GB\] Start/);

    await deleteSectionAndCourse(sectionId, courseId);
  });

  it("rejects a disallowed mime type", async () => {
    const sectionId = await createSection();
    const res = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", Buffer.from("hello"), { filename: "x.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    await deleteSectionFully(sectionId);
  });

  it("returns 404 for an unknown asset id", async () => {
    const res = await request(app).get("/api/content-assets/does-not-exist").set(participantHeaders);
    expect(res.status).toBe(404);
  });

  // #758: deleting a section must reclaim its stored blobs (base + localized variants), not just the
  // DB rows — otherwise the images accumulate in storage forever.
  it("reclaims asset blobs from storage when the section is deleted", async () => {
    const sectionId = await createSection();
    await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", PNG_1PX, { filename: "pixel.png", contentType: "image/png" });
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><text x="2" y="12">Start</text></svg>`,
      "utf8",
    );
    await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", svg, { filename: "d.svg", contentType: "image/svg+xml" });
    // Localize the SVG so at least one variant blob also exists.
    await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets/localize`)
      .set(adminHeaders)
      .send({ sourceLocale: "nb" });

    // Every stored blob path (base blobs + localized variants) — captured before deletion.
    const rows = await prisma.sectionAsset.findMany({ where: { sectionId }, select: { blobPath: true, localizedBlobPaths: true } });
    const blobPaths = rows.flatMap((r) => [
      r.blobPath,
      ...Object.values((r.localizedBlobPaths as Record<string, string> | null) ?? {}),
    ]);
    expect(blobPaths.length).toBeGreaterThanOrEqual(3); // png + svg base + ≥1 variant
    for (const p of blobPaths) await expect(getAsset(p)).resolves.toBeInstanceOf(Buffer);

    // Delete via the real route (deleteSection → reclaimAssetBlobs).
    const del = await request(app).delete(`/api/admin/content/sections/${sectionId}`).set(adminHeaders);
    expect(del.status).toBe(204);

    // Rows cascaded AND blobs physically reclaimed.
    expect(await prisma.sectionAsset.count({ where: { sectionId } })).toBe(0);
    for (const p of blobPaths) await expect(getAsset(p)).rejects.toThrow();
  });
});
