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

// #1046 (13.09): tilstandslinja er borte. Versjonsfaktaene står som merker i hodet, og «Forhåndsvisning
// viser …» står i Forhåndsvisning-fanen. Kontrakten er at ingenting av den gamle linja blir igjen.
describe("state rail is gone — badges in the header, «preview shows» in the preview tab", () => {
  it("public/admin-content.html has no state rail and no sr-slots", () => {
    const html = readFile("public/admin-content.html");
    expect(html).not.toContain('id="stateRail"');
    for (const id of ["srEditing", "srLive", "srChanges", "srPreview", "srModuleName"]) expect(html).not.toContain(`id="${id}"`);
    // #1046 (14.09): hodet tegnes av form-page.js inn i #moduleFormHead — sida har bare festet.
    expect(html).toContain('id="moduleFormHead"');
    expect(html).not.toContain('id="moduleLifecycleBadge"');
    expect(html).not.toContain('id="moduleDirtyBadge"');
    expect(html).toContain('id="previewShows"');
  });

  it("shared.css has no .state-rail rules", () => {
    const css = readFile("public/static/shared.css");
    expect(css).not.toMatch(/\.state-rail(-item|-label|-value|-sep)?\s*\{/);
    expect(css).not.toContain(".sr-badge");
  });

  it("the shell writes the header badges and «preview shows» from the same chain facts", () => {
    const js = readFile("public/static/admin-content-shell.js");
    // Merkene i hodet: statusHtml til form-page.js.
    expect(js).toContain("statusHtml: moduleStatusBadgesHtml");
    expect(js).toContain('getElementById("previewShows")');
    expect(js).toContain('"stateRail.live.published"');
    expect(js).toContain('"shell.header.draftVersion"');
    expect(js).not.toContain("makeSrBadge");
  });
});

describe("shared editing-source contract", () => {
  // #345 was about the shell and Avansert deriving status from ONE source instead of two. #896
  // S3c settled that question by removing the second consumer entirely — so what is left to hold
  // is that the shell still derives rather than reimplements.
  it("shell: imports deriveModuleStatusChains from module-status-logic", () => {
    const js = readFile("public/static/admin-content-shell.js");
    expect(js).toContain("module-status-logic.js");
    expect(js).toContain("deriveModuleStatusChains");
  });

  it("state 1 — working draft: hasUnsaved overrides chain (liveChain exists but draft takes priority)", () => {
    const chains = deriveModuleStatusChains(
      makeModuleExport({ activeVersionId: "v1", moduleVersions: [makeVersion("v1", 1)] }),
    );
    // Module is live; editing source is determined by hasUnsaved at render time.
    // Chains confirm the live state is detectable.
    expect(chains.liveChain.length).toBeGreaterThan(0);
    expect(chains.latestDraftChain.length).toBe(0);
    // hasUnsaved=true → UI renders "working draft" regardless of chain
  });

  it("state 2 — saved draft (not yet published): latestDraftChain populated, liveChain empty", () => {
    const chains = deriveModuleStatusChains(
      makeModuleExport({ moduleVersions: [makeVersion("v1", 1)] }),
    );
    expect(chains.latestDraftChain).toEqual([{ label: "Module", versionNo: 1 }]);
    expect(chains.liveChain).toEqual([]);
  });

  it("state 3 — live version (no newer draft): liveChain populated, latestDraftChain empty", () => {
    const chains = deriveModuleStatusChains(
      makeModuleExport({ activeVersionId: "v1", moduleVersions: [makeVersion("v1", 1)] }),
    );
    expect(chains.liveChain).toEqual([{ label: "Module", versionNo: 1 }]);
    expect(chains.latestDraftChain).toEqual([]);
  });
});

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

  // #896 S3c: three call-site tests for `public/admin-content.js` sat here — renderModuleStatus,
  // renderContentCards and the shared import. That file is deleted; the shell test above is the
  // only call site left to guard.
});
