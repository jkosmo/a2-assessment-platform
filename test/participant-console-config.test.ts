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
  });

  it("serves dedicated appeal-handler workspace page", async () => {
    const response = await request(app).get("/appeal-handler");

    expect(response.status).toBe(200);
    expect(response.text).toContain("appeal-handler.js");
  });
});
