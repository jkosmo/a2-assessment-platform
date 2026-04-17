import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLinkedVersion, deriveModuleStatusChains } from "../public/static/module-status-logic.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// Minimal module export factory — only supply fields under test
function makeModuleExport({ activeVersionId = null, moduleVersions = [], rubricVersions = [] } = {}) {
  return {
    module: { id: "mod-1", activeVersionId },
    versions: { moduleVersions, rubricVersions, promptTemplateVersions: [], mcqSetVersions: [] },
  };
}

function makeVersion(id, versionNo, extra = {}) {
  return { id, versionNo, ...extra };
}

// ---------------------------------------------------------------------------
// Unit tests — findLinkedVersion
// ---------------------------------------------------------------------------

describe("findLinkedVersion", () => {
  it("returns null for null/empty versions array", () => {
    expect(findLinkedVersion(null, "id-1")).toBeNull();
    expect(findLinkedVersion([], "id-1")).toBeNull();
    expect(findLinkedVersion(undefined, "id-1")).toBeNull();
  });

  it("returns null when id is falsy", () => {
    const versions = [makeVersion("id-1", 1)];
    expect(findLinkedVersion(versions, null)).toBeNull();
    expect(findLinkedVersion(versions, "")).toBeNull();
    expect(findLinkedVersion(versions, undefined)).toBeNull();
  });

  it("finds a matching version by id", () => {
    const v1 = makeVersion("id-1", 1);
    const v2 = makeVersion("id-2", 2);
    expect(findLinkedVersion([v1, v2], "id-2")).toBe(v2);
  });

  it("returns null when no version matches", () => {
    expect(findLinkedVersion([makeVersion("id-1", 1)], "id-99")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit tests — deriveModuleStatusChains
// ---------------------------------------------------------------------------

describe("deriveModuleStatusChains", () => {
  it("returns null for null/missing input", () => {
    expect(deriveModuleStatusChains(null)).toBeNull();
    expect(deriveModuleStatusChains(undefined)).toBeNull();
    expect(deriveModuleStatusChains({})).toBeNull();
    expect(deriveModuleStatusChains({ module: null })).toBeNull();
  });

  describe("shell-only (no saved versions)", () => {
    it("returns empty chains and shell badge", () => {
      const result = deriveModuleStatusChains(makeModuleExport());
      expect(result).not.toBeNull();
      expect(result.hasLiveVersion).toBe(false);
      expect(result.hasDraftVersion).toBe(false);
      expect(result.hasAnySavedVersions).toBe(false);
      expect(result.liveChain).toEqual([]);
      expect(result.latestDraftChain).toEqual([]);
      expect(result.badgeClass).toBe("shell");
      expect(result.badgeKey).toBe("adminContent.status.badge.shellOnly");
    });
  });

  describe("draft only (saved version, no activeVersionId)", () => {
    it("returns draft chain and draft badge", () => {
      const v1 = makeVersion("ver-1", 1);
      const result = deriveModuleStatusChains(makeModuleExport({ moduleVersions: [v1] }));
      expect(result.hasLiveVersion).toBe(false);
      expect(result.hasDraftVersion).toBe(true);
      expect(result.liveChain).toEqual([]);
      expect(result.latestDraftChain).toEqual([{ label: "Module", versionNo: 1 }]);
      expect(result.badgeClass).toBe("draft");
      expect(result.badgeKey).toBe("adminContent.status.badge.draftOnly");
    });
  });

  describe("published (activeVersionId == only version)", () => {
    it("returns live chain and live badge, no draft chain", () => {
      const v1 = makeVersion("ver-1", 1);
      const result = deriveModuleStatusChains(
        makeModuleExport({ activeVersionId: "ver-1", moduleVersions: [v1] }),
      );
      expect(result.hasLiveVersion).toBe(true);
      expect(result.hasDraftVersion).toBe(false);
      expect(result.liveChain).toEqual([{ label: "Module", versionNo: 1 }]);
      expect(result.latestDraftChain).toEqual([]);
      expect(result.badgeClass).toBe("live");
      expect(result.badgeKey).toBe("adminContent.status.badge.live");
    });
  });

  describe("published + newer draft (live is v1, latest is v2)", () => {
    it("returns both chains and draft badge", () => {
      const v1 = makeVersion("ver-1", 1);
      const v2 = makeVersion("ver-2", 2);
      // moduleVersions[0] is latest — put v2 first
      const result = deriveModuleStatusChains(
        makeModuleExport({ activeVersionId: "ver-1", moduleVersions: [v2, v1] }),
      );
      expect(result.hasLiveVersion).toBe(true);
      expect(result.hasDraftVersion).toBe(true);
      expect(result.liveChain[0]).toEqual({ label: "Module", versionNo: 1 });
      expect(result.latestDraftChain[0]).toEqual({ label: "Module", versionNo: 2 });
      expect(result.badgeClass).toBe("draft");
      expect(result.badgeKey).toBe("adminContent.status.badge.draft");
      expect(result.summaryKey).toBe("adminContent.status.summary.liveWithDraft");
    });
  });

  describe("linked rubric versions appear in chains", () => {
    it("includes rubric versionNo in liveChain when linked", () => {
      const modVer = makeVersion("ver-1", 1, { rubricVersionId: "rub-1" });
      const rubVer = makeVersion("rub-1", 3);
      const result = deriveModuleStatusChains({
        module: { id: "mod-1", activeVersionId: "ver-1" },
        versions: {
          moduleVersions: [modVer],
          rubricVersions: [rubVer],
          promptTemplateVersions: [],
          mcqSetVersions: [],
        },
      });
      expect(result.liveChain).toEqual([
        { label: "Module", versionNo: 1 },
        { label: "Rubric", versionNo: 3 },
      ]);
    });
  });

  describe("technicalDetails", () => {
    it("exposes moduleId and chain version IDs", () => {
      const v1 = makeVersion("ver-1", 1);
      const result = deriveModuleStatusChains(
        makeModuleExport({ activeVersionId: "ver-1", moduleVersions: [v1] }),
      );
      expect(result.technicalDetails.moduleId).toBe("mod-1");
      expect(result.technicalDetails.activeVersionId).toBe("ver-1");
      expect(result.technicalDetails.liveModuleVersionId).toBe("ver-1");
      expect(result.technicalDetails.latestDraftModuleVersionId).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Structural smoke tests — HTML: state rail present in both pages
// ---------------------------------------------------------------------------

describe("state rail HTML structure", () => {
  const pages = [
    "public/admin-content.html",
    "public/admin-content-advanced.html",
  ];

  for (const page of pages) {
    describe(page, () => {
      let html;
      it("has state rail container with hidden attribute and aria-label", () => {
        html = readFile(page);
        expect(html).toContain('id="stateRail"');
        // Must start hidden (JS reveals it when a module is selected)
        expect(html).toMatch(/id="stateRail"[^>]*hidden/);
        expect(html).toContain('aria-label=');
      });

      it("has all four state rail value slots", () => {
        html = readFile(page);
        expect(html).toContain('id="srModuleName"');
        expect(html).toContain('id="srEditing"');
        expect(html).toContain('id="srLive"');
        expect(html).toContain('id="srChanges"');
      });

      it("has i18n keys on state rail labels", () => {
        html = readFile(page);
        expect(html).toContain('data-i18n="stateRail.label.module"');
        expect(html).toContain('data-i18n="stateRail.label.editing"');
        expect(html).toContain('data-i18n="stateRail.label.live"');
        expect(html).toContain('data-i18n="stateRail.label.changes"');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Structural smoke tests — CSS: badge classes defined in shared.css
// ---------------------------------------------------------------------------

describe("state rail CSS", () => {
  it("defines .state-rail container and item classes", () => {
    const css = readFile("public/static/shared.css");
    expect(css).toContain(".state-rail");
    expect(css).toContain(".state-rail-item");
    expect(css).toContain(".state-rail-label");
    expect(css).toContain(".state-rail-value");
  });

  it("defines all four sr-badge modifier classes", () => {
    const css = readFile("public/static/shared.css");
    expect(css).toContain(".sr-badge--published");
    expect(css).toContain(".sr-badge--saved-draft");
    expect(css).toContain(".sr-badge--working");
    expect(css).toContain(".sr-badge--unsaved");
  });
});

// ---------------------------------------------------------------------------
// Call-site smoke tests — JS: updateStateRail is called from render functions
// ---------------------------------------------------------------------------

describe("updateStateRail call sites", () => {
  it("shell: renderPreview calls updateStateRail", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Verify both the function definition and that renderPreview triggers it
    expect(js).toContain("function updateStateRail(");
    expect(js).toContain("function renderPreview(");
    // updateStateRail() must appear after renderPreview's opening brace
    const renderPreviewIdx = js.indexOf("function renderPreview(");
    const updateCallIdx = js.indexOf("updateStateRail()", renderPreviewIdx);
    expect(updateCallIdx).toBeGreaterThan(renderPreviewIdx);
  });

  it("advanced: renderModuleStatus calls updateStateRail", () => {
    const js = readFile("public/admin-content.js");
    expect(js).toContain("function updateStateRail(");
    expect(js).toContain("function renderModuleStatus(");
    const renderModuleStatusIdx = js.indexOf("function renderModuleStatus(");
    const updateCallIdx = js.indexOf("updateStateRail()", renderModuleStatusIdx);
    expect(updateCallIdx).toBeGreaterThan(renderModuleStatusIdx);
  });

  it("advanced: renderContentCards calls updateStateRail", () => {
    const js = readFile("public/admin-content.js");
    expect(js).toContain("function renderContentCards(");
    const renderContentCardsIdx = js.indexOf("function renderContentCards(");
    const updateCallIdx = js.indexOf("updateStateRail()", renderContentCardsIdx);
    expect(updateCallIdx).toBeGreaterThan(renderContentCardsIdx);
  });

  it("advanced: imports deriveModuleStatusChains from module-status-logic", () => {
    const js = readFile("public/admin-content.js");
    expect(js).toContain("deriveModuleStatusChains");
    expect(js).toContain("module-status-logic.js");
  });
});
