import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

describe("M0 foundation APIs", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns current user and active role assignments from /api/me", async () => {
    const response = await request(app)
      .get("/api/me")
      .set("x-user-id", "participant-1")
      .set("x-user-email", "participant@company.com")
      .set("x-user-name", "Platform Participant");

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("participant@company.com");
    expect(response.body.user.roles).toContain("PARTICIPANT");
    expect(response.headers["x-correlation-id"]).toBeTruthy();
  });

  it("returns published modules and active version metadata", async () => {
    const modulesResponse = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set("x-user-id", "participant-1")
      .set("x-user-email", "participant@company.com")
      .set("x-user-name", "Platform Participant");

    expect(modulesResponse.status).toBe(200);
    expect(modulesResponse.body.modules.length).toBeGreaterThan(0);

    const seedModule = (modulesResponse.body.modules as Array<{ id: string; title: string }>).find(
      (module) => module.title === "Generative AI Foundations",
    );
    if (!seedModule) {
      throw new Error("Seed module not found.");
    }
    const moduleId = seedModule.id;

    const activeVersionResponse = await request(app)
      .get(`/api/modules/${moduleId}/active-version`)
      .set("x-user-id", "participant-1")
      .set("x-user-email", "participant@company.com")
      .set("x-user-name", "Platform Participant");

    expect(activeVersionResponse.status).toBe(200);
    expect(activeVersionResponse.body.activeVersion.moduleId).toBe(moduleId);
    expect(activeVersionResponse.body.activeVersion.versionNo).toBeGreaterThanOrEqual(1);
  });

  it("blocks module access when no role is present", async () => {
    const response = await request(app)
      .get("/api/modules")
      .set("x-user-id", "no-role-user")
      .set("x-user-email", "no.role@company.com")
      .set("x-user-name", "No Role User");

    expect(response.status).toBe(403);
  });

  it("keeps participant module list limited to published participant-visible modules even with broader mock role hints", async () => {
    const adminOwnedModule = await prisma.module.create({
      data: {
        title: "Draft-only module",
        description: "Should not appear in participant workspace.",
        certificationLevel: "foundation",
      },
    });

    const response = await request(app)
      .get("/api/modules?includeCompleted=true")
      .set("x-user-id", "participant-1")
      .set("x-user-email", "participant@company.com")
      .set("x-user-name", "Platform Participant")
      .set("x-user-roles", "PARTICIPANT,ADMINISTRATOR");

    expect(response.status).toBe(200);
    expect(response.body.modules.some((module: { id: string }) => module.id === adminOwnedModule.id)).toBe(false);
  });
});
