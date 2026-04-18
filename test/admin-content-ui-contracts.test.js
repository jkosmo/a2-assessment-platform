import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const allAdminContentPages = [
  "public/admin-content.html",
  "public/admin-content-advanced.html",
  "public/admin-content-library.html",
  "public/admin-content-courses.html",
];

describe("admin content workspace UI contracts", () => {
  for (const relativePath of allAdminContentPages) {
    it(`keeps shared workspace chrome in ${relativePath}`, () => {
      const html = readFile(relativePath);
      expect(html).toContain('class="skip-nav"');
      expect(html).toContain('id="workspaceNav"');
      expect(html).toContain('id="appVersion"');
      expect(html).toContain('id="localeSelect"');
      expect(html).toContain('id="main-content"');
    });
  }

  it("keeps state-rail parity between conversational and advanced module workspaces", () => {
    const shellHtml = readFile("public/admin-content.html");
    const advancedHtml = readFile("public/admin-content-advanced.html");
    const ids = [
      "stateRail",
      "srModuleName",
      "srEditing",
      "srLive",
      "srChanges",
      "srPreview",
      "srLang",
    ];

    for (const id of ids) {
      expect(shellHtml).toContain(`id="${id}"`);
      expect(advancedHtml).toContain(`id="${id}"`);
    }
  });

  it("keeps explicit handoff hooks between conversational and advanced module editing", () => {
    const shellHtml = readFile("public/admin-content.html");
    const advancedHtml = readFile("public/admin-content-advanced.html");
    const advancedJs = readFile("public/admin-content.js");

    expect(shellHtml).toContain('id="modeSwitchAdvanced"');
    expect(shellHtml).toContain('id="modeSwitchConversation"');
    expect(shellHtml).toContain('id="chatMessages"');
    expect(shellHtml).toContain('id="previewContent"');

    expect(advancedHtml).toContain('id="modeSwitchAdvanced"');
    expect(advancedHtml).toContain('id="modeSwitchConversation"');
    // Advanced uses a separate toggle pane (advPreviewContent), not the inline previewContent
    expect(advancedHtml).toContain('id="advPreviewContent"');
    expect(advancedJs).toContain('document.getElementById("backToChatLink")');
    expect(advancedJs).toContain("function updateBackToChatLink()");
    expect(advancedJs).toContain('buildAdminContentConversationUrl');
    expect(advancedJs).toContain('resolveConversationModuleId');
  });

  it("keeps shared list-view interaction styling between library and courses", () => {
    const libraryHtml = readFile("public/admin-content-library.html");
    const coursesHtml = readFile("public/admin-content-courses.html");

    expect(libraryHtml).toContain(".row-action-btn");
    expect(coursesHtml).toContain(".row-action-btn");
    expect(libraryHtml).toContain(".content-area-nav");
    expect(coursesHtml).toContain(".content-area-nav");
  });

  it("keeps course page semantics for list and detail flows", () => {
    const coursesHtml = readFile("public/admin-content-courses.html");
    const coursesJs = readFile("public/static/admin-content-courses.js");

    // Static HTML: dialog and nav elements
    expect(coursesHtml).toContain('id="deleteDialog"');
    expect(coursesHtml).toContain('id="deleteConfirmBtn"');
    expect(coursesHtml).toContain('id="deleteCancelBtn"');

    // Dynamic JS: list and detail elements rendered at runtime
    expect(coursesJs).toContain('<table class="courses-table" aria-label="Kursliste">');
    expect(coursesJs).toContain('class="back-link"');
    expect(coursesJs).toContain('class="page-header-back"');
  });

  it("keeps GDPR/privacy warning in both module workspaces", () => {
    const shellHtml = readFile("public/admin-content.html");
    const advancedHtml = readFile("public/admin-content-advanced.html");
    // Both workspaces must carry the same special-category-data warning
    expect(shellHtml).toContain('adminContent.privacy.warning.title');
    expect(shellHtml).toContain('adminContent.privacy.warning.body');
    expect(advancedHtml).toContain('adminContent.privacy.warning.title');
    expect(advancedHtml).toContain('adminContent.privacy.warning.body');
  });
});

