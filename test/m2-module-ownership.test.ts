import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const smoAHeaders = {
  "x-user-id": "smo-ownership-a",
  "x-user-email": "smo-a@company.com",
  "x-user-name": "SMO Alpha",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const smoBHeaders = {
  "x-user-id": "smo-ownership-b",
  "x-user-email": "smo-b@company.com",
  "x-user-name": "SMO Beta",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const adminHeaders = {
  "x-user-id": "admin-ownership-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const moduleBody = {
  title: { "en-GB": "Ownership Test Module", nb: "Eierskapstestmodul", nn: "Eigarskapstestmodul" },
  description: { "en-GB": "Created for ownership isolation testing.", nb: "Opprettet for isolasjonstesting av eierskap.", nn: "Oppretta for isolasjonstesting av eigarskap." },
};

describe("API-002: Module ownership isolation for SUBJECT_MATTER_OWNER", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("SMO-A can create a module and delete it; SMO-B is denied on the same module", async () => {
    const createRes = await request(app)
      .post("/api/admin/content/modules")
      .set(smoAHeaders)
      .send(moduleBody);
    expect(createRes.status).toBe(201);
    const moduleId = createRes.body.module.id as string;

    // SMO-B cannot delete SMO-A's module
    const deleteBRes = await request(app)
      .delete(`/api/admin/content/modules/${moduleId}`)
      .set(smoBHeaders);
    expect(deleteBRes.status).toBe(403);

    // SMO-A can delete their own module
    const deleteARes = await request(app)
      .delete(`/api/admin/content/modules/${moduleId}`)
      .set(smoAHeaders);
    expect(deleteARes.status).toBe(200);
  });

  it("SMO-B is denied archive/restore on SMO-A's module; admin is allowed", async () => {
    const createRes = await request(app)
      .post("/api/admin/content/modules")
      .set(smoAHeaders)
      .send(moduleBody);
    expect(createRes.status).toBe(201);
    const moduleId = createRes.body.module.id as string;

    // SMO-B denied archive
    const archiveBRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/archive`)
      .set(smoBHeaders);
    expect(archiveBRes.status).toBe(403);

    // Admin can archive
    const archiveAdminRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/archive`)
      .set(adminHeaders);
    expect(archiveAdminRes.status).toBe(200);

    // SMO-B denied restore
    const restoreBRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/restore`)
      .set(smoBHeaders);
    expect(restoreBRes.status).toBe(403);

    // Admin can restore
    const restoreAdminRes = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/restore`)
      .set(adminHeaders);
    expect(restoreAdminRes.status).toBe(200);

    // Cleanup
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("SMO-B is denied title update on SMO-A's module", async () => {
    const createRes = await request(app)
      .post("/api/admin/content/modules")
      .set(smoAHeaders)
      .send(moduleBody);
    expect(createRes.status).toBe(201);
    const moduleId = createRes.body.module.id as string;

    const titleRes = await request(app)
      .patch(`/api/admin/content/modules/${moduleId}/title`)
      .set(smoBHeaders)
      .send({ title: { "en-GB": "Hijacked Title" } });
    expect(titleRes.status).toBe(403);

    // Cleanup
    await request(app).delete(`/api/admin/content/modules/${moduleId}`).set(adminHeaders);
  });

  it("legacy module (createdById=null) blocks SMO mutation; admin allowed", async () => {
    // Insert a legacy module directly without createdById
    const legacy = await prisma.module.create({
      data: {
        title: JSON.stringify({ "en-GB": "Legacy Module for ownership test" }),
        createdById: null,
      },
      select: { id: true },
    });

    // SMO-A cannot delete legacy module
    const smoRes = await request(app)
      .delete(`/api/admin/content/modules/${legacy.id}`)
      .set(smoAHeaders);
    expect(smoRes.status).toBe(403);
    expect(smoRes.body.error).toBe("legacy_module");

    // Admin can delete legacy module
    const adminRes = await request(app)
      .delete(`/api/admin/content/modules/${legacy.id}`)
      .set(adminHeaders);
    expect(adminRes.status).toBe(200);
  });
});
