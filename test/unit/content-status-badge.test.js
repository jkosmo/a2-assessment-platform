import { describe, it, expect } from "vitest";
import {
  lifecycleStatusBadge,
  moduleLibraryStatusBadge,
} from "../../public/static/content-status-badge.js";

// #705: the three admin lists (Kurs/Moduler/Seksjoner) must render ONE status vocabulary via this
// shared module — Utkast/Publisert/Arkivert with the same `status-badge--{status}` classes.
const LABELS = {
  "adminContent.lifecycle.status.draft": "Utkast",
  "adminContent.lifecycle.status.published": "Publisert",
  "adminContent.lifecycle.status.archived": "Arkivert",
  "adminContent.lifecycle.newerDraft": "Nyere utkast",
};
const t = (key) => LABELS[key] ?? key;

describe("#705 shared content status badge", () => {
  it("renders the unified three-state vocabulary + classes", () => {
    expect(lifecycleStatusBadge("draft", t)).toBe(
      '<span class="status-badge status-badge--draft">Utkast</span>',
    );
    expect(lifecycleStatusBadge("published", t)).toBe(
      '<span class="status-badge status-badge--published">Publisert</span>',
    );
    expect(lifecycleStatusBadge("archived", t)).toBe(
      '<span class="status-badge status-badge--archived">Arkivert</span>',
    );
  });

  it("appends a secondary chip when asked, without changing the primary word", () => {
    const html = lifecycleStatusBadge("published", t, { chipKey: "adminContent.lifecycle.newerDraft" });
    expect(html).toContain("status-badge--published");
    expect(html).toContain(">Publisert<");
    expect(html).toContain('<span class="status-chip">Nyere utkast</span>');
  });

  it("collapses the module library five-state to the shared three-state (+chip)", () => {
    // archived / published map straight through.
    expect(moduleLibraryStatusBadge("archived", t)).toContain("status-badge--archived");
    expect(moduleLibraryStatusBadge("published", t)).toBe(
      '<span class="status-badge status-badge--published">Publisert</span>',
    );
    // empty shell (ready) and never-published (unpublished_draft) → Utkast.
    expect(moduleLibraryStatusBadge("ready", t)).toContain("status-badge--draft");
    expect(moduleLibraryStatusBadge("unpublished_draft", t)).toContain("status-badge--draft");
    // published + newer unpublished draft → Publisert + «nyere utkast»-chip (nothing lost).
    const pwd = moduleLibraryStatusBadge("published_with_draft", t);
    expect(pwd).toContain("status-badge--published");
    expect(pwd).toContain(">Publisert<");
    expect(pwd).toContain('<span class="status-chip">Nyere utkast</span>');
  });
});
