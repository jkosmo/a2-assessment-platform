import request from "supertest";
import { app } from "../src/app.js";

describe("participant console runtime config", () => {
  it("returns mock auth runtime config with role presets", async () => {
    const response = await request(app).get("/participant/config");

    expect(response.status).toBe(200);
    expect(response.body.authMode).toBe("mock");
    expect(response.body.mockRoleSwitchEnabled).toBe(true);
    expect(response.body.mockRolePresets).toEqual([
      "PARTICIPANT",
      "APPEAL_HANDLER",
      "ADMINISTRATOR",
      "REVIEWER",
      "REPORT_READER",
      "SUBJECT_MATTER_OWNER",
    ]);
    expect(response.body.navigation).toEqual({
      items: [
        {
          id: "participant",
          path: "/participant",
          labelKey: "nav.participant",
          requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"],
        },
        {
          id: "appeal-handler",
          path: "/appeal-handler",
          labelKey: "nav.appealHandler",
          requiredRoles: ["APPEAL_HANDLER", "ADMINISTRATOR"],
        },
      ],
    });
    expect(response.body.drafts).toEqual({
      storageKey: "participant.moduleDrafts.v1",
      ttlMinutes: 240,
      maxModules: 30,
    });
    expect(response.body.appealWorkspace).toEqual({
      availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
      defaultStatuses: ["OPEN", "IN_REVIEW"],
      queuePageSize: 50,
    });
    expect(response.body.flow).toEqual({
      autoStartAfterMcq: true,
      pollIntervalSeconds: 2,
      maxWaitSeconds: 90,
    });
    expect(response.body.identityDefaults).toEqual({
      participant: {
        userId: "participant-1",
        email: "participant@company.com",
        name: "Platform Participant",
        department: "Consulting",
        roles: ["PARTICIPANT"],
      },
      appealHandler: {
        userId: "handler-1",
        email: "appeal.handler@company.com",
        name: "Platform Appeal Handler",
        department: "Quality",
        roles: ["APPEAL_HANDLER"],
      },
    });
  });

  it("serves dedicated appeal-handler workspace page", async () => {
    const response = await request(app).get("/appeal-handler");

    expect(response.status).toBe(200);
    expect(response.text).toContain("appeal-handler.js");
  });
});
