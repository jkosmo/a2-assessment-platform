import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

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

  it("uploads an image, lists it, and serves it back to a participant", async () => {
    const sectionId = await createSection();

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

    await deleteSectionFully(sectionId);
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
});