// ---------------------------------------------------------------------------
// Courses conversational flow — CSS contracts
// ---------------------------------------------------------------------------

describe("courses conversational flow CSS", () => {
  it("defines .conv-input-area as a flex container", () => {
    const html = readFile("public/admin-content-courses.html");
    expect(html).toContain(".conv-input-area");
    // Must be flex so input and button sit side-by-side
    expect(html).toMatch(/\.conv-input-area\s*\{[^}]*display\s*:\s*flex/);
  });

  it("overrides button width inside .conv-input-area — prevents global button{width:100%} collapsing the input", () => {
    const html = readFile("public/admin-content-courses.html");
    // The global shared.css reset sets button { width: 100% }.
    // Without an explicit override, a button inside a flex row takes 100% width
    // and the adjacent input collapses to near-zero — making the form unusable.
    expect(html).toMatch(/\.conv-input-area\s+button\s*\{[^}]*width\s*:\s*auto/);
  });

  it("sets width: auto on .conv-choice-btn — prevents cert-level and module-choice buttons going full-width", () => {
    const html = readFile("public/admin-content-courses.html");
    expect(html).toMatch(/\.conv-choice-btn\s*\{[^}]*width\s*:\s*auto/);
  });

  it("defines all required conversational flow CSS classes", () => {
    const html = readFile("public/admin-content-courses.html");
    expect(html).toContain(".conv-flow");
    expect(html).toContain(".conv-bot-msg");
    expect(html).toContain(".conv-user-bubble");
    expect(html).toContain(".conv-choices");
    expect(html).toContain(".conv-saving-indicator");
  });

  it("library row-action-btn has width: auto — prevents global button reset in flex rows", () => {
    const libraryHtml = readFile("public/admin-content-library.html");
    // Same class used for both <button> and <a> elements in row-actions flex container
    expect(libraryHtml).toMatch(/\.row-action-btn\s*\{[^}]*width\s*:\s*auto/);
  });
});

// ---------------------------------------------------------------------------
// Courses JS contracts
// ---------------------------------------------------------------------------

describe("courses JS contracts", () => {
  it("getHeaders is defined as a function, not a plain object — prevents apiFetch treating it as fetch options", () => {
    const js = readFile("public/static/admin-content-courses.js");
    // If getHeaders is a plain object, apiFetch treats it as the options arg and ignores
    // the actual method/body in the third argument — making every POST silently become a GET.
    expect(js).toMatch(/function getHeaders\s*\(\s*\)/);
    expect(js).not.toMatch(/^let getHeaders\s*=\s*\{/m);
  });

  it("renderDetailView delegates to renderNewCourseConversational when courseId is falsy", () => {
    const js = readFile("public/static/admin-content-courses.js");
    expect(js).toContain("function renderNewCourseConversational");
    const detailIdx = js.indexOf("async function renderDetailView(");
    const callIdx = js.indexOf("renderNewCourseConversational()", detailIdx);
    expect(callIdx, "renderNewCourseConversational() must be called inside renderDetailView").toBeGreaterThan(detailIdx);
  });

  it("convCreateCourse sends a POST request to /api/admin/content/courses", () => {
    const js = readFile("public/static/admin-content-courses.js");
    const fnIdx = js.indexOf("async function convCreateCourse(");
    expect(fnIdx, "convCreateCourse function must exist").toBeGreaterThan(-1);
    const postIdx = js.indexOf('"POST"', fnIdx);
    expect(postIdx, "convCreateCourse must issue a POST request").toBeGreaterThan(fnIdx);
  });
});

// ---------------------------------------------------------------------------
// Shell JS contracts
// ---------------------------------------------------------------------------

describe("shell JS contracts", () => {
  it("loadModule unwraps bundle from moduleExport key — API returns { moduleExport: {...} }, not the bundle directly", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Without the unwrap, bundle.module is always undefined and the preview pane
    // shows "Ingen modul valgt" even after a module loads successfully.
    expect(js).toMatch(/bundle\s*=\s*\w+\?\.\s*moduleExport/);
  });
});
