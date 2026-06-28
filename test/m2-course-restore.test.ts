import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #673: arkiver → gjenopprett (POST /:courseId/restore nullstiller archivedAt).
const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const createdCourseIds: string[] = [];

describe("Course archive/restore (#673)", () => {
  afterAll(async () => {
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
    await prisma.$disconnect();
  });

  it("arkiverer og gjenoppretter et kurs (archivedAt nullstilles)", async () => {
    const create = await request(app)
      .post("/api/admin/content/courses")
      .set(adminHeaders)
      .send({ title: { "en-GB": "R", nb: "R", nn: "R" } });
    expect(create.status).toBe(201);
    const id = create.body.course.id as string;
    createdCourseIds.push(id);

    await request(app).post(`/api/admin/content/courses/${id}/archive`).set(adminHeaders).expect(200);
    const archived = await prisma.course.findUnique({ where: { id }, select: { archivedAt: true } });
    expect(archived?.archivedAt).not.toBeNull();

    const restore = await request(app).post(`/api/admin/content/courses/${id}/restore`).set(adminHeaders);
    expect(restore.status).toBe(200);
    const restored = await prisma.course.findUnique({ where: { id }, select: { archivedAt: true } });
    expect(restored?.archivedAt).toBeNull();
  });
});
