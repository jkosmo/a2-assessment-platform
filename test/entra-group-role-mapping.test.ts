import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

describe("Entra group to RoleAssignment mapping", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("maps configured group claim to PARTICIPANT and allows module access", async () => {
    const headers = {
      "x-user-id": "entra-group-user-1",
      "x-user-email": "entra.group.user@company.com",
      "x-user-name": "Entra Group User",
      "x-user-groups": "11111111-1111-1111-1111-111111111111",
    };

    const meResponse = await request(app).get("/api/me").set(headers);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.roles).toContain("PARTICIPANT");

    const moduleResponse = await request(app).get("/api/modules").set(headers);
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.body.modules.length).toBeGreaterThan(0);
  });

  it("does not grant role for unknown groups", async () => {
    const headers = {
      "x-user-id": "entra-group-user-2",
      "x-user-email": "entra.group.user2@company.com",
      "x-user-name": "Unknown Group User",
      "x-user-groups": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    };

    const meResponse = await request(app).get("/api/me").set(headers);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.roles).not.toContain("PARTICIPANT");

    const moduleResponse = await request(app).get("/api/modules").set(headers);
    expect(moduleResponse.status).toBe(403);
  });
});

