import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

describe("mock auth identity reconciliation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps mock auth operational when externalId and email point to different existing users", async () => {
    const first = await prisma.user.create({
      data: {
        externalId: "conflict-participant-ext",
        email: "conflict.external@company.com",
        name: "Conflict External",
        department: "Testing",
      },
    });

    await prisma.user.create({
      data: {
        externalId: "conflict-participant-email",
        email: "conflict.participant@company.com",
        name: "Conflict Email",
        department: "Testing",
      },
    });

    await prisma.roleAssignment.create({
      data: {
        userId: first.id,
        appRole: "PARTICIPANT",
        validFrom: new Date(),
        createdBy: "test",
      },
    });

    const response = await request(app)
      .get("/api/me")
      .set("x-user-id", "conflict-participant-ext")
      .set("x-user-email", "conflict.participant@company.com")
      .set("x-user-name", "Conflict Participant")
      .set("x-user-department", "Testing")
      .set("x-user-roles", "PARTICIPANT");

    expect(response.status).toBe(200);
    expect(response.body.user.externalId).toBe("conflict-participant-ext");
    expect(response.body.user.roles).toContain("PARTICIPANT");
  });
});
