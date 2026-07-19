import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #787 slice 3: owner-set management API. Two-layer authz (content-admin capability to reach it, then
// per-object ownership), plus last-owner protection. contentId is polymorphic (no FK) so we use a
// synthetic id — the ownership logic doesn't require the content row to exist.

function smo(externalId: string) {
  return {
    "x-user-id": externalId,
    "x-user-email": `${externalId}@x.test`,
    "x-user-name": externalId,
    "x-user-roles": "SUBJECT_MATTER_OWNER",
  };
}
function admin(externalId: string) {
  return { ...smo(externalId), "x-user-roles": "ADMINISTRATOR" };
}

async function makeUser(tag: string) {
  const ext = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { externalId: ext, name: tag, email: `${ext}@x.test` },
    select: { id: true, externalId: true },
  });
}

describe("content-owners API (#787)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("owner + admin can manage owners; non-owner is blocked; last owner is protected", async () => {
    const a = await makeUser("owner-a");
    const b = await makeUser("owner-b");
    const adminUser = await makeUser("owner-admin");
    const contentId = `course-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // Seed A as the initial owner.
    await prisma.contentOwner.create({ data: { contentType: "COURSE", contentId, userId: a.id } });

    // Owner A can list.
    const listA = await request(app).get(`/api/admin/content-owners/COURSE/${contentId}`).set(smo(a.externalId));
    expect(listA.status).toBe(200);
    expect((listA.body.owners as Array<{ userId: string }>).map((o) => o.userId)).toEqual([a.id]);

    // Non-owner B (has SMO capability but doesn't own this object) is blocked.
    const listB = await request(app).get(`/api/admin/content-owners/COURSE/${contentId}`).set(smo(b.externalId));
    expect(listB.status).toBe(403);
    expect(listB.body.error).toBe("content_ownership");

    // Owner A adds B as a co-owner.
    const add = await request(app).post(`/api/admin/content-owners/COURSE/${contentId}`).set(smo(a.externalId)).send({ userId: b.id });
    expect(add.status).toBe(201);
    expect((add.body.owners as Array<{ userId: string }>).map((o) => o.userId).sort()).toEqual([a.id, b.id].sort());

    // Now B (a co-owner) can act. B removes A.
    const removeA = await request(app).delete(`/api/admin/content-owners/COURSE/${contentId}/${a.id}`).set(smo(b.externalId));
    expect(removeA.status).toBe(200);
    expect((removeA.body.owners as Array<{ userId: string }>).map((o) => o.userId)).toEqual([b.id]);

    // B is now the last owner — B (non-admin) cannot remove the last owner.
    const removeLast = await request(app).delete(`/api/admin/content-owners/COURSE/${contentId}/${b.id}`).set(smo(b.externalId));
    expect(removeLast.status).toBe(403);
    expect(removeLast.body.error).toBe("last_owner");

    // An admin CAN remove the last owner (content becomes unowned → admin-managed).
    const adminRemove = await request(app).delete(`/api/admin/content-owners/COURSE/${contentId}/${b.id}`).set(admin(adminUser.externalId));
    expect(adminRemove.status).toBe(200);
    expect(adminRemove.body.owners).toEqual([]);

    // Unowned now: a non-admin SMO is blocked (content_unowned); admin can still add an owner.
    const smoUnowned = await request(app).get(`/api/admin/content-owners/COURSE/${contentId}`).set(smo(a.externalId));
    expect(smoUnowned.status).toBe(403);
    expect(smoUnowned.body.error).toBe("content_unowned");
    const adminAdd = await request(app).post(`/api/admin/content-owners/COURSE/${contentId}`).set(admin(adminUser.externalId)).send({ userId: a.id });
    expect(adminAdd.status).toBe(201);

    await prisma.contentOwner.deleteMany({ where: { contentId } });
  });
});
