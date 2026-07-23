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

  // #787 slice 5 (list UX): the list endpoints annotate each row with `canManage` so the UI hides the
  // edit/lifecycle actions the guard above would 403 on. Owner + admin ⇒ true; a non-owner SMO ⇒ false.
  const canManageOf = (rows: Array<{ id: string; canManage?: boolean }>, id: string) =>
    rows.find((r) => r.id === id)?.canManage;

  it("SECTION list: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/sections").set(smoA).send({ title: L("Mng section"), bodyMarkdown: "# S" });
    const id = create.body.section.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/sections").set(smoA)).body.sections, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/sections").set(smoB)).body.sections, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/sections").set(admin)).body.sections, id)).toBe(true);
  });

  it("COURSE list: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(smoA).send({ title: L("Mng course") });
    const id = create.body.course.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/courses").set(smoA)).body.courses, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/courses").set(smoB)).body.courses, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/courses").set(admin)).body.courses, id)).toBe(true);
  });

  it("CLASS list: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/classes").set(smoA).send({ name: `Mng-${Date.now()}` });
    const id = create.body.class.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/classes").set(smoA)).body.classes, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/classes").set(smoB)).body.classes, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/classes").set(admin)).body.classes, id)).toBe(true);
  });

  it("MODULE library: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/modules").set(smoA).send({ title: L(`Mng module ${Date.now()}`) });
    expect(create.status).toBe(201);
    const id = create.body.module.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/modules/library").set(smoA)).body.modules, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/modules/library").set(smoB)).body.modules, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/modules/library").set(admin)).body.modules, id)).toBe(true);
  });
});
