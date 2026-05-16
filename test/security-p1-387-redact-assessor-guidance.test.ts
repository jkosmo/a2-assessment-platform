import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

describe("[Security P1 #387] Assessor guidance redaction from participant module APIs", () => {
  let moduleId: string;

  beforeAll(async () => {
    const mod = await prisma.module.findFirst({
      where: { activeVersionId: { not: null } },
      include: { activeVersion: { select: { assessorExpectedContent: true } } },
    });
    if (!mod || !mod.activeVersion?.assessorExpectedContent) {
      throw new Error("No seed module with assessorExpectedContent found — check seedCore.ts.");
    }
    moduleId = mod.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GET /api/modules — participant response never includes assessorExpectedContent", async () => {
    const res = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set(participantHeaders);
    expect(res.status).toBe(200);
    for (const mod of res.body.modules as Record<string, unknown>[]) {
      expect(mod).not.toHaveProperty("assessorExpectedContent");
    }
  });

  it("GET /api/modules/:id — participant response never includes assessorExpectedContent", async () => {
    const res = await request(app)
      .get(`/api/modules/${moduleId}`)
      .set(participantHeaders);
    expect(res.status).toBe(200);
    expect(res.body.module).not.toHaveProperty("assessorExpectedContent");
  });

  it("GET /api/modules/:id/active-version — participant response never includes assessorExpectedContent", async () => {
    const res = await request(app)
      .get(`/api/modules/${moduleId}/active-version`)
      .set(participantHeaders);
    expect(res.status).toBe(200);
    expect(res.body.activeVersion).not.toHaveProperty("assessorExpectedContent");
  });

  it("GET /api/modules?adminFacing=true — admin/assessor response includes assessorExpectedContent", async () => {
    const res = await request(app)
      .get("/api/modules?adminFacing=true&includeCompleted=true")
      .set(adminHeaders);
    expect(res.status).toBe(200);
    const targetModule = (res.body.modules as Record<string, unknown>[]).find(
      (m) => m.id === moduleId,
    );
    expect(targetModule).toBeDefined();
    expect(targetModule).toHaveProperty("assessorExpectedContent");
  });
});
