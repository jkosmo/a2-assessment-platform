import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const allAdminContentPages = [
  "public/admin-content.html",
  // #896 S3c: public/admin-content-advanced.html er slettet. Sto her til 2026-08-18.
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

  // #896 S3c: this was "state-rail parity between the two module workspaces". There is one
  // workspace now, so parity is not the question — presence is.
  it("keeps the state rail on the module workspace", () => {
    const shellHtml = readFile("public/admin-content.html");
    // QA r7 #1: srModuleName + srLang were removed as redundant.
    for (const id of ["stateRail", "srEditing", "srLive", "srChanges", "srPreview"]) {
      expect(shellHtml).toContain(`id="${id}"`);
    }
  });

  // #896 S3c: this test guarded the handoff BETWEEN the shell and Avansert — the mode switch, the
  // "back to chat" link, `settingsOpenAdvanced`. All of it is deleted; there is nothing to hand
  // off to. What survives is the structure that replaced it, and the assertion that the handoff
  // really is gone — a leftover entry point back into a deleted page is a 404 waiting for an
  // author, and the epic's whole point was one surface rather than two.
  it("keeps the workspace structure and no route back to the retired editor", () => {
    const shellHtml = readFile("public/admin-content.html");
    const shellJs = readFile("public/static/admin-content-shell.js");

    expect(shellHtml).toContain('id="tabPreview"');
    expect(shellHtml).toContain('id="tabPanelModule"');
    expect(shellHtml).toContain('id="tabEdit"');
    expect(shellHtml).toContain('id="tabSettings"');
    expect(shellHtml).toContain('id="tabPanelSettings"');
    expect(shellHtml).toContain('id="chatMessages"');
    expect(shellHtml).toContain('id="previewContent"');
    // v2.19.0: the fixed action bar replaced buttons parked in the conversation log.
    expect(shellHtml).toContain('id="workspaceActions"');

    expect(shellHtml).not.toContain('id="settingsOpenAdvanced"');
    expect(shellHtml).not.toContain('id="modeSwitchAdvanced"');
    expect(shellJs).not.toContain("openAdvancedEditor");
    expect(shellJs).not.toContain("writeHandoff");
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

  it("keeps the GDPR/privacy warning on the module workspace", () => {
    const shellHtml = readFile("public/admin-content.html");
    expect(shellHtml).toContain('adminContent.privacy.warning.title');
    expect(shellHtml).toContain('adminContent.privacy.warning.body');
    // Stage-tilbakemelding 2026-08-18: shown on Rediger only, which needs an id to toggle.
    expect(shellHtml).toContain('id="privacyNotice"');
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
    expect(libraryHtml).toMatch(/\.row-action-btn\s*\{[^}]*width\s*:\s*auto/);
  });

  it("row-action-btn has min-height: 0 in both library and courses — prevents global button{min-height:40px} making <button> taller than sibling <a> elements", () => {
    const libraryHtml = readFile("public/admin-content-library.html");
    const coursesHtml = readFile("public/admin-content-courses.html");
    // shared.css sets button { min-height: 40px }. Without min-height: 0 override, <button class="row-action-btn">
    // is 40px while <a class="row-action-btn"> is ~25px — visible height mismatch in the same row.
    expect(libraryHtml).toMatch(/\.row-action-btn\s*\{[^}]*min-height\s*:\s*0/);
    expect(coursesHtml).toMatch(/\.row-action-btn\s*\{[^}]*min-height\s*:\s*0/);
  });

  it("combobox-row button has width: auto — prevents global reset collapsing the module search input", () => {
    const html = readFile("public/admin-content-courses.html");
    // Same pattern as .conv-input-area button fix (v0.10.4): global button{width:100%} collapses
    // the adjacent input in a flex row unless the button explicitly sets width: auto.
    expect(html).toMatch(/\.combobox-row\s+button\s*\{[^}]*width\s*:\s*auto/);
  });

  it("conv-step defines flex column layout — provides spacing inside dynamically-injected step containers", () => {
    const html = readFile("public/admin-content-courses.html");
    // convAfter* divs are nested inside .conv-flow, not direct children, so they don't inherit
    // the flow's gap. .conv-step makes each injected step container its own flex column with gap.
    expect(html).toMatch(/\.conv-step\s*\{[^}]*display\s*:\s*flex/);
    expect(html).toMatch(/\.conv-step\s*\{[^}]*flex-direction\s*:\s*column/);
    expect(html).toMatch(/\.conv-step\s*\{[^}]*gap\s*:/);
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

  it("courses admin exposes publish controls for saved unpublished courses", () => {
    const js = readFile("public/static/admin-content-courses.js");
    expect(js).toContain("function canPublishCourse(course)");
    expect(js).toContain('data-action="publish"');
    expect(js).toContain('id="publishCourseBtn"');
    expect(js).toContain('/publish`');
  });
});

// ---------------------------------------------------------------------------
// Library JS contracts
// ---------------------------------------------------------------------------

describe("library JS contracts", () => {
  it("getHeaders is defined as a function, not a plain object — prevents apiFetch treating it as fetch options", () => {
    const js = readFile("public/static/admin-content-library.js");
    // Same root cause as courses.js Bug G (v0.10.2): plain object causes apiFetch to treat it as
    // options arg and silently ignore the method/body in the 3rd arg — all POSTs become GETs.
    expect(js).toMatch(/function getHeaders\s*\(\s*\)/);
    expect(js).not.toMatch(/^let getHeaders\s*=\s*\{/m);
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

  it("translatePageStaticText iterates [data-i18n] so privacy warning translates on locale switch", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Must use querySelectorAll('[data-i18n]') loop, not just hardcoded element selectors.
    // Without this the privacy warning stays in English regardless of locale.
    expect(js).toContain('querySelectorAll("[data-i18n]")');
  });

  it("shell page h1 carries data-i18n so it translates with locale", () => {
    const html = readFile("public/admin-content.html");
    expect(html).toContain('data-i18n="shell.page.title"');
  });

  it("logForm accepts initialValue argument for pre-fill", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Signature must carry initialValue so direct-edit flow can pre-fill fields.
    expect(js).toMatch(/function logForm\s*\([^)]*initialValue/);
    expect(js).toContain("entry.initialValue");
  });

  // v2.18.13 reversed this contract, so the test is inverted rather than deleted — the reason it
  // is gone matters more than the fact. Stage-tilbakemelding 2026-08-17: *«Åpner modul, den
  // havner på rediger fanen, men jeg kan ikke redigere før jeg trykker på 'Rediger direkte'.»*
  // The tab opens in edit mode now, so a "Rediger direkte" action would be a second door into
  // the room the author is standing in. Both models dropped it.
  it("no longer offers a directEdit action — the Rediger tab IS the form", () => {
    const js = readFile("public/static/admin-content-shell-state.js");
    expect(js).not.toContain('"directEdit"');
  });

  // -------------------------------------------------------------------------
  // #926 (#896 §6): samtalen foreslår — den overskriver aldri.
  //
  // The decision itself is one branch. What breaks is the SURFACE: four generation paths write
  // content back, and a fifth added later would bypass the gate without anyone noticing until an
  // author lost a scenario they had written by hand. That is the "correct fix, incomplete
  // surface" class CLAUDE.md names as this repo's recurring one, so the contract is on coverage,
  // not on the branch.
  // -------------------------------------------------------------------------
  describe("§6 — generated content goes through the propose/commit gate", () => {
    const GENERATORS = [
      "generateDraftInBackground",
      "generateMcqInBackground",
      "reviseDraftInBackground",
      "reviseMcqInBackground",
    ];

    for (const fn of GENERATORS) {
      it(`${fn} lands its result through commitOrProposeGenerated`, () => {
        const js = readFile("public/static/admin-content-shell.js");
        const start = js.indexOf(`async function ${fn}(`);
        expect(start, `${fn} not found`).toBeGreaterThan(-1);
        // Bounded by the next top-level `async function` so the search cannot wander into the
        // neighbour's body and pass on ITS gate call.
        const next = js.indexOf("\nasync function ", start + 1);
        const body = js.slice(start, next === -1 ? js.length : next);

        expect(body).toContain("commitOrProposeGenerated");
        // The old shape. A direct assignment here means the result bypasses the gate — which is
        // precisely how it overwrote unsaved work before.
        expect(body).not.toMatch(/sessionDraft\s*=\s*buildPreviewCandidate\(/);
      });
    }

    it("the gate parks rather than commits while the edit form is dirty", () => {
      const js = readFile("public/static/admin-content-shell.js");
      const start = js.indexOf("function commitOrProposeGenerated(");
      expect(start).toBeGreaterThan(-1);
      const body = js.slice(start, js.indexOf("\n}", js.indexOf("return false;", start)));

      // `hasOpenEditForm` is the dirty check — `isEditFormOpen` is mere presence, and since
      // v2.18.13 the form is present the whole time Rediger is, so gating on it would turn every
      // generation into a proposal.
      expect(body).toContain("hasOpenEditForm()");
      expect(body).not.toContain("isEditFormOpen()");
      expect(body).toContain("shell.proposal.use");
      expect(body).toContain("shell.proposal.discard");
    });

    it("marks the Innstillinger tab when generated criteria land out of sight", () => {
      const js = readFile("public/static/admin-content-shell.js");
      expect(js).toContain("function markTabAttention(");
      // The TODO this replaced: "Still missing (§6): marking the Innstillinger tab when something
      // lands in a tab the author is not looking at."
      expect(js).not.toContain("Still missing (§6)");
      expect(js).toContain('markTabAttention("settings")');
      // Opening the tab is seeing it — the marker must not be able to stick.
      expect(js).toContain("clearTabAttention(tab)");
    });
  });

  it("shell.directEdit.* i18n keys exist in all three locales", () => {
    const i18n = readFile("public/i18n/admin-content-translations.js");
    const keys = [
      "shell.directEdit.action",
      "shell.directEdit.editingBadge",
      "shell.directEdit.editingHint",
      "shell.directEdit.submit",
      "shell.directEdit.translating",
      "shell.directEdit.done",
      "shell.directEdit.translateError",
    ];
    for (const key of keys) {
      // Must appear at least 3 times: en-GB base + nb override + nn override
      const count = (i18n.match(new RegExp(key.replace(/\./g, "\\."), "g")) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  it("enterPreviewEditMode renders editable fields directly in preview pane", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Must use previewContent.innerHTML directly, not logForm — fields must be in preview pane.
    expect(js).toContain("function enterPreviewEditMode");
    expect(js).toContain("previewEditTitle");
    expect(js).toContain("previewEditTaskText");
    expect(js).toContain("previewEditGuidanceText");
    expect(js).toContain("preview-edit-textarea");
  });

  it("preview-pane--editing CSS class locks locale bar during edit", () => {
    const html = readFile("public/admin-content.html");
    expect(html).toContain("preview-pane--editing");
    expect(html).toMatch(/preview-pane--editing[^{]*\{[^}]*pointer-events:\s*none/);
  });

  it("PATCH /modules/:id/title route exists in backend router", () => {
    const routes = readFile("src/routes/adminContent.ts");
    expect(routes).toContain('"/modules/:moduleId/title"');
    expect(routes).toContain("updateModuleTitle");
  });

  // #906: the rename used to be its own PATCH before the version was written, so a failed save
  // left the module renamed and nothing else changed. It now travels inside the composed save.
  it("saveDraftBundleInBackground sends the rename inside the composed version call", () => {
    const js = readFile("public/static/admin-content-shell.js");
    expect(js).toContain("sessionDraft?.title");
    expect(js).toContain("/versions`");
    // The title rides along in the composed body rather than as a separate PATCH.
    expect(js).toMatch(/titlePatch \? \{ title: titlePatch \}/);
  });
});
