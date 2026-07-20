import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #787 slice 4b: ownership enforcement on course/section/class write paths. The creator owns what they
// make (4a), a non-owner SMO is blocked (403 content_ownership), and ADMINISTRATOR bypasses. This is the
// deliberate behavior change — previously any SMO could mutate any content.

const smoA = { "x-user-id": "enf-a", "x-user-email": "enf-a@x.test", "x-user-name": "A", "x-user-roles": "SUBJECT_MATTER_OWNER" };
const smoB = { "x-user-id": "enf-b", "x-user-email": "enf-b@x.test", "x-user-name": "B", "x-user-roles": "SUBJECT_MATTER_OWNER" };
const admin = { "x-user-id": "enf-admin", "x-user-email": "enf-admin@x.test", "x-user-name": "Adm", "x-user-roles": "ADMINISTRATOR" };
const L = (s: string) => ({ "en-GB": s, nb: s, nn: s });

describe("content ownership enforcement (#787 slice 4b)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("COURSE: non-owner SMO is blocked, owner + admin allowed", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(smoA).send({ title: L("Enf course") });
    expect(create.status).toBe(201);
    const id = create.body.course.id as string;

    const bRes = await request(app).put(`/api/admin/content/courses/${id}`).set(smoB).send({ title: L("hijack") });
    expect(bRes.status).toBe(403);
    expect(bRes.body.error).toBe("content_ownership");

    expect((await request(app).put(`/api/admin/content/courses/${id}`).set(smoA).send({ title: L("owner edit") })).status).toBe(200);
    expect((await request(app).put(`/api/admin/content/courses/${id}`).set(admin).send({ title: L("admin edit") })).status).toBe(200);
  });

  it("SECTION: non-owner SMO is blocked, owner + admin allowed", async () => {
    const create = await request(app).post("/api/admin/content/sections").set(smoA).send({ title: L("Enf section"), bodyMarkdown: "# S" });
    expect(create.status).toBe(201);
    const id = create.body.section.id as string;

    const bRes = await request(app).put(`/api/admin/content/sections/${id}/content`).set(smoB).send({ bodyMarkdown: "# hijack" });
    expect(bRes.status).toBe(403);
    expect(bRes.body.error).toBe("content_ownership");

    expect((await request(app).put(`/api/admin/content/sections/${id}/content`).set(smoA).send({ bodyMarkdown: "# owner" })).status).toBe(200);
    expect((await request(app).put(`/api/admin/content/sections/${id}/content`).set(admin).send({ bodyMarkdown: "# admin" })).status).toBe(200);
  });

  it("CLASS: non-owner SMO is blocked on delete, owner allowed", async () => {
    const create = await request(app).post("/api/admin/content/classes").set(smoA).send({ name: `Enf-${Date.now()}` });
    expect(create.status).toBe(201);
    const id = create.body.class.id as string;

    const bRes = await request(app).delete(`/api/admin/content/classes/${id}`).set(smoB);
    expect(bRes.status).toBe(403);
    expect(bRes.body.error).toBe("content_ownership");

    expect([200, 204]).toContain((await request(app).delete(`/api/admin/content/classes/${id}`).set(smoA)).status);
  });
});
