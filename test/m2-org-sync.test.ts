import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
  "x-user-roles": "ADMINISTRATOR",
};

describe("Org delta sync", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("applies delta updates and reports recoverable conflicts", async () => {
    const initialSyncResponse = await request(app)
      .post("/api/admin/sync/org/delta")
      .set(adminHeaders)
      .send({
        source: "hr-test",
        users: [
          {
            externalId: "hr-100",
            email: "hr.user.100@company.com",
            name: "HR User 100",
            department: "Finance",
            manager: "Manager A",
            activeStatus: true,
          },
          {
            externalId: "hr-200",
            email: "hr.user.200@company.com",
            name: "HR User 200",
            department: "Engineering",
            manager: "Manager B",
            activeStatus: true,
          },
        ],
      });

    expect(initialSyncResponse.status).toBe(200);
    expect(initialSyncResponse.body.run.createdCount).toBe(2);
    expect(initialSyncResponse.body.run.failedCount).toBe(0);

    const firstUser = await prisma.user.findUniqueOrThrow({
      where: { externalId: "hr-100" },
    });
    expect(firstUser.department).toBe("Finance");

    const updateSyncResponse = await request(app)
      .post("/api/admin/sync/org/delta")
      .set(adminHeaders)
      .send({
        source: "hr-test",
        users: [
          {
            externalId: "hr-100",
            email: "hr.user.100@company.com",
            name: "HR User 100 Updated",
            department: "Operations",
            manager: "Manager C",
            activeStatus: false,
          },
          {
            externalId: "hr-999",
            email: "hr.user.200@company.com",
            name: "HR User 200 Re-keyed",
            department: "Engineering",
            manager: "Manager B",
            activeStatus: true,
          },
        ],
      });

    expect(updateSyncResponse.status).toBe(200);
    expect(updateSyncResponse.body.run.updatedCount).toBe(2);
    expect(updateSyncResponse.body.run.failedCount).toBe(0);

    const updatedFirstUser = await prisma.user.findUniqueOrThrow({
      where: { externalId: "hr-100" },
    });
    expect(updatedFirstUser.name).toBe("HR User 100 Updated");
    expect(updatedFirstUser.department).toBe("Operations");
    expect(updatedFirstUser.activeStatus).toBe(false);

    const rekeyedSecondUser = await prisma.user.findUniqueOrThrow({
      where: { externalId: "hr-999" },
    });
    expect(rekeyedSecondUser.email).toBe("hr.user.200@company.com");
    expect(rekeyedSecondUser.name).toBe("HR User 200 Re-keyed");

    const conflictSyncResponse = await request(app)
      .post("/api/admin/sync/org/delta")
      .set(adminHeaders)
      .send({
        source: "hr-test",
        users: [
          {
            externalId: "hr-100",
            email: "hr.user.200@company.com",
            name: "Conflict User",
            department: "Conflict Dept",
          },
        ],
      });

    expect(conflictSyncResponse.status).toBe(200);
    expect(conflictSyncResponse.body.run.failedCount).toBe(1);
    expect(conflictSyncResponse.body.run.errors.length).toBeGreaterThanOrEqual(1);

    const completedAuditEvent = await prisma.auditEvent.findFirst({
      where: {
        entityType: "org_sync",
        action: "org_sync_completed",
      },
    });
    expect(completedAuditEvent).toBeTruthy();
  });
});
