import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const subjectMatterOwnerHeaders = {
  "x-user-id": "smo-1",
  "x-user-email": "smo@company.com",
  "x-user-name": "Subject Matter Owner",
  "x-user-department": "Learning",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-department": "Consulting",
  "x-user-roles": "PARTICIPANT",
};

describe("Calibration workspace Phase A", () => {
  it("returns calibration workspace snapshot and records access audit event", async () => {
    const module = await prisma.module.findFirst({
      where: { activeVersionId: { not: null } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    expect(module).toBeTruthy();

    const response = await request(app)
      .get(`/api/calibration/workspace?moduleId=${encodeURIComponent(module!.id)}&limit=50`)
      .set(subjectMatterOwnerHeaders);

    expect(response.status).toBe(200);
    expect(response.body.module.id).toBe(module!.id);
    expect(Array.isArray(response.body.filters.statuses)).toBe(true);
    expect(Array.isArray(response.body.outcomes)).toBe(true);
    expect(Array.isArray(response.body.benchmarkAnchors)).toBe(true);
    expect(response.body.signals).toMatchObject({
      outcomeCount: expect.any(Number),
      decisionCount: expect.any(Number),
      underReviewCount: expect.any(Number),
      flags: expect.any(Array),
    });

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        entityType: "calibration_workspace",
        entityId: module!.id,
        action: "calibration_workspace_session_started",
      },
      orderBy: { timestamp: "desc" },
    });
    expect(auditEvent).toBeTruthy();
    expect(auditEvent?.metadataJson).toContain(`"moduleId":"${module!.id}"`);
  });

  it("enforces role access and validates status query", async () => {
    const module = await prisma.module.findFirst({
      where: { activeVersionId: { not: null } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    expect(module).toBeTruthy();

    const forbiddenResponse = await request(app)
      .get(`/api/calibration/workspace?moduleId=${encodeURIComponent(module!.id)}`)
      .set(participantHeaders);
    expect(forbiddenResponse.status).toBe(403);

    const invalidStatusResponse = await request(app)
      .get(`/api/calibration/workspace?moduleId=${encodeURIComponent(module!.id)}&status=INVALID`)
      .set(subjectMatterOwnerHeaders);
    expect(invalidStatusResponse.status).toBe(400);
    expect(invalidStatusResponse.body.error).toBe("validation_error");
  });
});
