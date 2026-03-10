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
          id: "participant-completed",
          path: "/participant/completed",
          labelKey: "nav.completedModules",
          requiredRoles: ["PARTICIPANT", "ADMINISTRATOR", "REVIEWER"],
        },
        {
          id: "appeal-handler",
          path: "/appeal-handler",
          labelKey: "nav.appealHandler",
          requiredRoles: ["APPEAL_HANDLER", "ADMINISTRATOR"],
        },
        {
          id: "calibration",
          path: "/calibration",
          labelKey: "nav.calibration",
          requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
        },
        {
          id: "admin-content",
          path: "/admin-content",
          labelKey: "nav.adminContent",
          requiredRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
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
    expect(response.body.calibrationWorkspace).toEqual({
      accessRoles: ["SUBJECT_MATTER_OWNER", "ADMINISTRATOR"],
      defaults: {
        statuses: ["COMPLETED", "UNDER_REVIEW"],
        lookbackDays: 90,
        maxRows: 120,
      },
      signalThresholds: {
        passRateMinimum: 0.6,
        manualReviewRateMaximum: 0.35,
        benchmarkCoverageMinimum: 0.5,
      },
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
      calibrationOwner: {
        userId: "smo-1",
        email: "smo@company.com",
        name: "Platform Subject Matter Owner",
        department: "Learning",
        roles: ["SUBJECT_MATTER_OWNER"],
      },
      contentAdmin: {
        userId: "content-owner-1",
        email: "content.owner@company.com",
        name: "Platform Content Owner",
        department: "Learning",
        roles: ["SUBJECT_MATTER_OWNER"],
      },
    });
  });

  it("serves dedicated appeal-handler workspace page", async () => {
    const response = await request(app).get("/appeal-handler");

    expect(response.status).toBe(200);
    expect(response.text).toContain("appeal-handler.js");
  });

  it("serves dedicated calibration workspace page", async () => {
    const response = await request(app).get("/calibration");

    expect(response.status).toBe(200);
    expect(response.text).toContain("calibration.js");
  });

  it("serves dedicated participant completed-modules page", async () => {
    const response = await request(app).get("/participant/completed");

    expect(response.status).toBe(200);
    expect(response.text).toContain("participant-completed.js");
  });

  it("serves dedicated admin content workspace page", async () => {
    const response = await request(app).get("/admin-content");

    expect(response.status).toBe(200);
    expect(response.text).toContain("admin-content.js");
  });

  it("serves shared stylesheet and links it from all workspace pages", async () => {
    const workspacePages = [
      "/participant",
      "/participant/completed",
      "/admin-content",
      "/appeal-handler",
      "/calibration",
    ];

    for (const pagePath of workspacePages) {
      const response = await request(app).get(pagePath);
      expect(response.status).toBe(200);
      expect(response.text).toContain('href="/static/shared.css"');
      expect(response.text).toContain('class="layout-container"');

      const buttonTags = response.text.match(/<button\b[^>]*>/g) ?? [];
      for (const buttonTag of buttonTags) {
        expect(buttonTag).toContain("class=");
      }
    }

    const cssResponse = await request(app).get("/static/shared.css");
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.text).toContain(".row");
    expect(cssResponse.text).toContain("@media (max-width: 900px)");
    expect(cssResponse.text).toContain(":root");
    expect(cssResponse.text).toContain("--space-1: 8px;");
    expect(cssResponse.text).toContain("--color-blue: #134ec9;");
    expect(cssResponse.text).toContain("--shadow-card: 0 2px 8px rgba(0, 0, 0, 0.06);");
    expect(cssResponse.text).toContain(".layout-container");
    expect(cssResponse.text).toContain("max-width: 1100px;");
    expect(cssResponse.text).toContain("box-shadow: var(--shadow-card);");
    expect(cssResponse.text).toContain(".btn-primary");
    expect(cssResponse.text).toContain(".btn-secondary");
    expect(cssResponse.text).toContain(".btn-danger");
    expect(cssResponse.text).not.toContain("border: 1px solid #ddd;");
  });
});
