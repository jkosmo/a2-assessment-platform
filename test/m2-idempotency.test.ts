import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #726: create/import POST endpoints accept an optional `Idempotency-Key` header. A replay with the same
// key + same body returns the stored response WITHOUT a second write; a same key + different body is a
// 409; no key behaves normally. Proven end-to-end against a real Postgres via the course-create endpoint.

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const uniq = () => `${Date.now()}-${Math.random()}`;
const titleBody = (title: string) => ({ title: { "en-GB": title, nb: title, nn: title } });

describe("Idempotency-Key on create endpoints (#726)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("replays the stored response for the same key + same body (no second write)", async () => {
    const key = `idem-${uniq()}`;
    const title = `idem-course-${uniq()}`;

    const first = await request(app)
      .post("/api/admin/content/courses")
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send(titleBody(title));
    expect(first.status).toBe(201);
    const courseId = first.body.course.id as string;

    const replay = await request(app)
      .post("/api/admin/content/courses")
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send(titleBody(title));
    expect(replay.status).toBe(201);
    // Same response replayed…
    expect(replay.body.course.id).toBe(courseId);
    // …and NO second course was created.
    expect(await prisma.course.count({ where: { title: { contains: title } } })).toBe(1);
  });

  it("rejects the same key with a different body (409 idempotency_key_reuse)", async () => {
    const key = `idem-${uniq()}`;

    const first = await request(app)
      .post("/api/admin/content/courses")
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send(titleBody(`idem-a-${uniq()}`));
    expect(first.status).toBe(201);

    const reuse = await request(app)
      .post("/api/admin/content/courses")
      .set({ ...adminHeaders, "Idempotency-Key": key })
      .send(titleBody(`idem-b-${uniq()}`));
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toBe("idempotency_key_reuse");
  });

  it("without a key, each request runs normally (two distinct courses)", async () => {
    const title = `idem-nokey-${uniq()}`;
    const a = await request(app).post("/api/admin/content/courses").set(adminHeaders).send(titleBody(title));
    const b = await request(app).post("/api/admin/content/courses").set(adminHeaders).send(titleBody(title));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.course.id).not.toBe(b.body.course.id);
    expect(await prisma.course.count({ where: { title: { contains: title } } })).toBe(2);
  });
});
