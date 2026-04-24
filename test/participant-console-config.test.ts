import request from "supertest";
import { app } from "../src/app.js";
import { buildWorkspaceNavigationItems } from "../src/config/capabilities.js";

describe("participant console runtime config", () => {
  it("returns runtime config with role presets and auth metadata", async () => {
    const response = await request(app).get("/participant/config");

    expect(response.status).toBe(200);
    expect(["mock", "entra"]).toContain(response.body.authMode);
    expect(response.body.debugMode).toBe(true);
    expect(response.body.mockRoleSwitchEnabled).toBe(response.body.authMode === "mock");
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
    expect(response.body.manualReviewWorkspace).toEqual({
      availableStatuses: ["OPEN", "IN_REVIEW", "RESOLVED"],
      defaultStatuses: ["OPEN", "IN_REVIEW"],
      queuePageSize: 50,
    });
    expect(response.body.flow).toEqual({
      autoStartAfterMcq: true,
      pollIntervalSeconds: 3,
      maxWaitSeconds: 150,
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
    expect(response.body.navigation).toEqual({
      items: buildWorkspaceNavigationItems(response.body.calibrationWorkspace.accessRoles),
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
      reviewer: {
        userId: "reviewer-user-1",
        email: "reviewer1@company.com",
        name: "Platform Reviewer",
        department: "Quality",
        roles: ["REVIEWER"],
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
    if (response.body.authMode === "entra") {
      expect(response.body.entra).toMatchObject({
        clientId: expect.any(String),
        authority: expect.stringContaining("https://login.microsoftonline.com/"),
        scopes: [expect.stringContaining("/.default")],
      });
    } else {
      expect(response.body.entra).toBeUndefined();
    }
  });

  it("serves combined review workspace page", async () => {
    const response = await request(app).get("/review");

    expect(response.status).toBe(200);
    expect(response.text).toContain("review.js");
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
    expect(response.text).toContain('id="courseCertSection"');
  });

  it("serves profile page with completed courses section", async () => {
    const response = await request(app).get("/profile");

    expect(response.status).toBe(200);
    expect(response.text).toContain("profile.js");
    expect(response.text).toContain('id="coursesBody"');
  });

  it("serves dedicated admin content workspace page", async () => {
    const response = await request(app).get("/admin-content");

    expect(response.status).toBe(200);
    expect(response.text).toContain("admin-content-library.js");
  });

  it("serves advanced admin content editor at /admin-content/advanced", async () => {
    const response = await request(app).get("/admin-content/advanced");

    expect(response.status).toBe(200);
    expect(response.text).toContain("admin-content.js");
  });

  it("serves dedicated results workspace page", async () => {
    const response = await request(app).get("/results");

    expect(response.status).toBe(200);
    expect(response.text).toContain("results.js");
    expect(response.text).toContain('id="passRateGrid"');
    expect(response.text).toContain('id="completionBody"');
    expect(response.text).toContain('id="participantBody"');
    expect(response.text).toContain('id="filterCourseId"');
    expect(response.text).toContain('id="debugOutputSection"');
    expect(response.text).toContain('id="exportRecertification"');
  });

  it("serves shared stylesheet and links it from all workspace pages", async () => {
    const workspacePages = [
      "/participant",
      "/participant/completed",
      "/review",
      // /admin-content is the new conversational shell (no mock-identity-card panel)
      // /admin-content/advanced is the full editor that retains the panel
      "/admin-content/advanced",
      "/calibration",
    ];

    for (const pagePath of workspacePages) {
      const response = await request(app).get(pagePath);
      expect(response.status).toBe(200);
      expect(response.text).toContain('href="/static/shared.css"');
      expect(response.text).toContain('class="layout-container"');
      expect(response.text).toContain('class="card mock-identity-card"');
      expect(response.text).toContain('class="mock-identity-panel"');

      if (["/participant", "/review", "/calibration"].includes(pagePath)) {
        expect(response.text).toContain('href="/static/loading.css"');
      }

      if (["/participant", "/review"].includes(pagePath)) {
        expect(response.text).toContain('href="/static/toast.css"');
        expect(response.text).toContain('id="debugOutputSection" hidden');
      }

      const buttonTags = response.text.match(/<button\b[^>]*>/g) ?? [];
      for (const buttonTag of buttonTags) {
        expect(buttonTag).toContain("class=");
      }

      if (pagePath === "/participant") {
        expect(response.text).toContain('id="selectedModuleTitle"');
        expect(response.text).toContain('id="selectedModuleDescription"');
        expect(response.text).toContain('id="selectedModuleStatus"');
        expect(response.text).toContain('id="selectedModuleBrief"');
        expect(response.text).toContain('id="selectedModuleTaskText"');
        expect(response.text).toContain('id="selectedModuleGuidanceText"');
        expect(response.text).toContain('id="draftBrowserNote"');
        expect(response.text).toContain('id="appealNextSteps"');
        expect(response.text).toContain('id="resultSummary" class="summary-stack"');
        expect(response.text).toContain('id="historySummary" class="history-list"');
        expect(response.text).not.toContain('<pre id="resultSummary"');
        expect(response.text).not.toContain('<pre id="historySummary"');
        expect(response.text).not.toContain('id="flowProgress"');
        expect(response.text).not.toContain('data-step="4"');
      }

      if (pagePath === "/review") {
        expect(response.text).toContain('id="appealHandlerStatusFilter"');
        expect(response.text).toContain('id="manualReviewStatusFilter"');
        expect(response.text).toContain('id="reviewWorkspaceTabs"');
        expect(response.text).toContain('id="reviewTabManual"');
        expect(response.text).toContain('id="reviewTabAppeal"');
        expect(response.text).toContain('class="pill-group"');
        expect(response.text).toContain('id="outputStatus"');
        expect(response.text).toContain('id="reviewActionSequenceHint"');
      }

      if (pagePath === "/calibration") {
        expect(response.text).toContain('id="calibrationStatuses"');
        expect(response.text).toContain('class="pill-group"');
        expect(response.text).not.toContain('<select id="calibrationStatuses"');
        expect(response.text).toContain('<details id="outputDetails">');
        expect(response.text).toContain("<summary>View raw response</summary>");
      }

      if (pagePath === "/participant") {
        expect(response.text).toContain('id="outputStatus"');
        expect(response.text).toContain('id="previewModeBanner"');
        expect(response.text).toContain('id="historySection"');
      }

      if (pagePath === "/participant/completed") {
        expect(response.text).toContain('id="outputStatus"');
        expect(response.text).not.toContain('id="flowProgress"');
        expect(response.text).toContain('id="courseCertSection"');
      }

      if (pagePath === "/admin-content/advanced") {
        expect(response.text).toContain('id="outputStatus"');
        expect(response.text).toContain('<details id="outputDetails">');
        expect(response.text).toContain("<summary>View raw response</summary>");
        expect(response.text).toContain('id="moduleStartModeTabs"');
        expect(response.text).toContain('id="startModeImportTab"');
        expect(response.text).toContain('id="startModeManualTab"');
        expect(response.text).toContain('id="startModeExistingTab"');
        expect(response.text).toContain('id="loadModuleContent"');
        expect(response.text).toContain('id="exportModule"');
        expect(response.text).toContain('id="duplicateModule"');
        expect(response.text).toContain('id="moduleStatusCard"');
        expect(response.text).toContain('id="importDraftFile"');
        expect(response.text).toContain('id="importDraftJson"');
        expect(response.text).toContain('id="applyImportDraft"');
        expect(response.text).toContain('id="copyAuthoringPrompt"');
        expect(response.text).toContain('id="previewCurrentDraft"');
        expect(response.text).not.toContain('id="applyImportFile"');
        expect(response.text).not.toContain('id="downloadImportTemplate"');
        expect(response.text).not.toContain('id="flowProgress"');
        expect(response.text.indexOf('id="importDraftFile"')).toBeLessThan(response.text.indexOf('id="moduleTitle"'));
        expect(response.text).toContain("A published version must still be active");
        expect(response.text).toContain('id="coursesTab"');
        expect(response.text).toContain('id="tabKurs"');
        expect(response.text).toContain('id="dialogCourse"');
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
    expect(cssResponse.text).toContain(".mock-identity-panel");
    expect(cssResponse.text).toContain(".summary-card");
    expect(cssResponse.text).toContain(".history-list");
    expect(cssResponse.text).toContain(".btn-primary");
    expect(cssResponse.text).toContain(".btn-secondary");
    expect(cssResponse.text).toContain(".btn-danger");
    expect(cssResponse.text).toContain(".hint");
    expect(cssResponse.text).toContain(".field-error");
    expect(cssResponse.text).toContain(".field-success");
    expect(cssResponse.text).toContain(".pill-group");
    expect(cssResponse.text).toContain(".mcq-question-card");
    expect(cssResponse.text).toContain(".mcq-option");
    expect(cssResponse.text).not.toContain("border: 1px solid #ddd;");

    const loadingCssResponse = await request(app).get("/static/loading.css");
    expect(loadingCssResponse.status).toBe(200);
    expect(loadingCssResponse.text).toContain(".button-busy::after");
    expect(loadingCssResponse.text).toContain(".loading-skeleton");

    const loadingJsResponse = await request(app).get("/static/loading.js");
    expect(loadingJsResponse.status).toBe(200);
    expect(loadingJsResponse.text).toContain("export function showLoading");
    expect(loadingJsResponse.text).toContain("export function showEmpty");

    const toastCssResponse = await request(app).get("/static/toast.css");
    expect(toastCssResponse.status).toBe(200);
    expect(toastCssResponse.text).toContain(".toast-region");
    expect(toastCssResponse.text).toContain(".toast__close");

    const toastJsResponse = await request(app).get("/static/toast.js");
    expect(toastJsResponse.status).toBe(200);
    expect(toastJsResponse.text).toContain("export function showToast");
    expect(toastJsResponse.text).toContain("AUTO_DISMISS_MS = 5000");

    const participantJsResponse = await request(app).get("/static/participant.js");
    expect(participantJsResponse.status).toBe(200);
    expect(participantJsResponse.text).toContain('document.createElement("fieldset")');
    expect(participantJsResponse.text).toContain('function shouldShowModuleDebugMeta()');
    expect(participantJsResponse.text).toContain('function createSummaryCard(title)');
    expect(participantJsResponse.text).toContain('wrapper.className = "mcq-question-card"');
    expect(participantJsResponse.text).toContain('adminContent.participantPreview.v1');
    expect(participantJsResponse.text).toContain('draft.savedSwitchToast');
    expect(participantJsResponse.text).toContain('async function openCourseModule(courseId, moduleId)');
    expect(participantJsResponse.text).toContain('course-module-button');

    const resultsJsResponse = await request(app).get("/static/results.js");
    expect(resultsJsResponse.status).toBe(200);
    expect(resultsJsResponse.text).toContain('const filterCourseId = document.getElementById("filterCourseId")');
    expect(resultsJsResponse.text).toContain('apiFetch(`/api/reports/courses?${params}`, headers)');

    const adminContentJsResponse = await request(app).get("/static/admin-content.js");
    expect(adminContentJsResponse.status).toBe(200);
    expect(adminContentJsResponse.text).toContain('/api/admin/content/modules');
    expect(adminContentJsResponse.text).toContain('/api/admin/content/courses');
    expect(adminContentJsResponse.text).toContain("showSimpleConfirm(");
    expect(adminContentJsResponse.text).toContain("function shouldConfirmImportOverwrite(draft)");

    const participantCompletedJsResponse = await request(app).get("/static/participant-completed.js");
    expect(participantCompletedJsResponse.status).toBe(200);
    expect(participantCompletedJsResponse.text).toContain('/api/courses/completions');
    expect(participantCompletedJsResponse.text).toContain('courseCertList');
    expect(participantCompletedJsResponse.text).toContain('renderCourseCertificates');

    const profileJsResponse = await request(app).get("/static/profile.js");
    expect(profileJsResponse.status).toBe(200);
    expect(profileJsResponse.text).toContain('/api/courses/completions');
    expect(profileJsResponse.text).toContain('function renderCourses(body)');
    expect(profileJsResponse.text).toContain('const coursesBody = document.getElementById("coursesBody")');
  });
});
